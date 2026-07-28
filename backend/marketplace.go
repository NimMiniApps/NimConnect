package main

// TradeState is the persisted lifecycle of one marketplace trade.
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
}

func (s TradeState) canTransitionTo(next TradeState) bool {
	if s == next {
		return true // Persist an atomic mutation without changing lifecycle state.
	}
	for _, allowed := range allowedTransitions[s] {
		if allowed == next {
			return true
		}
	}
	return false
}

// MarketplaceListing is one seller's offer to sell an owned handle at a fixed
// price. Status is "active", "reserved", "sold", or "canceled".
type MarketplaceListing struct {
	Handle               string `json:"handle"`
	Seller               string `json:"seller"`
	PriceLuna            uint64 `json:"price_luna"`
	FeeLuna              uint64 `json:"fee_luna"`
	Status               string `json:"status"`
	OwnershipEpochTxHash string `json:"ownership_epoch_tx_hash"`
	CreatedAt            int64  `json:"created_at"`
}

// MarketplaceTrade is one buyer's attempt to complete a listing.
type MarketplaceTrade struct {
	ID                 string     `json:"id"`
	Reference          string     `json:"reference"`
	Handle             string     `json:"handle"`
	Buyer              string     `json:"buyer"`
	Seller             string     `json:"seller"`
	PriceLuna          uint64     `json:"price_luna"`
	FeeLuna            uint64     `json:"fee_luna"`
	EscrowAddress      string     `json:"escrow_address,omitempty"`
	State              TradeState `json:"state"`
	Version            uint64     `json:"version"`
	DepositTxHash      string     `json:"deposit_tx_hash,omitempty"`
	DepositBlockHeight uint64     `json:"deposit_block_height,omitempty"`
	ReleaseTxHash      string     `json:"release_tx_hash,omitempty"`
	ClaimTxHash        string     `json:"claim_tx_hash,omitempty"`
	PayoutAttemptedAt  int64      `json:"payout_attempted_at,omitempty"`
	PayoutTxHash       string     `json:"payout_tx_hash,omitempty"`
	RefundAttemptedAt  int64      `json:"refund_attempted_at,omitempty"`
	RefundTxHash       string     `json:"refund_tx_hash,omitempty"`
	CreatedAt          int64      `json:"created_at"`
	UpdatedAt          int64      `json:"updated_at"`
}
