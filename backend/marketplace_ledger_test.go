package main

import (
	"testing"
)

func TestEscrowLedger_AppendAndBalance(t *testing.T) {
	l := newTestEscrowLedger(t)
	defer l.Close()

	l.Append(LedgerEntry{TradeID: "t1", Type: LedgerDeposit, AmountLuna: 1000})
	l.Append(LedgerEntry{TradeID: "t1", Type: LedgerPayout, AmountLuna: -950})
	l.Append(LedgerEntry{TradeID: "t1", Type: LedgerFee, AmountLuna: -50})

	if got := l.Balance(); got != 0 {
		t.Fatalf("expected balanced ledger (0), got %d", got)
	}
}

func TestEscrowLedger_SequenceNumbersAreMonotonic(t *testing.T) {
	l := newTestEscrowLedger(t)
	defer l.Close()

	e1, err := l.Append(LedgerEntry{TradeID: "t1", Type: LedgerDeposit, AmountLuna: 100})
	if err != nil {
		t.Fatal(err)
	}
	e2, err := l.Append(LedgerEntry{TradeID: "t2", Type: LedgerDeposit, AmountLuna: 200})
	if err != nil {
		t.Fatal(err)
	}
	if e2.Sequence != e1.Sequence+1 {
		t.Fatalf("expected monotonic sequence, got %d then %d", e1.Sequence, e2.Sequence)
	}
}

func TestEscrowLedger_PersistsAndReplaysAcrossRestart(t *testing.T) {
	db := withTestDB(t)
	l, err := OpenEscrowLedger(db)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.Append(LedgerEntry{TradeID: "t1", Type: LedgerDeposit, AmountLuna: 1000}); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Append(LedgerEntry{TradeID: "t1", Type: LedgerRefund, AmountLuna: -1000}); err != nil {
		t.Fatal(err)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenEscrowLedger(db)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if got := reopened.Balance(); got != 0 {
		t.Fatalf("expected balance to survive restart via replay, got %d", got)
	}
	next, err := reopened.Append(LedgerEntry{TradeID: "t2", Type: LedgerDeposit, AmountLuna: 500})
	if err != nil {
		t.Fatal(err)
	}
	if next.Sequence != 3 {
		t.Fatalf("expected sequence 3 after replaying 2 entries, got %d", next.Sequence)
	}
}
