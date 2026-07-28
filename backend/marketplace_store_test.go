package main

import (
	"path/filepath"
	"sync"
	"testing"
)

func TestCreateListing_RejectsSecondActiveListingForSameHandle(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	if _, err := s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateListing("chuck", "NQ11 SELLER", 2000, 50, "tx1"); err == nil {
		t.Fatal("expected an error creating a second active listing for the same handle")
	}
}

func TestReserveListing_OnlyOneTradeWinsAConcurrentRace(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")

	const attempts = 20
	var wg sync.WaitGroup
	successes := make(chan MarketplaceTrade, attempts)
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			trade, err := s.ReserveListing("chuck", tradeIDFor(i), referenceFor(i), "NQ22 BUYER")
			if err == nil {
				successes <- trade
			}
		}(i)
	}
	wg.Wait()
	close(successes)

	count := 0
	for range successes {
		count++
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 winning reservation, got %d", count)
	}
}

func tradeIDFor(i int) string   { return "trade-" + string(rune('a'+i)) }
func referenceFor(i int) string { return "ref-" + string(rune('a'+i)) }

func TestReserveListing_RejectsUnknownOrNonActiveListing(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	if _, err := s.ReserveListing("nosuchhandle", "t1", "r1", "NQ22 BUYER"); err == nil {
		t.Fatal("expected an error reserving a listing that doesn't exist")
	}
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	if _, err := s.ReserveListing("chuck", "t1", "r1", "NQ22 BUYER"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReserveListing("chuck", "t2", "r2", "NQ33 OTHER"); err == nil {
		t.Fatal("expected an error reserving an already-reserved listing")
	}
}

func TestTransition_HappyPathAndConflict(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := s.ReserveListing("chuck", "t1", "r1", "NQ22 BUYER")
	if trade.State != StateReserved {
		t.Fatalf("expected RESERVED, got %s", trade.State)
	}

	if err := s.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Resolve(trade.ID)
	if got.State != StateAwaitingDeposit || got.Version != 2 {
		t.Fatalf("expected AWAITING_DEPOSIT version 2, got %+v", got)
	}

	if err := s.Transition(trade.ID, StateReserved, StateFunded, nil); err == nil {
		t.Fatal("expected an error transitioning from a stale expected state")
	}
}

func TestTransition_MutateCallbackSetsFields(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := s.ReserveListing("chuck", "t1", "r1", "NQ22 BUYER")
	s.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)

	err := s.Transition(trade.ID, StateAwaitingDeposit, StateDepositFinalizing, func(tr *MarketplaceTrade) {
		tr.DepositTxHash = "deposit-hash"
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.Resolve(trade.ID)
	if got.DepositTxHash != "deposit-hash" {
		t.Fatalf("mutate callback did not apply: %+v", got)
	}
}

func TestFindTradeByReference(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := s.ReserveListing("chuck", "t1", "the-reference", "NQ22 BUYER")

	found, ok := s.FindTradeByReference("the-reference")
	if !ok || found.ID != trade.ID {
		t.Fatalf("expected to find trade by reference, got %+v ok=%v", found, ok)
	}
	if _, ok := s.FindTradeByReference("nope"); ok {
		t.Fatal("unknown reference must not resolve")
	}
}

func TestMarketplaceStore_PersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "marketplace.json")
	s := NewMarketplaceStore(path)
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := s.ReserveListing("chuck", "t1", "r1", "NQ22 BUYER")

	reloaded := NewMarketplaceStore(path)
	got, ok := reloaded.Resolve(trade.ID)
	if !ok || got.State != StateReserved {
		t.Fatalf("expected persisted trade to reload, got %+v ok=%v", got, ok)
	}
}

func TestConsumeNonce_RejectsReuse(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	if err := s.ConsumeNonce("abc"); err != nil {
		t.Fatal(err)
	}
	if err := s.ConsumeNonce("abc"); err == nil {
		t.Fatal("expected an error reusing a nonce")
	}
	if err := s.ConsumeNonce("def"); err != nil {
		t.Fatal("a different nonce must still succeed")
	}
}

func TestConsumeNonce_PersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "marketplace.json")
	s := NewMarketplaceStore(path)
	if err := s.ConsumeNonce("abc"); err != nil {
		t.Fatal(err)
	}

	reloaded := NewMarketplaceStore(path)
	if err := reloaded.ConsumeNonce("abc"); err == nil {
		t.Fatal("expected the reloaded store to still reject a previously used nonce")
	}
}

func TestActiveListings_ReturnsOnlyActiveStatus(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	s.CreateListing("alice", "NQ22 SELLER", 2000, 100, "t2")
	s.ReserveListing("alice", "trade-1", "ref-1", "NQ33 BUYER") // moves alice's listing to "reserved"

	active := s.ActiveListings()
	if len(active) != 1 || active[0].Handle != "chuck" {
		t.Fatalf("expected only chuck's active listing, got %+v", active)
	}
}
