package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sort"
)

// heldStates are the trade states in which a deposit has been received but
// not yet paid out or refunded — money that should currently be sitting at
// ESCROW_ADDRESS. DEPOSIT_FINALIZING is included: the deposit tx has been
// seen even though it isn't macro-final yet. RESERVED/AWAITING_DEPOSIT hold
// no funds (nothing's been sent, or nothing matched). SETTLED/REFUNDED are
// terminal — the money already left.
var heldStates = map[TradeState]bool{
	StateDepositFinalizing:  true,
	StateFunded:             true,
	StateAwaitingRelease:    true,
	StateReleaseConfirming:  true,
	StateAwaitingClaim:      true,
	StateClaimConfirming:    true,
	StateSettlementPending:  true,
	StateFailedAfterRelease: true,
	StateRefundPending:      true,
}

// isStuckTrade mirrors the exact guard SettlementWorker.Settle/Refund use to
// refuse a retry: an attempt was marked but no tx hash was ever recorded,
// meaning the outcome of that send is unknown and needs a human to check
// the chain and reconcile by hand.
func isStuckTrade(t MarketplaceTrade) bool {
	return (t.PayoutAttemptedAt != 0 && t.PayoutTxHash == "") ||
		(t.RefundAttemptedAt != 0 && t.RefundTxHash == "")
}

type adminMarketplaceTrade struct {
	MarketplaceTrade
	Stuck bool `json:"stuck"`
}

type adminMarketplaceResponse struct {
	Trades             []adminMarketplaceTrade `json:"trades"`
	TradeCountsByState map[TradeState]int      `json:"trade_counts_by_state"`
	StuckTradeCount    int                     `json:"stuck_trade_count"`

	// LedgerNetOutflowLuna is the ledger's running total — negative, since it
	// only ever records payouts/fees/refunds leaving escrow. It is NOT a
	// current-balance figure (deposits are never appended to the ledger); see
	// docs/escrow-architecture.md.
	LedgerNetOutflowLuna int64 `json:"ledger_net_outflow_luna"`

	// ExpectedEscrowBalanceLuna sums price_luna across trades in heldStates —
	// what should currently be sitting at ESCROW_ADDRESS given trades that
	// have a deposit but haven't settled or been refunded yet.
	ExpectedEscrowBalanceLuna uint64 `json:"expected_escrow_balance_luna"`

	// ChainEscrowBalanceLuna is live from the chain. A gap above expected
	// most likely means unmatched deposits sitting unaccounted for (wrong
	// amount, missing reference, or wrong sender — see EscrowWatcher's
	// exact-match logic and the "Known gaps" section of the escrow doc); a
	// gap below expected needs immediate investigation.
	ChainEscrowBalanceLuna *uint64 `json:"chain_escrow_balance_luna,omitempty"`
	ChainBalanceError      string  `json:"chain_balance_error,omitempty"`
}

// adminMarketplaceHandler is read-only: it reports state, doesn't change it.
// See docs/escrow-architecture.md "Known gaps" for what this can't yet do
// (force a transition, resolve a stuck trade, cancel a stale reservation).
func adminMarketplaceHandler(sessions *AdminSessions, store *MarketplaceStore, ledger *EscrowLedger, rpc *NimiqRPC, escrowAddress string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessions.Valid(r.Header.Get("X-Admin-Session")) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		all := store.AllTrades()
		sort.Slice(all, func(i, j int) bool { return all[i].UpdatedAt > all[j].UpdatedAt })

		resp := adminMarketplaceResponse{
			Trades:               make([]adminMarketplaceTrade, 0, len(all)),
			TradeCountsByState:   map[TradeState]int{},
			LedgerNetOutflowLuna: ledger.Balance(),
		}
		for _, t := range all {
			stuck := isStuckTrade(t)
			resp.Trades = append(resp.Trades, adminMarketplaceTrade{MarketplaceTrade: t, Stuck: stuck})
			resp.TradeCountsByState[t.State]++
			if stuck {
				resp.StuckTradeCount++
			}
			if heldStates[t.State] {
				resp.ExpectedEscrowBalanceLuna += t.PriceLuna
			}
		}

		if balance, err := rpc.GetBalance(escrowAddress); err != nil {
			log.Printf("admin marketplace: chain balance lookup failed err=%q", err)
			resp.ChainBalanceError = err.Error()
		} else {
			resp.ChainEscrowBalanceLuna = &balance
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}
