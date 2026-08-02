package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func newTestEscrowLedger(t *testing.T) *EscrowLedger {
	t.Helper()
	ledger, err := OpenEscrowLedger(filepath.Join(t.TempDir(), "ledger.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	return ledger
}

func adminToken(t *testing.T) (*AdminSessions, string) {
	t.Helper()
	sessions := NewAdminSessions(nil)
	token, _, err := sessions.Issue()
	if err != nil {
		t.Fatal(err)
	}
	return sessions, token
}

func TestAdminMarketplaceHandler_RequiresSession(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	sessions, _ := adminToken(t)
	ledger := newTestEscrowLedger(t)
	srv := fakeRPC(t, map[string]string{"getAccountByAddress": `{"balance":0}`})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	h := adminMarketplaceHandler(sessions, store, ledger, rpc, "NQ77 ESCROW")
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/admin/marketplace", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session header: got %d, want 401", rec.Code)
	}
}

func TestAdminMarketplaceHandler_ReportsCountsStuckAndBalances(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	sessions, token := adminToken(t)
	ledger := newTestEscrowLedger(t)
	if _, err := ledger.Append(LedgerEntry{TradeID: "t1", Type: LedgerPayout, AmountLuna: -900, TxHash: "p1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := ledger.Append(LedgerEntry{TradeID: "t1", Type: LedgerFee, AmountLuna: -100}); err != nil {
		t.Fatal(err)
	}
	srv := fakeRPC(t, map[string]string{"getAccountByAddress": `{"balance":5000}`})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	// A trade currently holding funds (counts toward expected escrow balance).
	if _, err := store.CreateListing("chuck", "NQ11 SELLER", 1000, 100, "t1"); err != nil {
		t.Fatal(err)
	}
	funded, err := store.ReserveListing("chuck", "trade-funded", "ref-1", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}
	for _, transition := range [][2]TradeState{
		{StateReserved, StateAwaitingDeposit},
		{StateAwaitingDeposit, StateDepositFinalizing},
		{StateDepositFinalizing, StateFunded},
	} {
		if err := store.Transition(funded.ID, transition[0], transition[1], nil); err != nil {
			t.Fatal(err)
		}
	}

	// A stuck trade: payout attempted, no hash recorded.
	if _, err := store.CreateListing("alice", "NQ33 SELLER", 2000, 0, "t2"); err != nil {
		t.Fatal(err)
	}
	stuck, err := store.ReserveListing("alice", "trade-stuck", "ref-2", "NQ44 BUYER")
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
		{StateAwaitingClaim, StateClaimConfirming},
		{StateClaimConfirming, StateSettlementPending},
	} {
		if err := store.Transition(stuck.ID, transition[0], transition[1], nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.MarkPayoutAttempt(stuck.ID, 12345); err != nil {
		t.Fatal(err)
	}

	h := adminMarketplaceHandler(sessions, store, ledger, rpc, "NQ77 ESCROW")
	req := httptest.NewRequest(http.MethodGet, "/api/admin/marketplace", nil)
	req.Header.Set("X-Admin-Session", token)
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body)
	}

	var resp adminMarketplaceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Trades) != 2 {
		t.Fatalf("want 2 trades, got %d", len(resp.Trades))
	}
	if resp.TradeCountsByState[StateFunded] != 1 || resp.TradeCountsByState[StateSettlementPending] != 1 {
		t.Fatalf("unexpected state counts: %+v", resp.TradeCountsByState)
	}
	if resp.StuckTradeCount != 1 {
		t.Fatalf("want 1 stuck trade, got %d", resp.StuckTradeCount)
	}
	for _, tr := range resp.Trades {
		if tr.ID == stuck.ID && !tr.Stuck {
			t.Fatal("expected the settlement-pending trade with an attempt marker and no hash to be flagged stuck")
		}
		if tr.ID == funded.ID && tr.Stuck {
			t.Fatal("funded trade should not be flagged stuck")
		}
	}
	// funded trade (1000) is in a held state; stuck trade (2000) is in
	// SETTLEMENT_PENDING, also still held (payout attempted but unconfirmed).
	if resp.ExpectedEscrowBalanceLuna != 3000 {
		t.Fatalf("want expected balance 3000, got %d", resp.ExpectedEscrowBalanceLuna)
	}
	if resp.LedgerNetOutflowLuna != -1000 {
		t.Fatalf("want ledger net outflow -1000, got %d", resp.LedgerNetOutflowLuna)
	}
	if resp.ChainEscrowBalanceLuna == nil || *resp.ChainEscrowBalanceLuna != 5000 {
		t.Fatalf("want chain balance 5000, got %+v", resp.ChainEscrowBalanceLuna)
	}
	if resp.ChainBalanceError != "" {
		t.Fatalf("unexpected chain balance error: %s", resp.ChainBalanceError)
	}
}

func TestAdminMarketplaceHandler_ReportsChainBalanceErrorWithoutFailingTheRequest(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	sessions, token := adminToken(t)
	ledger := newTestEscrowLedger(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
	}))
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	h := adminMarketplaceHandler(sessions, store, ledger, rpc, "NQ77 ESCROW")
	req := httptest.NewRequest(http.MethodGet, "/api/admin/marketplace", nil)
	req.Header.Set("X-Admin-Session", token)
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("chain lookup failure should not fail the whole request: got %d", rec.Code)
	}
	var resp adminMarketplaceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ChainBalanceError == "" || resp.ChainEscrowBalanceLuna != nil {
		t.Fatalf("expected a chain balance error and no balance, got %+v", resp)
	}
}
