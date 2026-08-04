package main

import (
	"database/sql"
	"os"
	"testing"
)

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://nimconnect:nimconnect@127.0.0.1:5432/nimconnect?sslmode=disable"
	}
	return url
}

func withTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := OpenDB(testDatabaseURL(t))
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
		TRUNCATE marketplace_listings, marketplace_trades, marketplace_nonces,
		escrow_ledger, profiles, stats_day_wallets, stats_days,
		inbox_messages, handle_claims, friendships
		RESTART IDENTITY CASCADE`)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func newTestMarketplaceStore(t *testing.T) *MarketplaceStore {
	t.Helper()
	return NewMarketplaceStore(withTestDB(t))
}

func newTestEscrowLedger(t *testing.T) *EscrowLedger {
	t.Helper()
	db := withTestDB(t)
	ledger, err := OpenEscrowLedger(db)
	if err != nil {
		t.Fatal(err)
	}
	return ledger
}

func newTestMarketplaceAndLedger(t *testing.T) (*MarketplaceStore, *EscrowLedger) {
	t.Helper()
	db := withTestDB(t)
	store := NewMarketplaceStore(db)
	ledger, err := OpenEscrowLedger(db)
	if err != nil {
		t.Fatal(err)
	}
	return store, ledger
}

func newTestProfileStore(t *testing.T) *ProfileStore {
	t.Helper()
	return NewProfileStore(withTestDB(t))
}

func newTestStats(t *testing.T) *Stats {
	t.Helper()
	return NewStats(withTestDB(t))
}

func newTestInboxStore(t *testing.T) *InboxStore {
	t.Helper()
	return NewInboxStore(withTestDB(t))
}

func newTestHandleRegistry(t *testing.T, reserved map[string]bool, releaseActivationHeight uint64) *HandleRegistry {
	t.Helper()
	return NewHandleRegistry(withTestDB(t), reserved, releaseActivationHeight)
}
