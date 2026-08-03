package main

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"
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

func TestAllTrades_ReturnsEveryTradeAcrossStates(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	s.CreateListing("alice", "NQ33 OTHER", 2000, 100, "t2")
	tradeA, _ := s.ReserveListing("chuck", "trade-a", "ref-a", "NQ22 BUYER")
	tradeB, _ := s.ReserveListing("alice", "trade-b", "ref-b", "NQ44 OTHERBUYER")
	if err := s.Transition(tradeA.ID, StateReserved, StateAwaitingDeposit, nil); err != nil {
		t.Fatal(err)
	}

	all := s.AllTrades()
	if len(all) != 2 {
		t.Fatalf("want 2 trades, got %d", len(all))
	}
	byID := map[string]MarketplaceTrade{}
	for _, tr := range all {
		byID[tr.ID] = tr
	}
	if byID[tradeA.ID].State != StateAwaitingDeposit {
		t.Fatalf("expected trade A to reflect its transitioned state, got %+v", byID[tradeA.ID])
	}
	if byID[tradeB.ID].State != StateReserved {
		t.Fatalf("expected trade B to still be RESERVED, got %+v", byID[tradeB.ID])
	}
}

func TestTradesForWallet_MatchesEitherRole(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	s.CreateListing("alice", "NQ33 OTHER", 2000, 100, "t2")
	tradeA, _ := s.ReserveListing("chuck", "trade-a", "ref-a", "NQ22 BUYER")
	s.ReserveListing("alice", "trade-b", "ref-b", "NQ44 OTHERBUYER")

	sellerTrades := s.TradesForWallet("NQ11 SELLER")
	if len(sellerTrades) != 1 || sellerTrades[0].ID != tradeA.ID {
		t.Fatalf("expected seller to see only their own trade, got %+v", sellerTrades)
	}

	buyerTrades := s.TradesForWallet("NQ22 BUYER")
	if len(buyerTrades) != 1 || buyerTrades[0].ID != tradeA.ID {
		t.Fatalf("expected buyer to see their trade via the buyer role, got %+v", buyerTrades)
	}
}

func TestTradesForWallet_SpacingAndCaseInsensitive(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	s.ReserveListing("chuck", "trade-a", "ref-a", "NQ22 BUYER")

	got := s.TradesForWallet("nq11seller")
	if len(got) != 1 {
		t.Fatalf("expected a case/spacing-insensitive match, got %+v", got)
	}
}

func TestTradesForWallet_EmptyForUnknownAddress(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	got := s.TradesForWallet("NQ99 NOBODY")
	if got == nil || len(got) != 0 {
		t.Fatalf("expected an empty (non-nil) slice, got %+v", got)
	}
}

func TestReserveListing_SetsDepositDeadline(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	before := time.Now().Unix()
	trade, err := s.ReserveListing("chuck", "t1", "r1", "NQ22 BUYER")
	if err != nil {
		t.Fatal(err)
	}
	if trade.DepositDeadline < before+depositDeadlineDuration || trade.DepositDeadline > before+depositDeadlineDuration+2 {
		t.Fatalf("unexpected deposit deadline %d (before=%d)", trade.DepositDeadline, before)
	}
}

func TestExpireStaleReservations_RestoresListing(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := s.ReserveListing("chuck", "t1", "r1", "NQ22 BUYER")
	s.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)

	n, err := s.ExpireStaleReservations(time.Now().Unix() + depositDeadlineDuration + 1)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want 1 expired, got %d", n)
	}
	got, _ := s.Resolve(trade.ID)
	if got.State != StateExpired {
		t.Fatalf("want EXPIRED, got %s", got.State)
	}
	listings := s.ActiveListings()
	if len(listings) != 1 || listings[0].Handle != "chuck" {
		t.Fatalf("listing should be active again, got %+v", listings)
	}
}

func TestExpireStaleReservations_SkipsAfterDepositSeen(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := s.ReserveListing("chuck", "t1", "r1", "NQ22 BUYER")
	s.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	s.Transition(trade.ID, StateAwaitingDeposit, StateDepositFinalizing, func(tr *MarketplaceTrade) {
		tr.DepositTxHash = "dep"
	})
	n, err := s.ExpireStaleReservations(time.Now().Unix() + depositDeadlineDuration + 1)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("must not expire after deposit seen, got %d", n)
	}
}

func TestReserveListing_CapsConcurrentUnpaid(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	buyer := "NQ22 BUYER"
	for i := 0; i < maxUnpaidReservations; i++ {
		handle := fmt.Sprintf("hand%d", i)
		s.CreateListing(handle, "NQ11 SELLER", 1000, 50, "tx"+handle)
		trade, err := s.ReserveListing(handle, "t"+handle, "r"+handle, buyer)
		if err != nil {
			t.Fatalf("reserve %d: %v", i, err)
		}
		s.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	}
	s.CreateListing("overflow", "NQ11 SELLER", 1000, 50, "txoverflow")
	if _, err := s.ReserveListing("overflow", "tover", "rover", buyer); err == nil {
		t.Fatal("expected concurrent unpaid reservation cap")
	}
}

func TestCancelUnpaidReservation_RestoresListing(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := s.ReserveListing("chuck", "t1", "r1", "NQ22 BUYER")
	s.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	if err := s.CancelUnpaidReservation(trade.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Resolve(trade.ID)
	if got.State != StateCanceled {
		t.Fatalf("want CANCELED, got %s", got.State)
	}
	if len(s.ActiveListings()) != 1 {
		t.Fatal("listing should be active after cancel")
	}
}
