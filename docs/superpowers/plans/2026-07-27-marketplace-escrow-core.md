# Marketplace Escrow Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the internal marketplace engine from `docs/superpowers/specs/2026-07-27-handle-marketplace-design.md`'s "Marketplace architecture" onward: the trade state machine, listing/trade persistence, the append-only escrow ledger, the escrow funding watcher, and an idempotent settlement worker that pays sellers and refunds buyers. This plan does not add the HTTP API, signed-intent verification, or wallet-specific (Hub vs Nimiq Pay) choreography — that's the next plan, once this engine exists and is proven correct in isolation.

**Architecture:** This backend has no SQL database anywhere — `HandleRegistry` and `InboxStore` are both mutex-guarded in-memory state persisted to disk as JSON. The marketplace follows the same shape: `MarketplaceStore` is a single mutex-guarded critical section, so the spec's "database constraints" (one active trade per listing, atomic state transitions) are enforced by never releasing the lock mid-check, not by a real transaction. The escrow ledger is append-only JSONL (never rewritten), matching its "existing rows are never edited" requirement directly. The escrow watcher mirrors `HandleSyncer`'s existing poll-and-rebuild pattern against a second address. The settlement worker is the one genuinely new capability: **this backend cannot currently sign or broadcast a Nimiq transaction at all** — `NimiqRPC` is read-only today. Settlement goes through a `TransactionSigner` interface backed by a new `NimiqRPC` method that asks a *dedicated, non-public* Nimiq node (with the escrow key imported/unlocked) to sign and send — this plan builds and tests against that interface with a fake; wiring a real signing node, and hardening it (key isolation, sign-then-broadcast crash safety), is deliberately deferred to the next plan alongside custody controls.

**Tech Stack:** Go, matching `backend/handles.go` / `handles_registry.go` / `handles_sync.go` conventions.

## Global Constraints

- No SQL database — persistence is mutex-guarded in-memory state + JSON file(s) on disk, exactly like `HandleRegistry`.
- The escrow ledger is append-only: entries are written once and never edited or deleted; corrections are new compensating entries, never mutations.
- A trade transition is valid only from its declared predecessor state(s) (see Task 1's table) — no transition function may silently accept an unexpected `from` state.
- A settlement operation (payout or refund) must record that it was attempted, durably, *before* asking the signer to send — a crash after signing must never result in a second automatic send; it must route to manual review instead.
- The escrow watcher only advances a trade past `AWAITING_DEPOSIT` once its deposit's block height is at or before the chain's last macro-finalized block (never on tx inclusion alone).
- Wrong-reference, wrong-amount, wrong-payer, or unattributable deposits never advance a trade — they are left for manual review, never auto-refunded on receipt (spec: "manual review rather than triggering automatic refunds that could be abused with dust transactions").

---

### Task 1: Trade state machine and core types

**Files:**
- Create: `backend/marketplace.go`
- Test: `backend/marketplace_test.go`

**Interfaces:**
- Produces: `TradeState` (string enum with all states from the spec's diagram), `MarketplaceListing`, `MarketplaceTrade` structs, `(TradeState) canTransitionTo(next TradeState) bool`.

- [ ] **Step 1: Write the failing tests**

```go
package main

import "testing"

func TestTradeStateTransitions_HappyPath(t *testing.T) {
	path := []TradeState{
		StateReserved, StateAwaitingDeposit, StateDepositFinalizing, StateFunded,
		StateAwaitingRelease, StateReleaseConfirming, StateAwaitingClaim,
		StateClaimConfirming, StateSettlementPending, StateSettled,
	}
	for i := 0; i < len(path)-1; i++ {
		if !path[i].canTransitionTo(path[i+1]) {
			t.Errorf("%s -> %s should be allowed", path[i], path[i+1])
		}
	}
}

func TestTradeStateTransitions_RefundPaths(t *testing.T) {
	preRelease := []TradeState{StateReserved, StateAwaitingDeposit, StateFunded, StateAwaitingRelease}
	for _, s := range preRelease {
		if !s.canTransitionTo(StateRefundPending) {
			t.Errorf("%s -> REFUND_PENDING should be allowed pre-release", s)
		}
	}
	postRelease := []TradeState{StateReleaseConfirming, StateAwaitingClaim, StateClaimConfirming}
	for _, s := range postRelease {
		if !s.canTransitionTo(StateFailedAfterRelease) {
			t.Errorf("%s -> FAILED_AFTER_RELEASE should be allowed", s)
		}
	}
	if !StateFailedAfterRelease.canTransitionTo(StateRefundPending) {
		t.Error("FAILED_AFTER_RELEASE -> REFUND_PENDING should be allowed")
	}
	if !StateRefundPending.canTransitionTo(StateRefunded) {
		t.Error("REFUND_PENDING -> REFUNDED should be allowed")
	}
}

func TestTradeStateTransitions_RejectsInvalid(t *testing.T) {
	if StateSettled.canTransitionTo(StateRefundPending) {
		t.Error("SETTLED must be terminal — no transition out")
	}
	if StateReserved.canTransitionTo(StateSettled) {
		t.Error("RESERVED cannot skip straight to SETTLED")
	}
	if StateRefunded.canTransitionTo(StateFunded) {
		t.Error("REFUNDED must be terminal")
	}
}

func TestTradeStateTransitions_ManualReviewReachableFromEveryNonTerminalState(t *testing.T) {
	nonTerminal := []TradeState{
		StateReserved, StateAwaitingDeposit, StateDepositFinalizing, StateFunded,
		StateAwaitingRelease, StateReleaseConfirming, StateAwaitingClaim,
		StateClaimConfirming, StateSettlementPending, StateFailedAfterRelease, StateRefundPending,
	}
	for _, s := range nonTerminal {
		if !s.canTransitionTo(StateManualReview) {
			t.Errorf("%s -> MANUAL_REVIEW should always be allowed (ambiguous money/chain state escape hatch)", s)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run TestTradeStateTransitions -v`
Expected: FAIL — none of these types or methods exist yet.

- [ ] **Step 3: Implement the types and state machine**

```go
// backend/marketplace.go
package main

// TradeState is the persisted lifecycle of one marketplace trade. See the
// design spec's "Trade state machine" for the full diagram this mirrors.
type TradeState string

const (
	StateReserved           TradeState = "RESERVED"
	StateAwaitingDeposit    TradeState = "AWAITING_DEPOSIT"
	StateDepositFinalizing  TradeState = "DEPOSIT_FINALIZING"
	StateFunded             TradeState = "FUNDED"
	StateAwaitingRelease    TradeState = "AWAITING_RELEASE"
	StateReleaseConfirming  TradeState = "RELEASE_CONFIRMING"
	StateAwaitingClaim      TradeState = "AWAITING_CLAIM"
	StateClaimConfirming    TradeState = "CLAIM_CONFIRMING"
	StateSettlementPending  TradeState = "SETTLEMENT_PENDING"
	StateSettled            TradeState = "SETTLED"
	StateFailedAfterRelease TradeState = "FAILED_AFTER_RELEASE"
	StateRefundPending      TradeState = "REFUND_PENDING"
	StateRefunded           TradeState = "REFUNDED"
	StateManualReview       TradeState = "MANUAL_REVIEW"
)

// allowedTransitions is the only place trade lifecycle rules are declared.
// MANUAL_REVIEW is reachable from every non-terminal state — it's the
// ambiguous-money-or-chain-state escape hatch, not a normal step.
var allowedTransitions = map[TradeState][]TradeState{
	StateReserved:           {StateAwaitingDeposit, StateRefundPending, StateManualReview},
	StateAwaitingDeposit:    {StateDepositFinalizing, StateRefundPending, StateManualReview},
	StateDepositFinalizing:  {StateFunded, StateManualReview},
	StateFunded:             {StateAwaitingRelease, StateRefundPending, StateManualReview},
	StateAwaitingRelease:    {StateReleaseConfirming, StateRefundPending, StateManualReview},
	StateReleaseConfirming:  {StateAwaitingClaim, StateFailedAfterRelease, StateManualReview},
	StateAwaitingClaim:      {StateClaimConfirming, StateFailedAfterRelease, StateManualReview},
	StateClaimConfirming:    {StateSettlementPending, StateFailedAfterRelease, StateManualReview},
	StateSettlementPending:  {StateSettled, StateManualReview},
	StateFailedAfterRelease: {StateRefundPending, StateManualReview},
	StateRefundPending:      {StateRefunded, StateManualReview},
	// StateSettled, StateRefunded, StateManualReview: terminal via this table
	// (MANUAL_REVIEW is only left by manual operator action, not automation).
}

func (s TradeState) canTransitionTo(next TradeState) bool {
	for _, allowed := range allowedTransitions[s] {
		if allowed == next {
			return true
		}
	}
	return false
}

// MarketplaceListing is one seller's offer to sell an owned handle at a
// fixed price. Status: "active" | "reserved" | "sold" | "canceled".
type MarketplaceListing struct {
	Handle               string `json:"handle"`
	Seller               string `json:"seller"`
	PriceLuna            uint64 `json:"price_luna"`
	FeeLuna              uint64 `json:"fee_luna"`
	Status               string `json:"status"`
	OwnershipEpochTxHash string `json:"ownership_epoch_tx_hash"`
	CreatedAt            int64  `json:"created_at"`
}

// MarketplaceTrade is one buyer's attempt to complete a listing. Version
// increments on every persisted transition — not used for optimistic
// concurrency (the store's mutex already serializes all access), but as an
// audit trail of how many transitions a trade has been through.
type MarketplaceTrade struct {
	ID                string     `json:"id"`
	Reference         string     `json:"reference"`
	Handle            string     `json:"handle"`
	Buyer             string     `json:"buyer"`
	Seller            string     `json:"seller"`
	PriceLuna         uint64     `json:"price_luna"`
	FeeLuna           uint64     `json:"fee_luna"`
	State             TradeState `json:"state"`
	Version           uint64     `json:"version"`
	DepositTxHash     string     `json:"deposit_tx_hash,omitempty"`
	ReleaseTxHash     string     `json:"release_tx_hash,omitempty"`
	ClaimTxHash       string     `json:"claim_tx_hash,omitempty"`
	PayoutAttemptedAt int64      `json:"payout_attempted_at,omitempty"`
	PayoutTxHash      string     `json:"payout_tx_hash,omitempty"`
	RefundAttemptedAt int64      `json:"refund_attempted_at,omitempty"`
	RefundTxHash      string     `json:"refund_tx_hash,omitempty"`
	CreatedAt         int64      `json:"created_at"`
	UpdatedAt         int64      `json:"updated_at"`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run TestTradeStateTransitions -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/marketplace.go backend/marketplace_test.go
git commit -m "feat: add marketplace trade state machine and core types"
```

---

### Task 2: `MarketplaceStore` — listings, trades, atomic reservation

**Files:**
- Create: `backend/marketplace_store.go`
- Test: `backend/marketplace_store_test.go`

**Interfaces:**
- Consumes: `TradeState`, `MarketplaceListing`, `MarketplaceTrade` from Task 1.
- Produces: `NewMarketplaceStore(path string) *MarketplaceStore`; `(*MarketplaceStore) CreateListing(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash string) (MarketplaceListing, error)`; `(*MarketplaceStore) ReserveListing(handle, tradeID, reference, buyer string) (MarketplaceTrade, error)`; `(*MarketplaceStore) Transition(tradeID string, from, to TradeState, mutate func(*MarketplaceTrade)) error`; `(*MarketplaceStore) Resolve(tradeID string) (MarketplaceTrade, bool)`; `(*MarketplaceStore) FindTradeByReference(reference string) (MarketplaceTrade, bool)`.

- [ ] **Step 1: Write the failing tests**

```go
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

func tradeIDFor(i int) string     { return "trade-" + string(rune('a'+i)) }
func referenceFor(i int) string   { return "ref-" + string(rune('a'+i)) }

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

	err := s.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := s.Resolve(trade.ID)
	if got.State != StateAwaitingDeposit || got.Version != 2 {
		t.Fatalf("expected AWAITING_DEPOSIT version 2, got %+v", got)
	}

	// Wrong expected `from` state must fail, not silently apply.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestCreateListing|TestReserveListing|TestTransition|TestFindTradeByReference|TestMarketplaceStore' -v`
Expected: FAIL — none of these types exist yet.

- [ ] **Step 3: Implement the store**

```go
// backend/marketplace_store.go
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"
)

// MarketplaceStore is a mutex-guarded in-memory listings/trades table,
// persisted to one JSON file — same shape as HandleRegistry. There is no SQL
// database in this backend; the store's single critical section is what
// gives ReserveListing and Transition the atomicity the design spec asks a
// database for (one active trade per listing, no lost updates).
type MarketplaceStore struct {
	path string
	mu   sync.Mutex

	listings map[string]MarketplaceListing // keyed by handle
	trades   map[string]MarketplaceTrade   // keyed by trade ID
	byRef    map[string]string             // reference -> trade ID
}

type marketplaceSnapshot struct {
	Listings map[string]MarketplaceListing `json:"listings"`
	Trades   map[string]MarketplaceTrade   `json:"trades"`
}

func NewMarketplaceStore(path string) *MarketplaceStore {
	s := &MarketplaceStore{
		path:     path,
		listings: map[string]MarketplaceListing{},
		trades:   map[string]MarketplaceTrade{},
		byRef:    map[string]string{},
	}
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var snap marketplaceSnapshot
		if json.Unmarshal(data, &snap) == nil {
			if snap.Listings != nil {
				s.listings = snap.Listings
			}
			if snap.Trades != nil {
				s.trades = snap.Trades
				for id, tr := range snap.Trades {
					s.byRef[tr.Reference] = id
				}
			}
		}
	}
	return s
}

func (s *MarketplaceStore) persistLocked() error {
	data, err := json.Marshal(marketplaceSnapshot{Listings: s.listings, Trades: s.trades})
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// CreateListing rejects a second active listing for the same handle — the
// caller is responsible for having already verified on-chain ownership
// before calling this (that check belongs to the API layer, not the store).
func (s *MarketplaceStore) CreateListing(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash string) (MarketplaceListing, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, ok := s.listings[handle]; ok && existing.Status == "active" {
		return MarketplaceListing{}, fmt.Errorf("an active listing for %q already exists", handle)
	}
	listing := MarketplaceListing{
		Handle: handle, Seller: seller, PriceLuna: priceLuna, FeeLuna: feeLuna,
		Status: "active", OwnershipEpochTxHash: ownershipEpochTxHash, CreatedAt: time.Now().Unix(),
	}
	s.listings[handle] = listing
	return listing, s.persistLocked()
}

// ReserveListing wins an atomic race for one listing: the first caller to
// acquire the store's mutex while the listing is still "active" wins;
// everyone else sees "reserved" and fails. tradeID and reference must be
// generated by the caller (e.g. crypto/rand) — this method only enforces
// uniqueness and the state transition.
func (s *MarketplaceStore) ReserveListing(handle, tradeID, reference, buyer string) (MarketplaceTrade, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	listing, ok := s.listings[handle]
	if !ok || listing.Status != "active" {
		return MarketplaceTrade{}, fmt.Errorf("no active listing for %q", handle)
	}
	if _, taken := s.byRef[reference]; taken {
		return MarketplaceTrade{}, fmt.Errorf("reference %q already in use", reference)
	}
	now := time.Now().Unix()
	trade := MarketplaceTrade{
		ID: tradeID, Reference: reference, Handle: handle, Buyer: buyer, Seller: listing.Seller,
		PriceLuna: listing.PriceLuna, FeeLuna: listing.FeeLuna, State: StateReserved, Version: 1,
		CreatedAt: now, UpdatedAt: now,
	}
	listing.Status = "reserved"
	s.listings[handle] = listing
	s.trades[tradeID] = trade
	s.byRef[reference] = tradeID
	return trade, s.persistLocked()
}

// Transition applies a trade state change only if the trade is currently in
// `from`. mutate may be nil; when set, it runs before the new state and
// UpdatedAt/Version are written, so it can set result fields like a deposit
// or payout transaction hash atomically with the transition.
func (s *MarketplaceStore) Transition(tradeID string, from, to TradeState, mutate func(*MarketplaceTrade)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	trade, ok := s.trades[tradeID]
	if !ok {
		return fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State != from {
		return fmt.Errorf("trade %q is in state %s, expected %s", tradeID, trade.State, from)
	}
	if !from.canTransitionTo(to) {
		return fmt.Errorf("transition %s -> %s is not allowed", from, to)
	}
	if mutate != nil {
		mutate(&trade)
	}
	trade.State = to
	trade.Version++
	trade.UpdatedAt = time.Now().Unix()
	s.trades[tradeID] = trade
	return s.persistLocked()
}

func (s *MarketplaceStore) Resolve(tradeID string) (MarketplaceTrade, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	trade, ok := s.trades[tradeID]
	return trade, ok
}

func (s *MarketplaceStore) FindTradeByReference(reference string) (MarketplaceTrade, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tradeID, ok := s.byRef[reference]
	if !ok {
		return MarketplaceTrade{}, false
	}
	trade, ok := s.trades[tradeID]
	return trade, ok
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestCreateListing|TestReserveListing|TestTransition|TestFindTradeByReference|TestMarketplaceStore' -v -race`
Expected: PASS (the `-race` flag matters here — this test suite is what proves the mutex actually serializes the reservation race).

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_store.go backend/marketplace_store_test.go
git commit -m "feat: add MarketplaceStore with atomic listing reservation"
```

---

### Task 3: Append-only escrow ledger

**Files:**
- Create: `backend/marketplace_ledger.go`
- Test: `backend/marketplace_ledger_test.go`

**Interfaces:**
- Produces: `LedgerEntryType` enum (`LedgerDeposit`, `LedgerPayout`, `LedgerRefund`, `LedgerFee`, `LedgerNetworkFee`); `LedgerEntry` struct; `OpenEscrowLedger(path string) (*EscrowLedger, error)`; `(*EscrowLedger) Append(entry LedgerEntry) error`; `(*EscrowLedger) Balance() int64`; `(*EscrowLedger) Close() error`.

- [ ] **Step 1: Write the failing tests**

```go
package main

import (
	"path/filepath"
	"testing"
)

func TestEscrowLedger_AppendAndBalance(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.jsonl")
	l, err := OpenEscrowLedger(path)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	l.Append(LedgerEntry{TradeID: "t1", Type: LedgerDeposit, AmountLuna: 1000})
	l.Append(LedgerEntry{TradeID: "t1", Type: LedgerPayout, AmountLuna: -950})
	l.Append(LedgerEntry{TradeID: "t1", Type: LedgerFee, AmountLuna: -50})

	if got := l.Balance(); got != 0 {
		t.Fatalf("expected balanced ledger (0), got %d", got)
	}
}

func TestEscrowLedger_SequenceNumbersAreMonotonic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.jsonl")
	l, _ := OpenEscrowLedger(path)
	defer l.Close()

	e1, _ := l.Append(LedgerEntry{TradeID: "t1", Type: LedgerDeposit, AmountLuna: 100})
	e2, _ := l.Append(LedgerEntry{TradeID: "t2", Type: LedgerDeposit, AmountLuna: 200})
	if e2.Sequence != e1.Sequence+1 {
		t.Fatalf("expected monotonic sequence, got %d then %d", e1.Sequence, e2.Sequence)
	}
}

func TestEscrowLedger_PersistsAndReplaysAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ledger.jsonl")
	l, _ := OpenEscrowLedger(path)
	l.Append(LedgerEntry{TradeID: "t1", Type: LedgerDeposit, AmountLuna: 1000})
	l.Append(LedgerEntry{TradeID: "t1", Type: LedgerRefund, AmountLuna: -1000})
	l.Close()

	reopened, err := OpenEscrowLedger(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if got := reopened.Balance(); got != 0 {
		t.Fatalf("expected balance to survive restart via replay, got %d", got)
	}
	// The next appended entry must continue the sequence, not restart at 1.
	next, _ := reopened.Append(LedgerEntry{TradeID: "t2", Type: LedgerDeposit, AmountLuna: 500})
	if next.Sequence != 3 {
		t.Fatalf("expected sequence 3 after replaying 2 entries, got %d", next.Sequence)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run TestEscrowLedger -v`
Expected: FAIL — `OpenEscrowLedger` and friends don't exist yet.

- [ ] **Step 3: Implement the ledger**

```go
// backend/marketplace_ledger.go
package main

import (
	"bufio"
	"encoding/json"
	"os"
	"sync"
)

type LedgerEntryType string

const (
	LedgerDeposit    LedgerEntryType = "deposit"
	LedgerPayout     LedgerEntryType = "payout"
	LedgerRefund     LedgerEntryType = "refund"
	LedgerFee        LedgerEntryType = "fee"
	LedgerNetworkFee LedgerEntryType = "network_fee"
)

// LedgerEntry is one line of the append-only escrow ledger. AmountLuna is
// signed: money into escrow is positive, money leaving it is negative — a
// correctly settled trade's entries always sum to zero.
type LedgerEntry struct {
	Sequence   uint64          `json:"sequence"`
	TradeID    string          `json:"trade_id"`
	Type       LedgerEntryType `json:"type"`
	AmountLuna int64           `json:"amount_luna"`
	TxHash     string          `json:"tx_hash,omitempty"`
	Timestamp  int64           `json:"timestamp"`
}

// EscrowLedger is an append-only JSONL file: one entry per line, opened in
// append mode, never rewritten. Existing rows are never edited or deleted —
// corrections must be new compensating entries appended like any other.
type EscrowLedger struct {
	mu      sync.Mutex
	file    *os.File
	nextSeq uint64
	balance int64
}

func OpenEscrowLedger(path string) (*EscrowLedger, error) {
	l := &EscrowLedger{nextSeq: 1}

	if existing, err := os.Open(path); err == nil {
		scanner := bufio.NewScanner(existing)
		for scanner.Scan() {
			var entry LedgerEntry
			if json.Unmarshal(scanner.Bytes(), &entry) == nil {
				l.balance += entry.AmountLuna
				if entry.Sequence >= l.nextSeq {
					l.nextSeq = entry.Sequence + 1
				}
			}
		}
		existing.Close()
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	l.file = file
	return l, nil
}

func (l *EscrowLedger) Append(entry LedgerEntry) (LedgerEntry, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry.Sequence = l.nextSeq
	line, err := json.Marshal(entry)
	if err != nil {
		return LedgerEntry{}, err
	}
	if _, err := l.file.Write(append(line, '\n')); err != nil {
		return LedgerEntry{}, err
	}
	if err := l.file.Sync(); err != nil {
		return LedgerEntry{}, err
	}
	l.nextSeq++
	l.balance += entry.AmountLuna
	return entry, nil
}

func (l *EscrowLedger) Balance() int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.balance
}

func (l *EscrowLedger) Close() error {
	return l.file.Close()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run TestEscrowLedger -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/marketplace_ledger.go backend/marketplace_ledger_test.go
git commit -m "feat: add append-only escrow ledger"
```

---

### Task 4: Macro finality + `TransactionSigner` on `NimiqRPC`

**Files:**
- Modify: `backend/nimiq_rpc.go`
- Create: `backend/marketplace_signer.go`
- Test: `backend/nimiq_rpc_test.go`
- Test: `backend/marketplace_signer_test.go`

**Interfaces:**
- Produces: `(*NimiqRPC) GetLastMacroBlockNumber() (uint64, error)`; `TransactionSigner` interface with `SendBasicTransactionWithData(sender, recipient string, valueLuna uint64, dataHex string) (txHash string, err error)`; `(*NimiqRPC) SendBasicTransactionWithData(...)` implementing it; `fakeSigner` test double (in `marketplace_signer_test.go`, but exported within the package for reuse by Task 6's tests).
- Also adds `Value uint64` to the existing `rpcTx` struct (needed so the escrow watcher in Task 5 can verify a deposit's exact amount).

- [ ] **Step 1: Write the failing tests**

Add to `backend/nimiq_rpc_test.go`:

```go
func TestGetLastMacroBlockNumber(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getLastMacroBlock": `{"number": 4200}`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	got, err := rpc.GetLastMacroBlockNumber()
	if err != nil {
		t.Fatal(err)
	}
	if got != 4200 {
		t.Fatalf("want 4200, got %d", got)
	}
}

func TestSendBasicTransactionWithData(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"sendBasicTransactionWithData": `"deadbeef"`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	hash, err := rpc.SendBasicTransactionWithData("NQ11 ESCROW", "NQ22 SELLER", 950, "")
	if err != nil {
		t.Fatal(err)
	}
	if hash != "deadbeef" {
		t.Fatalf("want deadbeef, got %q", hash)
	}
}
```

Create `backend/marketplace_signer_test.go`:

```go
package main

import "testing"

func TestFakeSignerRecordsCalls(t *testing.T) {
	signer := newFakeSigner()
	hash, err := signer.SendBasicTransactionWithData("NQ11 ESCROW", "NQ22 SELLER", 950, "")
	if err != nil {
		t.Fatal(err)
	}
	if hash == "" {
		t.Fatal("expected a non-empty fake tx hash")
	}
	if len(signer.calls) != 1 || signer.calls[0].recipient != "NQ22 SELLER" || signer.calls[0].valueLuna != 950 {
		t.Fatalf("expected recorded call, got %+v", signer.calls)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestGetLastMacroBlockNumber|TestSendBasicTransactionWithData|TestFakeSignerRecordsCalls' -v`
Expected: FAIL — none of these exist yet.

- [ ] **Step 3: Implement**

Add to `backend/nimiq_rpc.go` (extend `rpcTx` and add the two methods):

```go
type rpcTx struct {
	Hash             string `json:"hash"`
	Sender           string `json:"sender"`
	From             string `json:"from"`
	Recipient        string `json:"recipient"`
	To               string `json:"to"`
	Data             string `json:"data"`
	RecipientData    string `json:"recipientData"`
	Value            uint64 `json:"value"`
	BlockNumber      uint64 `json:"blockNumber"`
	TransactionIndex uint64 `json:"transactionIndex"`
	FromType         int    `json:"fromType"`
	ToType           int    `json:"toType"`
}
```

```go
// GetLastMacroBlockNumber returns the height of the chain's most recent
// macro-finalized block. A transaction at or before this height is final —
// a later micro block can still be reorganized away.
func (c *NimiqRPC) GetLastMacroBlockNumber() (uint64, error) {
	var block struct {
		Number uint64 `json:"number"`
	}
	if err := c.call("getLastMacroBlock", []any{}, &block); err != nil {
		return 0, err
	}
	return block.Number, nil
}

// SendBasicTransactionWithData asks the connected node to sign and broadcast
// a transaction from `sender`'s own wallet. This only works against a node
// that has that account's private key imported and unlocked — never point
// this at the public read-only gateway used elsewhere in this file. The
// exact RPC method name and parameter order here must be confirmed against
// whichever node/wallet setup ends up running the escrow signer in
// production before this goes live (see this plan's Global Constraints and
// the design spec's "Implementation gates").
func (c *NimiqRPC) SendBasicTransactionWithData(sender, recipient string, valueLuna uint64, dataHex string) (string, error) {
	var hash string
	if err := c.call("sendBasicTransactionWithData", []any{sender, recipient, dataHex, valueLuna, 0, nil}, &hash); err != nil {
		return "", err
	}
	return hash, nil
}
```

Create `backend/marketplace_signer.go`:

```go
package main

// TransactionSigner sends a value transaction (with optional data) signed by
// a wallet the implementation controls. In production this must be backed
// by a dedicated, access-restricted Nimiq node with the escrow key imported
// — see NimiqRPC.SendBasicTransactionWithData's doc comment.
type TransactionSigner interface {
	SendBasicTransactionWithData(sender, recipient string, valueLuna uint64, dataHex string) (txHash string, err error)
}

type fakeSignerCall struct {
	sender, recipient string
	valueLuna         uint64
	dataHex           string
}

// fakeSigner is a TransactionSigner test double: it records every call and
// returns a deterministic fake hash, with no network or key material
// involved. Used by this file's own test and by the settlement worker's
// tests in Task 6.
type fakeSigner struct {
	calls []fakeSignerCall
	next  int
}

func newFakeSigner() *fakeSigner {
	return &fakeSigner{}
}

func (f *fakeSigner) SendBasicTransactionWithData(sender, recipient string, valueLuna uint64, dataHex string) (string, error) {
	f.calls = append(f.calls, fakeSignerCall{sender, recipient, valueLuna, dataHex})
	f.next++
	return fakeTxHash(f.next), nil
}

func fakeTxHash(n int) string {
	const hex = "0123456789abcdef"
	b := make([]byte, 8)
	for i := range b {
		b[i] = hex[n%16]
		n /= 16
	}
	return string(b)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestGetLastMacroBlockNumber|TestSendBasicTransactionWithData|TestFakeSignerRecordsCalls' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/nimiq_rpc.go backend/nimiq_rpc_test.go backend/marketplace_signer.go backend/marketplace_signer_test.go
git commit -m "feat: add macro-finality lookup and a TransactionSigner abstraction"
```

---

### Task 5: Escrow funding watcher

**Files:**
- Create: `backend/marketplace_escrow_watcher.go`
- Test: `backend/marketplace_escrow_watcher_test.go`

**Interfaces:**
- Consumes: `MarketplaceStore.FindTradeByReference`, `MarketplaceStore.Transition` (Task 2); `NimiqRPC.GetTransactionsByAddress`, `NimiqRPC.GetLastMacroBlockNumber` (Task 4); `claimantAddress`, `compactAddress`, `normalizeAddress` (existing, from `handles.go`/`address.go`).
- Produces: `EscrowReferencePrefix = "NME1:"` constant; `buildTradeReference() string` (16 random bytes, base64url); `parseTradeReference(dataHex string) string`; `NewEscrowWatcher(rpc *NimiqRPC, store *MarketplaceStore, escrowAddress string) *EscrowWatcher`; `(*EscrowWatcher) Sweep() error`.

- [ ] **Step 1: Write the failing tests**

```go
package main

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
)

func escrowSweepServer(t *testing.T, macroHeight uint64, txs []rpcTx) *httptest.Server {
	t.Helper()
	txsJSON, _ := json.Marshal(txs)
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
		}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &req)
		switch req.Method {
		case "getTransactionsByAddress":
			w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + string(txsJSON) + `}`))
		case "getLastMacroBlock":
			w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"number":` + strconv.FormatUint(macroHeight, 10) + `}}`))
		}
	}))
}

func depositTx(hash, sender string, valueLuna uint64, reference string, blockHeight uint64) rpcTx {
	data := hex.EncodeToString([]byte(EscrowReferencePrefix + reference))
	return rpcTx{
		Hash: hash, Sender: sender, Recipient: "NQ99 ESCROW", Data: data,
		Value: valueLuna, BlockNumber: blockHeight,
	}
}

func TestEscrowWatcher_FundsAMatchingMacroFinalizedDeposit(t *testing.T) {
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := store.ReserveListing("chuck", "t1", "the-ref", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)

	srv := escrowSweepServer(t, 100, []rpcTx{
		depositTx("d1", "NQ22 BUYER", 1000, "the-ref", 50), // block 50, well before macro height 100
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	if err := w.Sweep(); err != nil {
		t.Fatal(err)
	}

	got, _ := store.Resolve(trade.ID)
	if got.State != StateFunded || got.DepositTxHash != "d1" {
		t.Fatalf("expected FUNDED with deposit hash d1, got %+v", got)
	}
}

func TestEscrowWatcher_IgnoresDepositNotYetMacroFinalized(t *testing.T) {
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := store.ReserveListing("chuck", "t1", "the-ref", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)

	srv := escrowSweepServer(t, 40, []rpcTx{
		depositTx("d1", "NQ22 BUYER", 1000, "the-ref", 50), // block 50 > macro height 40
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	w.Sweep()

	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingDeposit {
		t.Fatalf("expected trade to remain AWAITING_DEPOSIT, got %s", got.State)
	}
}

func TestEscrowWatcher_IgnoresWrongAmountAndWrongPayer(t *testing.T) {
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := store.ReserveListing("chuck", "t1", "the-ref", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)

	srv := escrowSweepServer(t, 100, []rpcTx{
		depositTx("wrong-amount", "NQ22 BUYER", 500, "the-ref", 10),
		depositTx("wrong-payer", "NQ33 STRANGER", 1000, "the-ref", 10),
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	w.Sweep()

	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingDeposit {
		t.Fatalf("wrong-amount/wrong-payer deposits must not fund the trade, got %s", got.State)
	}
}

func TestEscrowWatcher_IgnoresUnattributableReference(t *testing.T) {
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	srv := escrowSweepServer(t, 100, []rpcTx{
		depositTx("d1", "NQ22 BUYER", 1000, "no-such-trade", 10),
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	if err := w.Sweep(); err != nil {
		t.Fatal(err) // must not error — just leaves it unattributed, no trade to update
	}
}

func TestBuildAndParseTradeReference_RoundTrips(t *testing.T) {
	ref := buildTradeReference()
	if len(ref) == 0 {
		t.Fatal("expected a non-empty reference")
	}
	dataHex := hex.EncodeToString([]byte(EscrowReferencePrefix + ref))
	if got := parseTradeReference(dataHex); got != ref {
		t.Fatalf("expected round-trip reference %q, got %q", ref, got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestEscrowWatcher|TestBuildAndParseTradeReference' -v`
Expected: FAIL — none of these exist yet.

- [ ] **Step 3: Implement the watcher**

```go
// backend/marketplace_escrow_watcher.go
package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

// EscrowReferencePrefix tags a trade's deposit transaction data so the
// watcher can attribute an incoming payment without guessing.
const EscrowReferencePrefix = "NME1:"

// buildTradeReference generates a random, URL-safe per-trade deposit
// reference — 16 random bytes, base64url-encoded (22 chars, no padding).
func buildTradeReference() string {
	b := make([]byte, 16)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// parseTradeReference extracts the reference from a deposit tx's hex data
// field, or "" if it doesn't carry one.
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

// EscrowWatcher polls the pooled escrow address's transaction history —
// HandleSyncer only watches the registry address, not this one — and funds
// a trade only when its deposit exactly matches the expected amount and
// payer and is macro-finalized. Anything else (wrong reference, amount,
// payer, or not yet final) is left alone for manual review rather than
// triggering an automatic refund.
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
		if tx.BlockNumber > macroHeight {
			continue // not yet macro-finalized
		}
		if tx.Value != trade.PriceLuna {
			continue // wrong amount — manual review, not auto-refunded
		}
		if compactAddress(normalizeAddress(tx.sender())) != compactAddress(trade.Buyer) {
			continue // wrong payer
		}
		txHash := tx.Hash
		w.store.Transition(trade.ID, StateAwaitingDeposit, StateFunded, func(t *MarketplaceTrade) {
			t.DepositTxHash = txHash
		})
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestEscrowWatcher|TestBuildAndParseTradeReference' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_escrow_watcher.go backend/marketplace_escrow_watcher_test.go
git commit -m "feat: add escrow funding watcher with macro-finality and payer/amount checks"
```

---

### Task 6: Idempotent settlement worker

**Files:**
- Create: `backend/marketplace_settlement.go`
- Test: `backend/marketplace_settlement_test.go`

**Interfaces:**
- Consumes: `MarketplaceStore.Resolve`/`Transition` (Task 2), `EscrowLedger.Append` (Task 3), `TransactionSigner`/`fakeSigner` (Task 4).
- Produces: `NewSettlementWorker(store *MarketplaceStore, ledger *EscrowLedger, signer TransactionSigner, escrowAddress string) *SettlementWorker`; `(*SettlementWorker) Settle(tradeID string) error`; `(*SettlementWorker) Refund(tradeID string) error`.

- [ ] **Step 1: Write the failing tests**

```go
package main

import (
	"path/filepath"
	"testing"
)

func settlementFixture(t *testing.T) (*MarketplaceStore, *EscrowLedger, *fakeSigner, *SettlementWorker, MarketplaceTrade) {
	t.Helper()
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	ledger, _ := OpenEscrowLedger(filepath.Join(t.TempDir(), "ledger.jsonl"))
	signer := newFakeSigner()
	worker := NewSettlementWorker(store, ledger, signer, "NQ99 ESCROW")

	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := store.ReserveListing("chuck", "t1", "ref1", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	store.Transition(trade.ID, StateAwaitingDeposit, StateFunded, func(tr *MarketplaceTrade) { tr.DepositTxHash = "d1" })
	store.Transition(trade.ID, StateFunded, StateAwaitingRelease, nil)
	store.Transition(trade.ID, StateAwaitingRelease, StateReleaseConfirming, func(tr *MarketplaceTrade) { tr.ReleaseTxHash = "r1" })
	store.Transition(trade.ID, StateReleaseConfirming, StateAwaitingClaim, nil)
	store.Transition(trade.ID, StateAwaitingClaim, StateClaimConfirming, func(tr *MarketplaceTrade) { tr.ClaimTxHash = "c1" })
	store.Transition(trade.ID, StateClaimConfirming, StateSettlementPending, nil)

	trade, _ = store.Resolve(trade.ID)
	return store, ledger, signer, worker, trade
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
	if len(signer.calls) != 1 || signer.calls[0].recipient != "NQ11 SELLER" || signer.calls[0].valueLuna != 950 {
		t.Fatalf("expected one payout call of 950 to the seller, got %+v", signer.calls)
	}
	if got := ledger.Balance(); got != -1000 {
		// -950 payout, -50 fee: full escrowed 1000 leaves the ledger balanced
		// against whatever recorded the +1000 deposit (not modeled by this
		// worker — the deposit-side entry belongs to the escrow watcher).
		t.Fatalf("expected ledger to record -950 payout and -50 fee (-1000 total), got %d", got)
	}
}

func TestSettle_IsIdempotent(t *testing.T) {
	store, _, signer, worker, trade := settlementFixture(t)
	worker.Settle(trade.ID)
	firstHash, _ := store.Resolve(trade.ID)

	if err := worker.Settle(trade.ID); err != nil {
		t.Fatal(err)
	}
	second, _ := store.Resolve(trade.ID)
	if len(signer.calls) != 1 {
		t.Fatalf("expected exactly one payout call across two Settle attempts, got %d", len(signer.calls))
	}
	if second.PayoutTxHash != firstHash.PayoutTxHash {
		t.Fatal("payout tx hash must not change on a repeated Settle call")
	}
}

func TestSettle_MarksAttemptedBeforeCallingSigner(t *testing.T) {
	// A crash after the signer succeeds but before the transition persists
	// must never cause a second automatic send. Simulate that window
	// directly against the store, bypassing the worker's normal path.
	store, _, signer, worker, trade := settlementFixture(t)
	store.Transition(trade.ID, StateSettlementPending, StateSettlementPending, func(tr *MarketplaceTrade) {
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
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	ledger, _ := OpenEscrowLedger(filepath.Join(t.TempDir(), "ledger.jsonl"))
	signer := newFakeSigner()
	worker := NewSettlementWorker(store, ledger, signer, "NQ99 ESCROW")

	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := store.ReserveListing("chuck", "t1", "ref1", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	store.Transition(trade.ID, StateAwaitingDeposit, StateFunded, func(tr *MarketplaceTrade) { tr.DepositTxHash = "d1" })
	store.Transition(trade.ID, StateFunded, StateRefundPending, nil)

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
	if len(signer.calls) != 1 || signer.calls[0].recipient != "NQ22 BUYER" || signer.calls[0].valueLuna != 1000 {
		t.Fatalf("expected a full-principal refund to the buyer, got %+v", signer.calls)
	}
	if got := ledger.Balance(); got != -1000 {
		t.Fatalf("expected ledger to record the full refund, got %d", got)
	}
}

func TestRefund_IsIdempotent(t *testing.T) {
	store, _, signer, worker, trade := refundFixture(t)
	worker.Refund(trade.ID)
	if err := worker.Refund(trade.ID); err != nil {
		t.Fatal(err)
	}
	if len(signer.calls) != 1 {
		t.Fatalf("expected exactly one refund call across two Refund attempts, got %d", len(signer.calls))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestSettle|TestRefund' -v`
Expected: FAIL — `SettlementWorker` doesn't exist yet.

- [ ] **Step 3: Implement the settlement worker**

```go
// backend/marketplace_settlement.go
package main

import (
	"fmt"
	"time"
)

// SettlementWorker pays the seller or refunds the buyer for a trade that has
// reached a terminal decision. Every payout/refund is guarded by a
// persisted "attempted" marker written before the signer is called: a crash
// between the signer succeeding and the transition persisting leaves that
// marker set with no recorded hash, which Settle/Refund treat as an
// ambiguous in-flight operation requiring manual reconciliation — never a
// reason to send a second, possibly duplicate, payment automatically.
type SettlementWorker struct {
	store         *MarketplaceStore
	ledger        *EscrowLedger
	signer        TransactionSigner
	escrowAddress string
}

func NewSettlementWorker(store *MarketplaceStore, ledger *EscrowLedger, signer TransactionSigner, escrowAddress string) *SettlementWorker {
	return &SettlementWorker{store: store, ledger: ledger, signer: signer, escrowAddress: escrowAddress}
}

// Settle pays the seller (price minus fee) once the trade has reached
// SETTLEMENT_PENDING (the caller is responsible for having already
// confirmed the bound buyer is the macro-finalized registry winner before
// reaching that state — this worker only moves money, it doesn't resolve
// ownership).
func (w *SettlementWorker) Settle(tradeID string) error {
	trade, ok := w.store.Resolve(tradeID)
	if !ok {
		return fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State == StateSettled {
		return nil // already done — idempotent no-op
	}
	if trade.PayoutAttemptedAt != 0 && trade.PayoutTxHash == "" {
		return fmt.Errorf("trade %q has an in-flight payout attempt with no recorded hash — needs manual reconciliation, not an automatic retry", tradeID)
	}

	now := time.Now().Unix()
	if err := w.store.Transition(tradeID, StateSettlementPending, StateSettlementPending, func(t *MarketplaceTrade) {
		t.PayoutAttemptedAt = now
	}); err != nil {
		return err
	}

	payout := trade.PriceLuna - trade.FeeLuna
	txHash, err := w.signer.SendBasicTransactionWithData(w.escrowAddress, trade.Seller, payout, "")
	if err != nil {
		return err
	}

	w.ledger.Append(LedgerEntry{TradeID: tradeID, Type: LedgerPayout, AmountLuna: -int64(payout), TxHash: txHash, Timestamp: now})
	w.ledger.Append(LedgerEntry{TradeID: tradeID, Type: LedgerFee, AmountLuna: -int64(trade.FeeLuna), Timestamp: now})

	return w.store.Transition(tradeID, StateSettlementPending, StateSettled, func(t *MarketplaceTrade) {
		t.PayoutTxHash = txHash
	})
}

// Refund returns the full escrowed principal to the buyer. NimConnect
// absorbs the outbound network fee and collects no marketplace fee on a
// failed trade — nothing here deducts trade.FeeLuna from the refund amount.
func (w *SettlementWorker) Refund(tradeID string) error {
	trade, ok := w.store.Resolve(tradeID)
	if !ok {
		return fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State == StateRefunded {
		return nil // already done — idempotent no-op
	}
	if trade.RefundAttemptedAt != 0 && trade.RefundTxHash == "" {
		return fmt.Errorf("trade %q has an in-flight refund attempt with no recorded hash — needs manual reconciliation, not an automatic retry", tradeID)
	}

	now := time.Now().Unix()
	fromState := trade.State
	if err := w.store.Transition(tradeID, fromState, fromState, func(t *MarketplaceTrade) {
		t.RefundAttemptedAt = now
	}); err != nil {
		return err
	}

	txHash, err := w.signer.SendBasicTransactionWithData(w.escrowAddress, trade.Buyer, trade.PriceLuna, "")
	if err != nil {
		return err
	}

	w.ledger.Append(LedgerEntry{TradeID: tradeID, Type: LedgerRefund, AmountLuna: -int64(trade.PriceLuna), TxHash: txHash, Timestamp: now})

	return w.store.Transition(tradeID, fromState, StateRefunded, func(t *MarketplaceTrade) {
		t.RefundTxHash = txHash
	})
}
```

Note: `Transition(tradeID, fromState, fromState, ...)` (same state to same state) is a deliberate reuse of the store's existing atomic-check-then-mutate primitive purely to persist the "attempted" marker — it doesn't change `State`, only runs `mutate` and bumps `Version`. `canTransitionTo` must allow a state transitioning to itself for this to work; add that to Task 1's rule:

Go back and adjust `backend/marketplace.go`'s `canTransitionTo`:

```go
func (s TradeState) canTransitionTo(next TradeState) bool {
	if s == next {
		return true // self-transition: used to persist a mutation (e.g. an "attempted" marker) without changing state
	}
	for _, allowed := range allowedTransitions[s] {
		if allowed == next {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestSettle|TestRefund|TestTradeStateTransitions' -v`
Expected: PASS — re-run the Task 1 state-machine tests too, since `canTransitionTo` changed.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace.go backend/marketplace_settlement.go backend/marketplace_settlement_test.go
git commit -m "feat: add idempotent settlement worker for payouts and refunds"
```

---

## Self-Review Notes

- **Spec coverage:** Covers "Marketplace architecture" (store as the authoritative server, escrow watcher separate from `HandleSyncer`), "Pooled escrow and deposit reference" (reference format, exact-amount/payer/macro-finality checks, manual review over auto-refund), "Trade state machine" (full transition table), "Persisted state and accounting" (`marketplace_listings`/`marketplace_trades`/`escrow_ledger` — implemented as the store + ledger, not SQL tables, per this plan's Architecture note), and the settlement half of "Pay or refund" / custody's "never construct a second payment" rule. Deliberately **not** covered here (next plan): the HTTP API, signed listing/purchase intents, Hub vs. Nimiq Pay wallet choreography, `validityStartHeight` freshness handling, reorg rollback of provisional state, rate limiting, key isolation, and the operational reconciliation/pause controls.
- **Placeholder scan:** No TBDs; every step has runnable code. The one deliberately flagged uncertainty (`sendBasicTransactionWithData`'s exact RPC method name/params) is called out explicitly as needing confirmation before production use, not hidden — it's isolated behind `TransactionSigner` so nothing else in this plan depends on getting that detail right today.
- **Type consistency:** `MarketplaceTrade`, `TradeState`, `LedgerEntry`, `TransactionSigner` are used with identical field/method names across every task that touches them (checked `Transition`'s signature against Task 2's definition and Task 6's every call site; checked `fakeSigner` from Task 4 is what Task 6's tests import, not a redefinition).
