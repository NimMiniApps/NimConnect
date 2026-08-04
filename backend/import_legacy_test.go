package main

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeLegacyFixtures(t *testing.T, dir string) LegacyPaths {
	t.Helper()

	marketplacePath := filepath.Join(dir, "marketplace.json")
	marketplace := legacyMarketplaceSnapshot{
		Listings: map[string]MarketplaceListing{
			"chuck": {
				Handle: "chuck", Seller: "NQ11 SELLER", PriceLuna: 1000, FeeLuna: 50,
				Status: "active", OwnershipEpochTxHash: "tx1", CreatedAt: 1700000000,
			},
		},
		Trades: map[string]MarketplaceTrade{
			"t1": {
				ID: "t1", Reference: "ref1", Handle: "chuck",
				Buyer: "NQ22 BUYER", Seller: "NQ11 SELLER",
				PriceLuna: 1000, FeeLuna: 50, State: StateReserved, Version: 1,
				DepositDeadline: 1700001800, CreatedAt: 1700000001, UpdatedAt: 1700000001,
			},
		},
		Nonces: map[string]bool{"nonce-1": true},
	}
	writeJSONFile(t, marketplacePath, marketplace)

	ledgerPath := filepath.Join(dir, "marketplace_ledger.jsonl")
	writeFile(t, ledgerPath, strings.Join([]string{
		`{"sequence":1,"trade_id":"t1","type":"deposit","amount_luna":1000,"tx_hash":"dep1","timestamp":1700000100}`,
		`{"sequence":2,"trade_id":"t1","type":"fee","amount_luna":-50,"timestamp":1700000200}`,
	}, "\n")+"\n")

	statsPath := filepath.Join(dir, "stats.json")
	writeJSONFile(t, statsPath, legacyStatsFile{
		Days: map[string]*DayStats{
			"2026-07-13": {Wallets: map[string]bool{"NQ11OWNER": true}, Opens: 2},
		},
	})

	handlesPath := filepath.Join(dir, "handles.json")
	writeJSONFile(t, handlesPath, map[string]HandleClaim{
		"chuck": {
			Handle: "chuck", Address: "NQ11 OWNER", TxHash: "claim1",
			BlockHeight: 100, TxIndex: 0, ClaimedAt: 1700000000,
		},
	})

	profilesDir := filepath.Join(dir, "profiles")
	if err := os.MkdirAll(profilesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	profilePath := filepath.Join(profilesDir, "NQ11OWNER.json")
	writeJSONFile(t, profilePath, StoredProfile{
		Address: "NQ11 OWNER", UpdatedAt: 1000, Profile: `{"display_name":"Chuck"}`,
		PublicKey: "abc", Signature: "sig",
	})

	inboxDir := filepath.Join(dir, "inbox")
	mailboxDir := filepath.Join(inboxDir, "NQ22BUYER")
	if err := os.MkdirAll(mailboxDir, 0o755); err != nil {
		t.Fatal(err)
	}
	msgID := newMessageID()
	inboxPath := filepath.Join(mailboxDir, msgID+".json")
	writeJSONFile(t, inboxPath, InboxMessage{
		Version: 1, Type: "payment-request", ID: msgID, ObjectID: "obj1",
		Nonce: testNonce, Sender: "NQ11 OWNER", Recipient: "NQ22 BUYER",
		Payload: "{}", SentAt: 1700000000, ReceivedAt: 1700000001,
		PublicKey: "abc", Signature: "sig",
	})

	return LegacyPaths{
		Marketplace: marketplacePath,
		Ledger:      ledgerPath,
		Stats:       statsPath,
		Handles:     handlesPath,
		ProfilesDir: profilesDir,
		InboxDir:    inboxDir,
	}
}

func writeJSONFile(t *testing.T, path string, v any) {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, path, string(data))
}

func writeFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}

func countRows(t *testing.T, db *sql.DB, query string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(query).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestImportLegacyWhenEmpty(t *testing.T) {
	db := withTestDB(t)
	dir := t.TempDir()
	paths := writeLegacyFixtures(t, dir)

	imported, err := ImportLegacyIfEmpty(db, paths)
	if err != nil {
		t.Fatal(err)
	}
	if !imported {
		t.Fatal("expected import")
	}

	if got := countRows(t, db, `SELECT COUNT(*) FROM marketplace_listings`); got != 1 {
		t.Fatalf("marketplace_listings = %d, want 1", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM marketplace_trades`); got != 1 {
		t.Fatalf("marketplace_trades = %d, want 1", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM marketplace_nonces`); got != 1 {
		t.Fatalf("marketplace_nonces = %d, want 1", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM escrow_ledger`); got != 2 {
		t.Fatalf("escrow_ledger = %d, want 2", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM stats_days`); got != 1 {
		t.Fatalf("stats_days = %d, want 1", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM handle_claims`); got != 1 {
		t.Fatalf("handle_claims = %d, want 1", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM profiles`); got != 1 {
		t.Fatalf("profiles = %d, want 1", got)
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM inbox_messages`); got != 1 {
		t.Fatalf("inbox_messages = %d, want 1", got)
	}

	for _, src := range []string{paths.Marketplace, paths.Ledger, paths.Stats, paths.Handles} {
		if _, err := os.Stat(src); !os.IsNotExist(err) {
			t.Fatalf("expected source %q to be renamed away, stat err=%v", src, err)
		}
		matches, _ := filepath.Glob(src + ".imported-*")
		if len(matches) != 1 {
			t.Fatalf("expected one imported rename for %q, got %v", src, matches)
		}
	}

	imported2, err := ImportLegacyIfEmpty(db, paths)
	if err != nil || imported2 {
		t.Fatalf("second call should no-op: imported=%v err=%v", imported2, err)
	}
}

func TestImportLegacySkipsWhenDBHasData(t *testing.T) {
	db := withTestDB(t)
	dir := t.TempDir()
	paths := writeLegacyFixtures(t, dir)

	if _, err := db.Exec(`INSERT INTO profiles (address, payload, updated_at, public_key, signature)
		VALUES ('NQ99 EXIST', '{}', 1, 'pk', 'sig')`); err != nil {
		t.Fatal(err)
	}

	imported, err := ImportLegacyIfEmpty(db, paths)
	if err != nil {
		t.Fatal(err)
	}
	if imported {
		t.Fatal("expected no import when DB already has data")
	}
	if _, err := os.Stat(paths.Marketplace); err != nil {
		t.Fatalf("source file should remain when import skipped: %v", err)
	}
}

func TestImportLegacyMissingFilesOK(t *testing.T) {
	db := withTestDB(t)
	dir := t.TempDir()

	imported, err := ImportLegacyIfEmpty(db, LegacyPaths{
		Marketplace: filepath.Join(dir, "missing-marketplace.json"),
		Ledger:      filepath.Join(dir, "missing-ledger.jsonl"),
		Stats:       filepath.Join(dir, "missing-stats.json"),
		Handles:     filepath.Join(dir, "missing-handles.json"),
		ProfilesDir: filepath.Join(dir, "missing-profiles"),
		InboxDir:    filepath.Join(dir, "missing-inbox"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if imported {
		t.Fatal("expected no import when all sources are missing")
	}
}

func TestImportLegacyCorruptFileAborts(t *testing.T) {
	db := withTestDB(t)
	dir := t.TempDir()
	paths := writeLegacyFixtures(t, dir)
	writeFile(t, paths.Stats, "{not-json")

	imported, err := ImportLegacyIfEmpty(db, paths)
	if err == nil {
		t.Fatal("expected error for corrupt stats file")
	}
	if imported {
		t.Fatal("expected imported=false on failure")
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM marketplace_listings`); got != 0 {
		t.Fatalf("expected no partial import, got %d listings", got)
	}
	if _, err := os.Stat(paths.Stats); err != nil {
		t.Fatalf("corrupt stats file should remain untouched: %v", err)
	}
	if _, err := os.Stat(paths.Marketplace); err != nil {
		t.Fatalf("marketplace file should remain untouched on abort: %v", err)
	}
}

func TestImportLegacyPartialSourcesOnly(t *testing.T) {
	db := withTestDB(t)
	dir := t.TempDir()
	statsPath := filepath.Join(dir, "stats.json")
	writeJSONFile(t, statsPath, legacyStatsFile{
		Days: map[string]*DayStats{
			time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC).Format("2006-01-02"): {
				Wallets: map[string]bool{"NQ11OWNER": true},
				Opens:   1,
			},
		},
	})

	imported, err := ImportLegacyIfEmpty(db, LegacyPaths{Stats: statsPath})
	if err != nil {
		t.Fatal(err)
	}
	if !imported {
		t.Fatal("expected partial import")
	}
	if got := countRows(t, db, `SELECT COUNT(*) FROM stats_days`); got != 1 {
		t.Fatalf("stats_days = %d, want 1", got)
	}
	matches, _ := filepath.Glob(statsPath + ".imported-*")
	if len(matches) != 1 {
		t.Fatalf("expected stats file renamed, got %v", matches)
	}
}
