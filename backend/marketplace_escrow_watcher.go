package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

// EscrowReferencePrefix marks deposit transaction data with a trade reference.
const EscrowReferencePrefix = "NME1:"

func buildTradeReference() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func parseTradeReference(dataHex string) string {
	raw, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(dataHex), "0x"))
	if err != nil {
		return ""
	}
	text := string(raw)
	if !strings.HasPrefix(text, EscrowReferencePrefix) {
		return ""
	}
	return strings.TrimPrefix(text, EscrowReferencePrefix)
}

const escrowSweepCooldown = 5 * time.Second
const escrowMaxTxFetch = 5000

// EscrowWatcher observes deposits to the pooled escrow account. A matching
// deposit is recorded immediately as provisional; only macro finality moves
// the trade to FUNDED.
type EscrowWatcher struct {
	rpc           *NimiqRPC
	store         *MarketplaceStore
	escrowAddress string
	mu            sync.Mutex
	lastSweep     time.Time
}

func NewEscrowWatcher(rpc *NimiqRPC, store *MarketplaceStore, escrowAddress string) *EscrowWatcher {
	return &EscrowWatcher{rpc: rpc, store: store, escrowAddress: escrowAddress}
}

func (w *EscrowWatcher) Sweep() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if time.Since(w.lastSweep) < escrowSweepCooldown {
		return nil
	}

	txs, err := w.rpc.GetTransactionsByAddress(w.escrowAddress, escrowMaxTxFetch)
	if err != nil {
		return err
	}
	macroHeight, err := w.rpc.GetLastMacroBlockNumber()
	if err != nil {
		return err
	}
	w.lastSweep = time.Now()

	for _, tx := range txs {
		if compactAddress(tx.recipient()) != compactAddress(w.escrowAddress) {
			continue
		}
		reference := parseTradeReference(tx.data())
		if reference == "" {
			continue
		}
		trade, ok := w.store.FindTradeByReference(reference)
		if !ok || trade.State != StateAwaitingDeposit {
			continue
		}
		if tx.Value != trade.PriceLuna || compactAddress(normalizeAddress(tx.sender())) != compactAddress(trade.Buyer) {
			continue
		}
		if err := w.store.Transition(trade.ID, StateAwaitingDeposit, StateDepositFinalizing, func(t *MarketplaceTrade) {
			t.DepositTxHash = tx.Hash
			t.DepositBlockHeight = tx.BlockNumber
		}); err != nil {
			return err
		}
	}

	for _, trade := range w.store.TradesInState(StateDepositFinalizing) {
		if trade.DepositBlockHeight > macroHeight {
			continue
		}
		if err := w.store.Transition(trade.ID, StateDepositFinalizing, StateFunded, nil); err != nil {
			return err
		}
		// A finalized deposit is definitionally sufficient to move on — there's
		// no separate condition to wait for, so a trade should never rest
		// observably at FUNDED. See docs/superpowers/specs/2026-07-29-marketplace-release-transition-and-trade-discovery-design.md.
		if err := w.store.Transition(trade.ID, StateFunded, StateAwaitingRelease, nil); err != nil {
			return err
		}
	}
	return nil
}
