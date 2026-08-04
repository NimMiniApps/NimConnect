package main

import (
	"database/sql"
	"time"
)

type LedgerEntryType string

const (
	LedgerDeposit    LedgerEntryType = "deposit"
	LedgerPayout     LedgerEntryType = "payout"
	LedgerRefund     LedgerEntryType = "refund"
	LedgerFee        LedgerEntryType = "fee"
	LedgerNetworkFee LedgerEntryType = "network_fee"
)

// LedgerEntry is one immutable line of the escrow ledger. AmountLuna is
// signed: money entering escrow is positive and money leaving is negative.
type LedgerEntry struct {
	Sequence   uint64          `json:"sequence"`
	TradeID    string          `json:"trade_id"`
	Type       LedgerEntryType `json:"type"`
	AmountLuna int64           `json:"amount_luna"`
	TxHash     string          `json:"tx_hash,omitempty"`
	Timestamp  int64           `json:"timestamp"`
}

// EscrowLedger is an append-only Postgres ledger. Corrections are represented
// by new compensating entries, never changes to existing rows.
type EscrowLedger struct {
	db *sql.DB
}

func OpenEscrowLedger(db *sql.DB) (*EscrowLedger, error) {
	return &EscrowLedger{db: db}, nil
}

func (l *EscrowLedger) Append(entry LedgerEntry) (LedgerEntry, error) {
	if entry.Timestamp == 0 {
		entry.Timestamp = time.Now().Unix()
	}
	err := l.db.QueryRow(`
		INSERT INTO escrow_ledger (trade_id, type, amount_luna, tx_hash, timestamp)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING sequence`,
		entry.TradeID, string(entry.Type), entry.AmountLuna, entry.TxHash, entry.Timestamp,
	).Scan(&entry.Sequence)
	if err != nil {
		return LedgerEntry{}, err
	}
	return entry, nil
}

func (l *EscrowLedger) Balance() int64 {
	var balance int64
	_ = l.db.QueryRow(`SELECT COALESCE(SUM(amount_luna), 0) FROM escrow_ledger`).Scan(&balance)
	return balance
}

func (l *EscrowLedger) Close() error {
	return nil
}
