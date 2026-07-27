package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sync"
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

// EscrowLedger is an append-only JSONL ledger. Corrections are represented by
// new compensating entries, never changes to existing rows.
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
			if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
				existing.Close()
				return nil, fmt.Errorf("decode escrow ledger: %w", err)
			}
			l.balance += entry.AmountLuna
			if entry.Sequence >= l.nextSeq {
				l.nextSeq = entry.Sequence + 1
			}
		}
		if err := scanner.Err(); err != nil {
			existing.Close()
			return nil, fmt.Errorf("read escrow ledger: %w", err)
		}
		if err := existing.Close(); err != nil {
			return nil, err
		}
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
	if entry.Timestamp == 0 {
		entry.Timestamp = time.Now().Unix()
	}
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
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.file.Close()
}
