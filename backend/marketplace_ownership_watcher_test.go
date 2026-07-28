package main

import (
	"path/filepath"
	"testing"
)

func ownershipFixture(t *testing.T, macroHeight uint64) (*MarketplaceStore, *HandleRegistry, *fakeSigner, *OwnershipWatcher, MarketplaceTrade) {
	t.Helper()
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	ledger, err := OpenEscrowLedger(filepath.Join(t.TempDir(), "ledger.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ledger.Close() })
	signer := newFakeSigner()
	settlement := NewSettlementWorker(store, ledger, signer, "NQ99 ESCROW")

	srv := escrowSweepServer(t, &macroHeight, nil)
	t.Cleanup(srv.Close)
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

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

	watcher := NewOwnershipWatcher(rpc, store, registry, settlement)
	trade, _ = store.Resolve(trade.ID)
	return store, registry, signer, watcher, trade
}

func TestOwnershipWatcher_SettlesWhenBuyerIsFinalizedOwner(t *testing.T) {
	store, registry, signer, watcher, trade := ownershipFixture(t, 100)
	registry.releaseActivationHeight = 0
	if err := registry.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 SELLER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 SELLER", "chuck", 10, 0),
		claimTx("t3", "NQ22 BUYER", "chuck", 20, 0),
	}); err != nil {
		t.Fatal(err)
	}

	if err := watcher.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateSettled {
		t.Fatalf("expected SETTLED, got %s (%+v)", got.State, got)
	}
	if len(signer.calls) != 1 || signer.calls[0].recipient != "NQ11 SELLER" {
		t.Fatalf("expected one payout call to the seller, got %+v", signer.calls)
	}
}

func TestOwnershipWatcher_WaitsForFinalityBeforeSettling(t *testing.T) {
	store, registry, signer, watcher, trade := ownershipFixture(t, 5)
	registry.releaseActivationHeight = 0
	if err := registry.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 SELLER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 SELLER", "chuck", 10, 0),
		claimTx("t3", "NQ22 BUYER", "chuck", 20, 0),
	}); err != nil {
		t.Fatal(err)
	}

	if err := watcher.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State == StateSettled {
		t.Fatal("must not settle before the winning claim is macro-finalized")
	}
	if len(signer.calls) != 0 {
		t.Fatal("must not call the signer before finality")
	}
	_ = trade
}

func TestOwnershipWatcher_RefundsWhenSniped(t *testing.T) {
	store, registry, signer, watcher, trade := ownershipFixture(t, 100)
	registry.releaseActivationHeight = 0
	if err := registry.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 SELLER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 SELLER", "chuck", 10, 0),
		claimTx("t3", "NQ99 SNIPER", "chuck", 20, 0),
	}); err != nil {
		t.Fatal(err)
	}

	if err := watcher.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateRefunded {
		t.Fatalf("expected REFUNDED after a snipe, got %s", got.State)
	}
	if len(signer.calls) != 1 || signer.calls[0].recipient != "NQ22 BUYER" {
		t.Fatalf("expected one refund call to the buyer, got %+v", signer.calls)
	}
	_ = trade
}

func TestOwnershipWatcher_LeavesTradeAloneWhileSellerStillOwns(t *testing.T) {
	store, registry, signer, watcher, trade := ownershipFixture(t, 100)
	registry.releaseActivationHeight = 0
	if err := registry.Rebuild([]rpcTx{claimTx("t1", "NQ11 SELLER", "chuck", 5, 0)}); err != nil {
		t.Fatal(err)
	}

	if err := watcher.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease {
		t.Fatalf("expected the trade to remain AWAITING_RELEASE, got %s", got.State)
	}
	if len(signer.calls) != 0 {
		t.Fatal("must not call the signer while no release has happened")
	}
	_ = trade
}
