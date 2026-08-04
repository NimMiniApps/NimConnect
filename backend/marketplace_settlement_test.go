package main

import (
	"testing"
)

func settlementFixture(t *testing.T) (*MarketplaceStore, *EscrowLedger, *fakeSigner, *SettlementWorker, MarketplaceTrade) {
	t.Helper()
	store, ledger := newTestMarketplaceAndLedger(t)
	signer := newFakeSigner()
	worker := NewSettlementWorker(store, ledger, signer, "NQ99 ESCROW")
	t.Cleanup(func() { ledger.Close() })

	if _, err := store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1"); err != nil {
		t.Fatal(err)
	}
	trade, err := store.ReserveListing("chuck", "t1", "ref1", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}
	mustTransition(t, store, trade.ID, StateReserved, StateAwaitingDeposit, nil)
	mustTransition(t, store, trade.ID, StateAwaitingDeposit, StateDepositFinalizing, func(tr *MarketplaceTrade) {
		tr.DepositTxHash = "d1"
		tr.DepositBlockHeight = 1
	})
	mustTransition(t, store, trade.ID, StateDepositFinalizing, StateFunded, nil)
	mustTransition(t, store, trade.ID, StateFunded, StateAwaitingRelease, nil)
	mustTransition(t, store, trade.ID, StateAwaitingRelease, StateReleaseConfirming, func(tr *MarketplaceTrade) {
		tr.ReleaseTxHash = "r1"
	})
	mustTransition(t, store, trade.ID, StateReleaseConfirming, StateAwaitingClaim, nil)
	mustTransition(t, store, trade.ID, StateAwaitingClaim, StateClaimConfirming, func(tr *MarketplaceTrade) {
		tr.ClaimTxHash = "c1"
	})
	mustTransition(t, store, trade.ID, StateClaimConfirming, StateSettlementPending, nil)

	trade, _ = store.Resolve(trade.ID)
	return store, ledger, signer, worker, trade
}

func mustTransition(t *testing.T, store *MarketplaceStore, tradeID string, from, to TradeState, mutate func(*MarketplaceTrade)) {
	t.Helper()
	if err := store.Transition(tradeID, from, to, mutate); err != nil {
		t.Fatal(err)
	}
}

func TestSettle_PaysSellerMinusFeeAndRecordsLedger(t *testing.T) {
	store, ledger, signer, worker, trade := settlementFixture(t)

	if err := worker.Settle(trade.ID); err != nil {
		t.Fatal(err)
	}

	got, _ := store.Resolve(trade.ID)
	if got.State != StateSettled || got.PayoutTxHash == "" {
		t.Fatalf("expected SETTLED with a payout hash, got %+v", got)
	}
	if len(signer.calls) != 1 || signer.calls[0].recipient != compactAddress("NQ11 SELLER") || signer.calls[0].valueLuna != 950 {
		t.Fatalf("expected one payout call of 950 to the seller, got %+v", signer.calls)
	}
	if got := ledger.Balance(); got != -1000 {
		t.Fatalf("expected ledger to record -950 payout and -50 fee (-1000 total), got %d", got)
	}
}

func TestSettle_IsIdempotent(t *testing.T) {
	store, _, signer, worker, trade := settlementFixture(t)
	if err := worker.Settle(trade.ID); err != nil {
		t.Fatal(err)
	}
	first, _ := store.Resolve(trade.ID)

	if err := worker.Settle(trade.ID); err != nil {
		t.Fatal(err)
	}
	second, _ := store.Resolve(trade.ID)
	if len(signer.calls) != 1 {
		t.Fatalf("expected exactly one payout call across two Settle attempts, got %d", len(signer.calls))
	}
	if second.PayoutTxHash != first.PayoutTxHash {
		t.Fatal("payout tx hash must not change on a repeated Settle call")
	}
}

func TestSettle_MarksAttemptedBeforeCallingSigner(t *testing.T) {
	store, _, signer, worker, trade := settlementFixture(t)
	mustTransition(t, store, trade.ID, StateSettlementPending, StateSettlementPending, func(tr *MarketplaceTrade) {
		tr.PayoutAttemptedAt = 1
	})

	if err := worker.Settle(trade.ID); err == nil {
		t.Fatal("expected Settle to refuse to auto-retry a trade with an attempt already marked and no recorded hash")
	}
	if len(signer.calls) != 0 {
		t.Fatal("must not call the signer again for an ambiguous in-flight payout")
	}
}

func refundFixture(t *testing.T) (*MarketplaceStore, *EscrowLedger, *fakeSigner, *SettlementWorker, MarketplaceTrade) {
	t.Helper()
	store, ledger := newTestMarketplaceAndLedger(t)
	signer := newFakeSigner()
	worker := NewSettlementWorker(store, ledger, signer, "NQ99 ESCROW")
	t.Cleanup(func() { ledger.Close() })

	if _, err := store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1"); err != nil {
		t.Fatal(err)
	}
	trade, err := store.ReserveListing("chuck", "t1", "ref1", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}
	mustTransition(t, store, trade.ID, StateReserved, StateAwaitingDeposit, nil)
	mustTransition(t, store, trade.ID, StateAwaitingDeposit, StateDepositFinalizing, nil)
	mustTransition(t, store, trade.ID, StateDepositFinalizing, StateFunded, nil)
	mustTransition(t, store, trade.ID, StateFunded, StateRefundPending, nil)

	trade, _ = store.Resolve(trade.ID)
	return store, ledger, signer, worker, trade
}

func TestRefund_ReturnsFullPrincipalToBuyer(t *testing.T) {
	store, ledger, signer, worker, trade := refundFixture(t)

	if err := worker.Refund(trade.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateRefunded || got.RefundTxHash == "" {
		t.Fatalf("expected REFUNDED with a refund hash, got %+v", got)
	}
	if len(signer.calls) != 1 || signer.calls[0].recipient != compactAddress("NQ22 BUYER") || signer.calls[0].valueLuna != 1000 {
		t.Fatalf("expected a full-principal refund to the buyer, got %+v", signer.calls)
	}
	if got := ledger.Balance(); got != -1000 {
		t.Fatalf("expected ledger to record the full refund, got %d", got)
	}
}

func TestRefund_IsIdempotent(t *testing.T) {
	_, _, signer, worker, trade := refundFixture(t)
	if err := worker.Refund(trade.ID); err != nil {
		t.Fatal(err)
	}
	if err := worker.Refund(trade.ID); err != nil {
		t.Fatal(err)
	}
	if len(signer.calls) != 1 {
		t.Fatalf("expected exactly one refund call across two Refund attempts, got %d", len(signer.calls))
	}
}
