package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func newTestMarketplaceHandlerDeps(t *testing.T) (*MarketplaceStore, *HandleRegistry) {
	t.Helper()
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	return store, registry
}

func postMarketplaceJSON(t *testing.T, handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(data))
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func TestMarketplaceListingCreateHandler_RequiresChainOwnership(t *testing.T) {
	store, registry := newTestMarketplaceHandlerDeps(t)
	if err := registry.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)}); err != nil {
		t.Fatal(err)
	}

	priv, notOwner := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", notOwner, 1000, 50, "t1", "n1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	handler := marketplaceListingCreateHandler(store, registry, 1000)
	rec := postMarketplaceJSON(t, handler, map[string]any{
		"handle": "chuck", "seller": notOwner, "price_luna": 1000, "fee_luna": 50,
		"ownership_epoch_tx_hash": "t1", "nonce": "n1", "expires_at": expiresAt,
		"public_key": pubHex, "signature": sigHex,
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a signer who doesn't currently own the handle, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMarketplaceListingCreateHandler_AcceptsCurrentOwner(t *testing.T) {
	store, registry := newTestMarketplaceHandlerDeps(t)
	priv, owner := testKeypairAndAddress(t)
	if err := registry.Rebuild([]rpcTx{claimTx("t1", owner, "chuck", 5, 0)}); err != nil {
		t.Fatal(err)
	}

	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", owner, 1000, 50, "t1", "n1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	handler := marketplaceListingCreateHandler(store, registry, 1000)
	rec := postMarketplaceJSON(t, handler, map[string]any{
		"handle": "chuck", "seller": owner, "price_luna": 1000, "fee_luna": 50,
		"ownership_epoch_tx_hash": "t1", "nonce": "n1", "expires_at": expiresAt,
		"public_key": pubHex, "signature": sigHex,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	listing, ok := store.listings["chuck"]
	if !ok || listing.Status != "active" {
		t.Fatalf("expected an active listing to be created: %+v ok=%v", listing, ok)
	}
}

func TestMarketplaceListingCreateHandler_RejectsFeeAboveMax(t *testing.T) {
	store, registry := newTestMarketplaceHandlerDeps(t)
	priv, owner := testKeypairAndAddress(t)
	if err := registry.Rebuild([]rpcTx{claimTx("t1", owner, "chuck", 5, 0)}); err != nil {
		t.Fatal(err)
	}

	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", owner, 1000, 200, "t1", "n1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	handler := marketplaceListingCreateHandler(store, registry, 1000)
	rec := postMarketplaceJSON(t, handler, map[string]any{
		"handle": "chuck", "seller": owner, "price_luna": 1000, "fee_luna": 200,
		"ownership_epoch_tx_hash": "t1", "nonce": "n1", "expires_at": expiresAt,
		"public_key": pubHex, "signature": sigHex,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a fee over the configured cap, got %d", rec.Code)
	}
}

func TestMarketplaceTradeReserveHandler_CreatesAFundableTrade(t *testing.T) {
	store, registry := newTestMarketplaceHandlerDeps(t)
	priv, owner := testKeypairAndAddress(t)
	if err := registry.Rebuild([]rpcTx{claimTx("t1", owner, "chuck", 5, 0)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateListing("chuck", owner, 1000, 50, "t1"); err != nil {
		t.Fatal(err)
	}

	buyerPriv, buyer := testKeypairAndAddress(t)
	_ = priv
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplacePurchaseMessage("chuck", buyer, buyer, "n2", expiresAt)
	pubHex, sigHex := signMessage(t, buyerPriv, message)

	handler := marketplaceTradeReserveHandler(store, "NQ99 ESCROW")
	rec := postMarketplaceJSON(t, handler, map[string]any{
		"handle": "chuck", "buyer": buyer, "refund_address": buyer,
		"nonce": "n2", "expires_at": expiresAt, "public_key": pubHex, "signature": sigHex,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		TradeID       string `json:"trade_id"`
		EscrowAddress string `json:"escrow_address"`
		Reference     string `json:"reference"`
		PriceLuna     uint64 `json:"price_luna"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp.TradeID == "" || resp.EscrowAddress != "NQ99 ESCROW" || resp.Reference == "" || resp.PriceLuna != 1000 {
		t.Fatalf("unexpected response: %+v", resp)
	}
	trade, ok := store.Resolve(resp.TradeID)
	if !ok || trade.State != StateAwaitingDeposit {
		t.Fatalf("expected the trade to already be AWAITING_DEPOSIT, got %+v ok=%v", trade, ok)
	}
}

func TestMarketplaceTradeGetHandler_ReturnsTradeStatus(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	if _, err := store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1"); err != nil {
		t.Fatal(err)
	}
	trade, err := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/marketplace/trades/"+trade.ID, nil)
	req.SetPathValue("tradeID", trade.ID)
	rec := httptest.NewRecorder()
	marketplaceTradeGetHandler(store)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var got MarketplaceTrade
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.ID != trade.ID || got.State != StateReserved {
		t.Fatalf("unexpected trade: %+v", got)
	}
}

func TestMarketplaceTradeReleaseHandler_HubPath_VerifiesBeforeAdvancing(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	if _, err := store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1"); err != nil {
		t.Fatal(err)
	}
	trade, err := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}
	for _, transition := range [][2]TradeState{
		{StateReserved, StateAwaitingDeposit},
		{StateAwaitingDeposit, StateDepositFinalizing},
		{StateDepositFinalizing, StateFunded},
		{StateFunded, StateAwaitingRelease},
	} {
		if err := store.Transition(trade.ID, transition[0], transition[1], nil); err != nil {
			t.Fatal(err)
		}
	}

	releaseData := hex.EncodeToString([]byte(makeReleasePayload("chuck")))
	tx := rpcTx{Hash: "r1", Sender: "NQ11 SELLER", Recipient: "NQ77 REGISTRY", Data: releaseData}
	srv := choreographyServer(t, "r1", &tx)
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	handler := marketplaceTradeReleaseHandler(store, rpc, "NQ77 REGISTRY")
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(mustJSON(t, map[string]any{
		"kind": "hub", "raw_hex": "deadbeef",
	})))
	req.SetPathValue("tradeID", trade.ID)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got, _ := store.Resolve(trade.ID)
	if got.ReleaseTxHash != "r1" || got.State != StateReleaseConfirming {
		t.Fatalf("expected RELEASE_CONFIRMING with hash r1, got %+v", got)
	}
}

func TestMarketplaceTradeReleaseHandler_RejectsWrongSender(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	if _, err := store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1"); err != nil {
		t.Fatal(err)
	}
	trade, err := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}
	for _, transition := range [][2]TradeState{
		{StateReserved, StateAwaitingDeposit},
		{StateAwaitingDeposit, StateDepositFinalizing},
		{StateDepositFinalizing, StateFunded},
		{StateFunded, StateAwaitingRelease},
	} {
		if err := store.Transition(trade.ID, transition[0], transition[1], nil); err != nil {
			t.Fatal(err)
		}
	}

	releaseData := hex.EncodeToString([]byte(makeReleasePayload("chuck")))
	tx := rpcTx{Hash: "r1", Sender: "NQ99 IMPOSTOR", Recipient: "NQ77 REGISTRY", Data: releaseData}
	srv := choreographyServer(t, "r1", &tx)
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	handler := marketplaceTradeReleaseHandler(store, rpc, "NQ77 REGISTRY")
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(mustJSON(t, map[string]any{
		"kind": "hub", "raw_hex": "deadbeef",
	})))
	req.SetPathValue("tradeID", trade.ID)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a release not sent by the trade's seller, got %d", rec.Code)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease {
		t.Fatalf("trade must not advance on a rejected release, got %s", got.State)
	}
}

func TestMarketplaceTradeClaimHandler_PayPath_IndependentlyVerifies(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	if _, err := store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1"); err != nil {
		t.Fatal(err)
	}
	trade, err := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}
	for _, transition := range [][2]TradeState{
		{StateReserved, StateAwaitingDeposit},
		{StateAwaitingDeposit, StateDepositFinalizing},
		{StateDepositFinalizing, StateFunded},
		{StateFunded, StateAwaitingRelease},
		{StateAwaitingRelease, StateReleaseConfirming},
		{StateReleaseConfirming, StateAwaitingClaim},
	} {
		if err := store.Transition(trade.ID, transition[0], transition[1], nil); err != nil {
			t.Fatal(err)
		}
	}

	claimData := hex.EncodeToString([]byte(makeClaimPayload("chuck")))
	tx := rpcTx{Hash: "c1", Sender: "NQ22 BUYER", Recipient: "NQ77 REGISTRY", Data: claimData}
	srv := choreographyServer(t, "", &tx)
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	handler := marketplaceTradeClaimHandler(store, rpc, "NQ77 REGISTRY")
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(mustJSON(t, map[string]any{
		"kind": "pay", "tx_hash": "c1",
	})))
	req.SetPathValue("tradeID", trade.ID)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got, _ := store.Resolve(trade.ID)
	if got.ClaimTxHash != "c1" || got.State != StateClaimConfirming {
		t.Fatalf("expected CLAIM_CONFIRMING with hash c1, got %+v", got)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestMarketplaceListingsGetHandler_ReturnsActiveListings(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")

	req := httptest.NewRequest(http.MethodGet, "/api/marketplace/listings", nil)
	rec := httptest.NewRecorder()
	marketplaceListingsGetHandler(store)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var listings []MarketplaceListing
	json.NewDecoder(rec.Body).Decode(&listings)
	if len(listings) != 1 || listings[0].Handle != "chuck" {
		t.Fatalf("unexpected listings: %+v", listings)
	}
}
