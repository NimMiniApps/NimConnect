package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

func newTradeID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}

type marketplaceListingRequest struct {
	Handle               string `json:"handle"`
	Seller               string `json:"seller"`
	PriceLuna            uint64 `json:"price_luna"`
	FeeLuna              uint64 `json:"fee_luna"`
	OwnershipEpochTxHash string `json:"ownership_epoch_tx_hash"`
	Nonce                string `json:"nonce"`
	ExpiresAt            int64  `json:"expires_at"`
	PublicKey            string `json:"public_key"`
	Signature            string `json:"signature"`
}

// marketplaceListingCreateHandler verifies the seller's signed listing
// intent, independently confirms on chain that the seller currently owns the
// handle, enforces the configured fee cap, and creates the listing.
func marketplaceListingCreateHandler(store *MarketplaceStore, registry *HandleRegistry, maxFeeBps uint64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req marketplaceListingRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if !isValidHandle(req.Handle) || req.PriceLuna == 0 || req.FeeLuna > req.PriceLuna {
			writeJSONError(w, http.StatusBadRequest, "invalid listing fields")
			return
		}
		if req.FeeLuna*10_000/req.PriceLuna > maxFeeBps {
			writeJSONError(w, http.StatusBadRequest, "fee exceeds the maximum allowed")
			return
		}
		if err := verifyListingIntent(req.Handle, req.Seller, req.PriceLuna, req.FeeLuna, req.OwnershipEpochTxHash, req.Nonce, req.ExpiresAt, req.PublicKey, req.Signature); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "invalid listing signature")
			return
		}
		claim, ok := registry.Resolve(req.Handle)
		if !ok || compactAddress(claim.Address) != compactAddress(req.Seller) {
			writeJSONError(w, http.StatusForbidden, "signer does not currently own this handle on chain")
			return
		}
		if claim.TxHash != req.OwnershipEpochTxHash {
			writeJSONError(w, http.StatusConflict, "ownership epoch has moved — re-sign the listing intent")
			return
		}
		if err := store.ConsumeNonce(req.Nonce); err != nil {
			writeJSONError(w, http.StatusConflict, "nonce already used")
			return
		}
		listing, err := store.CreateListing(req.Handle, req.Seller, req.PriceLuna, req.FeeLuna, req.OwnershipEpochTxHash)
		if err != nil {
			writeJSONError(w, http.StatusConflict, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(listing)
	}
}

type marketplaceReserveRequest struct {
	Handle        string `json:"handle"`
	Buyer         string `json:"buyer"`
	RefundAddress string `json:"refund_address"`
	Nonce         string `json:"nonce"`
	ExpiresAt     int64  `json:"expires_at"`
	PublicKey     string `json:"public_key"`
	Signature     string `json:"signature"`
}

// marketplaceTradeReserveHandler verifies the buyer's signed purchase
// intent, reserves the listing, and advances the new trade to
// AWAITING_DEPOSIT before returning its payment details.
func marketplaceTradeReserveHandler(store *MarketplaceStore, escrowAddress string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req marketplaceReserveRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if !isValidHandle(req.Handle) || !isValidNimiqAddress(req.Buyer) || !isValidNimiqAddress(req.RefundAddress) {
			writeJSONError(w, http.StatusBadRequest, "invalid reservation fields")
			return
		}
		if err := verifyPurchaseIntent(req.Handle, req.Buyer, req.RefundAddress, req.Nonce, req.ExpiresAt, req.PublicKey, req.Signature); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "invalid purchase signature")
			return
		}
		if err := store.ConsumeNonce(req.Nonce); err != nil {
			writeJSONError(w, http.StatusConflict, "nonce already used")
			return
		}
		tradeID := newTradeID()
		reference := buildTradeReference()
		trade, err := store.ReserveListing(req.Handle, tradeID, reference, req.Buyer)
		if err != nil {
			writeJSONError(w, http.StatusConflict, err.Error())
			return
		}
		if err := store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil); err != nil {
			log.Printf("marketplace reserve: failed to advance to AWAITING_DEPOSIT err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "marketplace unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"trade_id":       trade.ID,
			"escrow_address": escrowAddress,
			"reference":      reference,
			"price_luna":     trade.PriceLuna,
			"fee_luna":       trade.FeeLuna,
		})
	}
}

func marketplaceTradeGetHandler(store *MarketplaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		trade, ok := store.Resolve(r.PathValue("tradeID"))
		if !ok {
			writeJSONError(w, http.StatusNotFound, "no such trade")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(trade)
	}
}

func marketplaceListingsGetHandler(store *MarketplaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(store.ActiveListings())
	}
}

type marketplaceSubmitRequest struct {
	Kind   string `json:"kind"`
	RawHex string `json:"raw_hex,omitempty"`
	TxHash string `json:"tx_hash,omitempty"`
}

func verifyReleaseTx(tx rpcTx, trade MarketplaceTrade, registryAddress string) error {
	if compactAddress(normalizeAddress(tx.sender())) != compactAddress(trade.Seller) {
		return fmt.Errorf("sender does not match the trade's seller")
	}
	if compactAddress(tx.recipient()) != compactAddress(registryAddress) {
		return fmt.Errorf("recipient is not the handle registry")
	}
	action := parseClaimData(tx.data())
	if action == nil || !action.IsRelease || action.Handle != trade.Handle {
		return fmt.Errorf("transaction is not a release of %q", trade.Handle)
	}
	return nil
}

func verifyClaimTx(tx rpcTx, trade MarketplaceTrade, registryAddress string) error {
	if compactAddress(normalizeAddress(tx.sender())) != compactAddress(trade.Buyer) {
		return fmt.Errorf("sender does not match the trade's buyer")
	}
	if compactAddress(tx.recipient()) != compactAddress(registryAddress) {
		return fmt.Errorf("recipient is not the handle registry")
	}
	action := parseClaimData(tx.data())
	if action == nil || action.IsRelease || action.Handle != trade.Handle {
		return fmt.Errorf("transaction is not a claim of %q", trade.Handle)
	}
	return nil
}

// marketplaceTradeReleaseHandler accepts either a Hub-style not-yet-broadcast
// raw transaction or a Nimiq-Pay-style already-sent transaction hash, verifies
// it against the trade, and advances AWAITING_RELEASE -> RELEASE_CONFIRMING.
func marketplaceTradeReleaseHandler(store *MarketplaceStore, rpc *NimiqRPC, registryAddress string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		trade, ok := store.Resolve(r.PathValue("tradeID"))
		if !ok {
			writeJSONError(w, http.StatusNotFound, "no such trade")
			return
		}
		if trade.State != StateAwaitingRelease {
			writeJSONError(w, http.StatusConflict, "trade is not awaiting a release")
			return
		}
		var req marketplaceSubmitRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		verify := func(tx rpcTx) error { return verifyReleaseTx(tx, trade, registryAddress) }
		var txHash string
		var err error
		switch req.Kind {
		case "hub":
			txHash, err = SubmitHubTransaction(rpc, req.RawHex, verify)
		case "pay":
			err = SubmitPayTransaction(rpc, req.TxHash, verify)
			txHash = req.TxHash
		default:
			writeJSONError(w, http.StatusBadRequest, `kind must be "hub" or "pay"`)
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid release transaction: "+err.Error())
			return
		}
		if err := store.Transition(trade.ID, StateAwaitingRelease, StateReleaseConfirming, func(t *MarketplaceTrade) {
			t.ReleaseTxHash = txHash
		}); err != nil {
			log.Printf("marketplace release: failed to advance trade err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "marketplace unavailable")
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

// marketplaceTradeClaimHandler is the buyer-side mirror of the release
// handler: it verifies the submitted transaction and advances
// AWAITING_CLAIM -> CLAIM_CONFIRMING.
func marketplaceTradeClaimHandler(store *MarketplaceStore, rpc *NimiqRPC, registryAddress string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		trade, ok := store.Resolve(r.PathValue("tradeID"))
		if !ok {
			writeJSONError(w, http.StatusNotFound, "no such trade")
			return
		}
		if trade.State != StateAwaitingClaim {
			writeJSONError(w, http.StatusConflict, "trade is not awaiting a claim")
			return
		}
		var req marketplaceSubmitRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		verify := func(tx rpcTx) error { return verifyClaimTx(tx, trade, registryAddress) }
		var txHash string
		var err error
		switch req.Kind {
		case "hub":
			txHash, err = SubmitHubTransaction(rpc, req.RawHex, verify)
		case "pay":
			err = SubmitPayTransaction(rpc, req.TxHash, verify)
			txHash = req.TxHash
		default:
			writeJSONError(w, http.StatusBadRequest, `kind must be "hub" or "pay"`)
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid claim transaction: "+err.Error())
			return
		}
		if err := store.Transition(trade.ID, StateAwaitingClaim, StateClaimConfirming, func(t *MarketplaceTrade) {
			t.ClaimTxHash = txHash
		}); err != nil {
			log.Printf("marketplace claim: failed to advance trade err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "marketplace unavailable")
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}
