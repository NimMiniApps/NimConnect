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
