package main

import (
	"fmt"
	"time"
)

// SettlementWorker pays the seller or refunds the buyer after the trade has
// reached a terminal decision. It persists an attempt marker before every
// signing request so a crash in the signing window requires manual
// reconciliation rather than a potentially duplicate automatic payment.
type SettlementWorker struct {
	store         *MarketplaceStore
	ledger        *EscrowLedger
	signer        TransactionSigner
	escrowAddress string
}

func NewSettlementWorker(store *MarketplaceStore, ledger *EscrowLedger, signer TransactionSigner, escrowAddress string) *SettlementWorker {
	return &SettlementWorker{store: store, ledger: ledger, signer: signer, escrowAddress: escrowAddress}
}

func (w *SettlementWorker) Settle(tradeID string) error {
	trade, ok := w.store.Resolve(tradeID)
	if !ok {
		return fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State == StateSettled {
		return nil
	}
	if trade.State != StateSettlementPending {
		return fmt.Errorf("trade %q is in state %s, expected %s", tradeID, trade.State, StateSettlementPending)
	}
	if trade.PayoutAttemptedAt != 0 && trade.PayoutTxHash == "" {
		return fmt.Errorf("trade %q has an in-flight payout attempt with no recorded hash — needs manual reconciliation", tradeID)
	}
	if trade.FeeLuna > trade.PriceLuna {
		return fmt.Errorf("trade %q has a fee larger than its price", tradeID)
	}

	now := time.Now().Unix()
	trade, err := w.store.MarkPayoutAttempt(tradeID, now)
	if err != nil {
		return err
	}
	payout := trade.PriceLuna - trade.FeeLuna
	txHash, err := w.signer.SendBasicTransactionWithData(w.escrowAddress, trade.Seller, payout, "")
	if err != nil {
		return err
	}
	if _, err := w.ledger.Append(LedgerEntry{
		TradeID: tradeID, Type: LedgerPayout, AmountLuna: -int64(payout), TxHash: txHash, Timestamp: now,
	}); err != nil {
		return err
	}
	if _, err := w.ledger.Append(LedgerEntry{
		TradeID: tradeID, Type: LedgerFee, AmountLuna: -int64(trade.FeeLuna), Timestamp: now,
	}); err != nil {
		return err
	}
	return w.store.Transition(tradeID, StateSettlementPending, StateSettled, func(t *MarketplaceTrade) {
		t.PayoutTxHash = txHash
	})
}

func (w *SettlementWorker) Refund(tradeID string) error {
	trade, ok := w.store.Resolve(tradeID)
	if !ok {
		return fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State == StateRefunded {
		return nil
	}
	if trade.State != StateRefundPending {
		return fmt.Errorf("trade %q is in state %s, expected %s", tradeID, trade.State, StateRefundPending)
	}
	if trade.RefundAttemptedAt != 0 && trade.RefundTxHash == "" {
		return fmt.Errorf("trade %q has an in-flight refund attempt with no recorded hash — needs manual reconciliation", tradeID)
	}

	now := time.Now().Unix()
	trade, err := w.store.MarkRefundAttempt(tradeID, now)
	if err != nil {
		return err
	}
	txHash, err := w.signer.SendBasicTransactionWithData(w.escrowAddress, trade.Buyer, trade.PriceLuna, "")
	if err != nil {
		return err
	}
	if _, err := w.ledger.Append(LedgerEntry{
		TradeID: tradeID, Type: LedgerRefund, AmountLuna: -int64(trade.PriceLuna), TxHash: txHash, Timestamp: now,
	}); err != nil {
		return err
	}
	return w.store.Transition(tradeID, StateRefundPending, StateRefunded, func(t *MarketplaceTrade) {
		t.RefundTxHash = txHash
	})
}
