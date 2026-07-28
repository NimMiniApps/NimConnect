package main

import (
	"fmt"
	"sync"
	"time"
)

// settlementChain is the linear post-funding sequence a trade walks through.
// A sweep may advance several stages after downtime; each hop still uses the
// store's transition table.
var settlementChain = []TradeState{
	StateAwaitingRelease,
	StateReleaseConfirming,
	StateAwaitingClaim,
	StateClaimConfirming,
	StateSettlementPending,
}

func chainIndex(state TradeState) int {
	for i, candidate := range settlementChain {
		if candidate == state {
			return i
		}
	}
	return -1
}

func walkChainTo(store *MarketplaceStore, tradeID string, target TradeState, mutate func(*MarketplaceTrade)) error {
	for {
		trade, ok := store.Resolve(tradeID)
		if !ok {
			return fmt.Errorf("no trade %q", tradeID)
		}
		if trade.State == target {
			return nil
		}
		index := chainIndex(trade.State)
		if index < 0 || index+1 >= len(settlementChain) {
			return fmt.Errorf("trade %q (state %s) cannot reach %s along the settlement chain", tradeID, trade.State, target)
		}
		next := settlementChain[index+1]
		var nextMutation func(*MarketplaceTrade)
		if next == target {
			nextMutation = mutate
		}
		if err := store.Transition(tradeID, trade.State, next, nextMutation); err != nil {
			return err
		}
	}
}

// walkChainToFailure moves a trade to FAILED_AFTER_RELEASE. That state is
// only reachable from RELEASE_CONFIRMING onward, so an awaiting-release trade
// is first advanced one step.
func walkChainToFailure(store *MarketplaceStore, tradeID string) error {
	trade, ok := store.Resolve(tradeID)
	if !ok {
		return fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State == StateAwaitingRelease {
		if err := store.Transition(tradeID, StateAwaitingRelease, StateReleaseConfirming, nil); err != nil {
			return err
		}
		trade, _ = store.Resolve(tradeID)
	}
	return store.Transition(tradeID, trade.State, StateFailedAfterRelease, nil)
}

const ownershipSweepCooldown = 5 * time.Second

// OwnershipWatcher recognizes a valid release-then-claim solely from
// HandleRegistry's canonical resolved state. It therefore recognizes valid
// protocol transactions that bypassed the marketplace HTTP API.
type OwnershipWatcher struct {
	rpc        *NimiqRPC
	store      *MarketplaceStore
	registry   *HandleRegistry
	settlement *SettlementWorker
	mu         sync.Mutex
	lastSweep  time.Time
}

func NewOwnershipWatcher(rpc *NimiqRPC, store *MarketplaceStore, registry *HandleRegistry, settlement *SettlementWorker) *OwnershipWatcher {
	return &OwnershipWatcher{rpc: rpc, store: store, registry: registry, settlement: settlement}
}

func (w *OwnershipWatcher) Sweep() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if time.Since(w.lastSweep) < ownershipSweepCooldown {
		return nil
	}
	macroHeight, err := w.rpc.GetLastMacroBlockNumber()
	if err != nil {
		return err
	}
	w.lastSweep = time.Now()

	for _, state := range settlementChain[:len(settlementChain)-1] {
		for _, trade := range w.store.TradesInState(state) {
			claim, ok := w.registry.Resolve(trade.Handle)
			if !ok || claim.BlockHeight > macroHeight {
				continue
			}
			switch compactAddress(claim.Address) {
			case compactAddress(trade.Buyer):
				if err := walkChainTo(w.store, trade.ID, StateSettlementPending, func(t *MarketplaceTrade) {
					t.ClaimTxHash = claim.TxHash
				}); err != nil {
					continue
				}
				if err := w.settlement.Settle(trade.ID); err != nil {
					return err
				}
			case compactAddress(trade.Seller):
				continue
			default:
				if err := walkChainToFailure(w.store, trade.ID); err != nil {
					continue
				}
				if err := w.store.Transition(trade.ID, StateFailedAfterRelease, StateRefundPending, nil); err != nil {
					continue
				}
				if err := w.settlement.Refund(trade.ID); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
