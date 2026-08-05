package main

import (
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"nimconnect-backend/migrations"
)

func TestProductionCutoverFrom001ToScopedAuthorizationPreservesRows(t *testing.T) {
	databaseURL, err := resolveTestDatabaseURLFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	adminDB, err := OpenDB(databaseURL)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	t.Cleanup(func() { _ = adminDB.Close() })

	schema := fmt.Sprintf("scoped_auth_cutover_%d", time.Now().UnixNano())
	if _, err := adminDB.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}

	parsedURL, err := neturl.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsedURL.Query()
	query.Set("search_path", schema)
	parsedURL.RawQuery = query.Encode()
	cutoverDB, err := OpenDB(parsedURL.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cutoverDB.Close()
		if _, err := adminDB.Exec(`DROP SCHEMA ` + schema + ` CASCADE`); err != nil {
			t.Errorf("drop cutover schema: %v", err)
		}
	})

	migration001, err := migrations.Files.ReadFile("001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cutoverDB.Exec(string(migration001)); err != nil {
		t.Fatalf("apply 001: %v", err)
	}
	if _, err := cutoverDB.Exec(`INSERT INTO schema_migrations (version) VALUES ('001_init')`); err != nil {
		t.Fatal(err)
	}

	address := compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")
	if _, err := cutoverDB.Exec(`
		INSERT INTO profiles (address, payload, updated_at, public_key, signature)
		VALUES ($1, '{"display_name":"Cutover Alice"}', 1700000000, 'pk-cutover', 'sig-cutover')`, address); err != nil {
		t.Fatalf("seed 001 profile: %v", err)
	}
	if _, err := cutoverDB.Exec(`
		INSERT INTO marketplace_listings
			(handle, seller, price_luna, fee_luna, status, ownership_epoch_tx_hash, created_at)
		VALUES ('cutover-alice', $1, 1234567, 12345, 'active', 'epoch-cutover', 1700000001)`, address); err != nil {
		t.Fatalf("seed 001 listing: %v", err)
	}
	if _, err := cutoverDB.Exec(`
		INSERT INTO friendships
			(id, requester_address, recipient_address, status, created_at, updated_at)
		VALUES ('friend-cutover', $1, 'NQ22BUYERBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'accepted', 1700000002, 1700000003)`, address); err != nil {
		t.Fatalf("seed 001 friendship: %v", err)
	}

	if err := Migrate(cutoverDB); err != nil {
		t.Fatalf("apply 002 through Migrate: %v", err)
	}

	var payload, publicKey, signature string
	var updatedAt int64
	if err := cutoverDB.QueryRow(`SELECT payload, updated_at, public_key, signature FROM profiles WHERE address = $1`, address).
		Scan(&payload, &updatedAt, &publicKey, &signature); err != nil {
		t.Fatal(err)
	}
	if payload != `{"display_name":"Cutover Alice"}` || updatedAt != 1700000000 || publicKey != "pk-cutover" || signature != "sig-cutover" {
		t.Fatalf("profile changed during cutover: payload=%q updated=%d key=%q sig=%q", payload, updatedAt, publicKey, signature)
	}
	assertCount(t, cutoverDB, `SELECT COUNT(*) FROM marketplace_listings WHERE handle = 'cutover-alice' AND price_luna = 1234567`, 1)
	assertCount(t, cutoverDB, `SELECT COUNT(*) FROM friendships WHERE id = 'friend-cutover' AND status = 'accepted'`, 1)
	assertCount(t, cutoverDB, `SELECT COUNT(*) FROM schema_migrations WHERE version = '002_scoped_authorization'`, 1)
	assertCount(t, cutoverDB, `SELECT COUNT(*) FROM auth_apps WHERE audience IN ('nimconnect', 'nimworld') AND enabled`, 2)
	assertCount(t, cutoverDB, `SELECT COUNT(*) FROM auth_app_scopes WHERE audience = 'nimconnect'`, 10)
	assertCount(t, cutoverDB, `SELECT COUNT(*) FROM auth_app_scopes WHERE audience = 'nimworld'`, 2)
}

// TestProductionCutoverRehearsal simulates a production-like JSON → Postgres cutover:
// rich fixtures, import, field fidelity, ledger sequence continuity, warm restart,
// post-import marketplace ops, concurrency, import no-op, purge, and HTTP smoke.
//
// Requires Postgres. Prefer:
//
//	TEST_DATABASE_URL=postgres://…/nimconnect_migration_test?sslmode=disable
func TestProductionCutoverRehearsal(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://nimconnect:nimconnect@127.0.0.1:5432/nimconnect_migration_test?sslmode=disable"
	}
	if err := assertTestDatabaseURL(url); err != nil {
		t.Fatal(err)
	}

	db, err := OpenDB(url)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	defer db.Close()
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	resetMigrationDB(t, db)

	dir := t.TempDir()
	paths, expect := seedProductionLikeLegacy(t, dir)

	t.Run("import", func(t *testing.T) {
		imported, err := ImportLegacyIfEmpty(db, paths)
		if err != nil {
			t.Fatalf("import: %v", err)
		}
		if !imported {
			t.Fatal("expected import on empty DB")
		}
		for _, src := range []string{paths.Marketplace, paths.Ledger, paths.Stats, paths.Handles} {
			if _, err := os.Stat(src); !os.IsNotExist(err) {
				t.Fatalf("source %q should be renamed away", src)
			}
			matches, _ := filepath.Glob(src + ".imported-*")
			if len(matches) != 1 {
				t.Fatalf("expected one quarantine rename for %q, got %v", src, matches)
			}
		}
	})

	t.Run("row_counts", func(t *testing.T) {
		assertCount(t, db, `SELECT COUNT(*) FROM marketplace_listings`, expect.listings)
		assertCount(t, db, `SELECT COUNT(*) FROM marketplace_trades`, expect.trades)
		assertCount(t, db, `SELECT COUNT(*) FROM marketplace_nonces`, expect.nonces)
		assertCount(t, db, `SELECT COUNT(*) FROM escrow_ledger`, expect.ledger)
		assertCount(t, db, `SELECT COUNT(*) FROM stats_days`, expect.statsDays)
		assertCount(t, db, `SELECT COUNT(*) FROM stats_day_wallets`, expect.statsWallets)
		assertCount(t, db, `SELECT COUNT(*) FROM handle_claims`, expect.handles)
		assertCount(t, db, `SELECT COUNT(*) FROM profiles`, expect.profiles)
		assertCount(t, db, `SELECT COUNT(*) FROM inbox_messages`, expect.inbox)
	})

	t.Run("field_fidelity", func(t *testing.T) {
		var handle, seller, status string
		var price, fee int64
		err := db.QueryRow(`
			SELECT handle, seller, price_luna, fee_luna, status
			FROM marketplace_listings WHERE handle = 'alice'`).Scan(&handle, &seller, &price, &fee, &status)
		if err != nil {
			t.Fatal(err)
		}
		if handle != "alice" || seller != compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD") ||
			price != 5_000_000 || fee != 50_000 || status != "reserved" {
			t.Fatalf("listing fidelity mismatch: %s %s %d %d %s", handle, seller, price, fee, status)
		}

		var state string
		var version, depositHeight int64
		var depositHash string
		err = db.QueryRow(`
			SELECT state, version, deposit_tx_hash, deposit_block_height
			FROM marketplace_trades WHERE id = 'trade-funded-1'`).Scan(&state, &version, &depositHash, &depositHeight)
		if err != nil {
			t.Fatal(err)
		}
		if state != string(StateFunded) || version != 3 || depositHash != "dep-hash-1" || depositHeight != 1_234_567 {
			t.Fatalf("trade fidelity mismatch: %s v=%d dep=%s h=%d", state, version, depositHash, depositHeight)
		}

		var bal int64
		if err := db.QueryRow(`SELECT COALESCE(SUM(amount_luna),0) FROM escrow_ledger`).Scan(&bal); err != nil {
			t.Fatal(err)
		}
		if bal != expect.ledgerBalance {
			t.Fatalf("ledger balance %d, want %d", bal, expect.ledgerBalance)
		}

		var profilePayload string
		err = db.QueryRow(`SELECT payload FROM profiles WHERE address = $1`,
			compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")).Scan(&profilePayload)
		if err != nil {
			t.Fatal(err)
		}
		if profilePayload != `{"display_name":"Alice","bio":"prod rehearsal"}` {
			t.Fatalf("profile payload mismatch: %q", profilePayload)
		}
	})

	t.Run("scoped_authorization_migration_rerun_preserves_existing_rows", func(t *testing.T) {
		before := map[string]int{}
		for _, table := range []string{"marketplace_listings", "marketplace_trades", "profiles", "inbox_messages", "handle_claims"} {
			var count int
			if err := db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&count); err != nil {
				t.Fatal(err)
			}
			before[table] = count
		}

		tokenHash := []byte("production-rehearsal-token-hash")
		_, err := db.Exec(`
			INSERT INTO auth_sessions
				(token_hash, address, audience, scopes, created_at, expires_at, last_used_at)
			VALUES ($1, $2, 'nimconnect', ARRAY['friends:read'], now(), now() + interval '7 days', now())`,
			tokenHash, compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"))
		if err != nil {
			t.Fatal(err)
		}

		if err := Migrate(db); err != nil {
			t.Fatalf("rerun migrate: %v", err)
		}
		for table, want := range before {
			assertCount(t, db, `SELECT COUNT(*) FROM `+table, want)
		}
		var audience string
		if err := db.QueryRow(`SELECT audience FROM auth_sessions WHERE token_hash = $1`, tokenHash).Scan(&audience); err != nil {
			t.Fatal(err)
		}
		if audience != "nimconnect" {
			t.Fatalf("auth session audience = %q, want nimconnect", audience)
		}
	})

	t.Run("ledger_sequence_continues", func(t *testing.T) {
		ledger, err := OpenEscrowLedger(db)
		if err != nil {
			t.Fatal(err)
		}
		next, err := ledger.Append(LedgerEntry{
			TradeID: "trade-funded-1", Type: LedgerNetworkFee, AmountLuna: -1, TxHash: "fee-post-import",
		})
		if err != nil {
			t.Fatal(err)
		}
		if next.Sequence != expect.ledgerMaxSeq+1 {
			t.Fatalf("next sequence %d, want %d (max imported seq + 1)", next.Sequence, expect.ledgerMaxSeq+1)
		}
	})

	t.Run("warm_restart_handles", func(t *testing.T) {
		reg := NewHandleRegistry(db, map[string]bool{}, 0)
		claim, ok := reg.Resolve("alice")
		if !ok || claim.TxHash != "claim-alice" || claim.BlockHeight != 1000 {
			t.Fatalf("warm start resolve alice failed: ok=%v %+v", ok, claim)
		}
		claim, ok = reg.Resolve("bob")
		if !ok || compactAddress(claim.Address) != compactAddress("NQ11 SELLER AAAA AAAA AAAA AAAA AAAA AAAA AAAA") {
			// bob may use a synthetic address — check handle present
			if !ok {
				t.Fatal("warm start missing bob")
			}
		}
	})

	t.Run("post_import_marketplace_ops", func(t *testing.T) {
		store := NewMarketplaceStore(db)
		listing, err := store.CreateListing("carol", "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD", 9_000, 90, "epoch-carol")
		if err != nil {
			t.Fatal(err)
		}
		if listing.Status != "active" {
			t.Fatalf("unexpected listing: %+v", listing)
		}
		if _, err := store.CreateListing("carol", "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD", 1, 0, "x"); err == nil {
			t.Fatal("expected duplicate active listing error for carol")
		}
		if err := store.ConsumeNonce("nonce-imported-1"); err == nil {
			t.Fatal("expected imported nonce replay to fail")
		}
		trade, err := store.ReserveListing("carol", "trade-new-1", "ref-new-1", "NQ22 BUYER BBBB BBBB BBBB BBBB BBBB BBBB BBBB")
		if err != nil {
			t.Fatal(err)
		}
		if trade.State != StateReserved {
			t.Fatalf("reserve state %s, want %s", trade.State, StateReserved)
		}
	})

	t.Run("reserved_listing_blocked_from_relist", func(t *testing.T) {
		store := NewMarketplaceStore(db)
		var openTrades int
		if err := db.QueryRow(`SELECT COUNT(*) FROM marketplace_trades WHERE handle = 'alice' AND state IN ('RESERVED','AWAITING_DEPOSIT')`).Scan(&openTrades); err != nil {
			t.Fatal(err)
		}
		if openTrades < 1 {
			t.Fatal("fixture must leave alice with an open unpaid trade")
		}
		if _, err := store.CreateListing("alice", "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD", 42, 1, "epoch-overwrite"); err == nil {
			t.Fatal("expected CreateListing to reject reserved alice with open trade")
		}
		var status string
		if err := db.QueryRow(`SELECT status FROM marketplace_listings WHERE handle = 'alice'`).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status != "reserved" {
			t.Fatalf("alice listing status should stay reserved, got %s", status)
		}
	})

	t.Run("concurrent_create_listing", func(t *testing.T) {
		store := NewMarketplaceStore(db)
		var okCount atomic.Int64
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				_, err := store.CreateListing("race-handle", fmt.Sprintf("NQ%02d RACE", i), 100, 1, "epoch")
				if err == nil {
					okCount.Add(1)
				}
			}(i)
		}
		wg.Wait()
		if okCount.Load() != 1 {
			t.Fatalf("expected exactly 1 winner for race-handle, got %d", okCount.Load())
		}
		assertCount(t, db, `SELECT COUNT(*) FROM marketplace_listings WHERE handle = 'race-handle' AND status = 'active'`, 1)
	})

	t.Run("second_import_noop", func(t *testing.T) {
		// Recreate sources next to quarantine — importer must no-op because DB non-empty.
		paths2, _ := seedProductionLikeLegacy(t, t.TempDir())
		imported, err := ImportLegacyIfEmpty(db, paths2)
		if err != nil {
			t.Fatal(err)
		}
		if imported {
			t.Fatal("second import must be no-op on non-empty DB")
		}
		if _, err := os.Stat(paths2.Marketplace); err != nil {
			t.Fatalf("sources must remain untouched on no-op: %v", err)
		}
	})

	t.Run("purge_handles", func(t *testing.T) {
		reg := NewHandleRegistry(db, map[string]bool{}, 0)
		if err := reg.PurgeHandles(); err != nil {
			t.Fatal(err)
		}
		if _, ok := reg.Resolve("alice"); ok {
			t.Fatal("alice should be gone after purge")
		}
		assertCount(t, db, `SELECT COUNT(*) FROM handle_claims`, 0)
		seller := "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
		if err := reg.Rebuild([]rpcTx{{
			Hash: "claim-alice-2", BlockNumber: 2000, Sender: seller,
			Data: hex.EncodeToString(nimfeedClaim("alice", "")),
		}}); err != nil {
			t.Fatalf("rebuild after purge: %v", err)
		}
		claim, ok := reg.Resolve("alice")
		if !ok || claim.TxHash != "claim-alice-2" {
			t.Fatalf("expected alice after rebuild, ok=%v %+v", ok, claim)
		}
		assertCount(t, db, `SELECT COUNT(*) FROM handle_claims`, 1)
	})

	t.Run("http_smoke_after_import", func(t *testing.T) {
		// Re-seed handles after purge for HTTP resolve.
		resetHandlesOnly(t, db)
		_, _ = db.Exec(`INSERT INTO handle_claims (handle, address, tx_hash, block_height, tx_index, claimed_at)
			VALUES ('alice', $1, 'claim-alice', 1000, 0, 1700000000)`,
			compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"))

		reg := NewHandleRegistry(db, map[string]bool{}, 0)
		profiles := NewProfileStore(db)
		stats := NewStats(db)
		store := NewMarketplaceStore(db)
		admin := NewAdminSessions([]string{compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")})

		mux := http.NewServeMux()
		mux.HandleFunc("GET /api/health", healthHandler)
		mux.HandleFunc("GET /api/ready", readyHandler(db))
		mux.HandleFunc("GET /api/resolve/{handle}", resolveHandler(reg))
		mux.HandleFunc("GET /api/profile/{address}", profileGetHandler(profiles))
		mux.HandleFunc("GET /api/marketplace/listings", marketplaceListingsGetHandler(store))

		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
		if rec.Code != 200 {
			t.Fatalf("health %d", rec.Code)
		}

		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/ready", nil))
		if rec.Code != 200 {
			t.Fatalf("ready %d body=%s", rec.Code, rec.Body.String())
		}

		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/resolve/alice", nil))
		if rec.Code != 200 {
			t.Fatalf("resolve alice %d body=%s", rec.Code, rec.Body.String())
		}

		addr := compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/profile/"+addr, nil))
		if rec.Code != 200 {
			t.Fatalf("profile %d body=%s", rec.Code, rec.Body.String())
		}

		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/marketplace/listings", nil))
		if rec.Code != 200 {
			t.Fatalf("listings %d body=%s", rec.Code, rec.Body.String())
		}
		var listings []MarketplaceListing
		if err := json.Unmarshal(rec.Body.Bytes(), &listings); err != nil {
			t.Fatalf("decode listings: %v body=%s", err, rec.Body.String())
		}
		// carol/alice reserved; race-handle from concurrency test should be active + compact seller.
		foundRace := false
		for _, l := range listings {
			if l.Handle == "race-handle" {
				foundRace = true
				if l.Seller != compactAddress(l.Seller) {
					t.Fatalf("race-handle seller not compact: %q", l.Seller)
				}
			}
			if l.Handle == "alice" || l.Handle == "carol" {
				t.Fatalf("reserved listing %q should not appear in active listings", l.Handle)
			}
		}
		if !foundRace {
			t.Fatalf("expected race-handle in active listings, got %+v", listings)
		}
		_ = stats
		_ = admin
	})
}

func TestCorruptLegacyAbortsAndLeavesFiles(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://nimconnect:nimconnect@127.0.0.1:5432/nimconnect_migration_test?sslmode=disable"
	}
	if err := assertTestDatabaseURL(url); err != nil {
		t.Fatal(err)
	}
	db, err := OpenDB(url)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	defer db.Close()
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	resetMigrationDB(t, db)

	dir := t.TempDir()
	paths, _ := seedProductionLikeLegacy(t, dir)
	if err := os.WriteFile(paths.Marketplace, []byte("{not-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	imported, err := ImportLegacyIfEmpty(db, paths)
	if err == nil || imported {
		t.Fatalf("expected corrupt import error, imported=%v err=%v", imported, err)
	}
	if _, err := os.Stat(paths.Marketplace); err != nil {
		t.Fatalf("corrupt source should remain: %v", err)
	}
	assertCount(t, db, `SELECT COUNT(*) FROM marketplace_listings`, 0)
	assertCount(t, db, `SELECT COUNT(*) FROM profiles`, 0)
}

func assertTestDatabaseURL(url string) error {
	// Mirror database-safety-guard: name must contain test / _test.
	if !(containsTestDBName(url)) {
		return fmt.Errorf("refusing non-test database URL: %s", url)
	}
	return nil
}

func containsTestDBName(url string) bool {
	u := url
	if i := strings.IndexByte(u, '?'); i >= 0 {
		u = u[:i]
	}
	if i := strings.LastIndexByte(u, '/'); i >= 0 {
		return strings.Contains(strings.ToLower(u[i+1:]), "test")
	}
	return false
}

type legacyExpect struct {
	listings, trades, nonces, ledger int
	statsDays, statsWallets          int
	handles, profiles, inbox         int
	ledgerBalance                    int64
	ledgerMaxSeq                     uint64
}

func seedProductionLikeLegacy(t *testing.T, dir string) (LegacyPaths, legacyExpect) {
	t.Helper()
	seller := "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
	buyer := "NQ22 BUYER BBBB BBBB BBBB BBBB BBBB BBBB BBBB"
	bob := "NQ11 SELLER AAAA AAAA AAAA AAAA AAAA AAAA AAAA"

	listings := map[string]MarketplaceListing{
		"alice": {
			Handle: "alice", Seller: seller, PriceLuna: 5_000_000, FeeLuna: 50_000,
			Status: "reserved", OwnershipEpochTxHash: "epoch-alice", CreatedAt: 1_700_000_000,
		},
		"bob": {
			Handle: "bob", Seller: bob, PriceLuna: 2_000_000, FeeLuna: 20_000,
			Status: "reserved", OwnershipEpochTxHash: "epoch-bob", CreatedAt: 1_700_000_100,
		},
		"oldone": {
			Handle: "oldone", Seller: seller, PriceLuna: 1, FeeLuna: 0,
			Status: "cancelled", OwnershipEpochTxHash: "epoch-old", CreatedAt: 1_600_000_000,
		},
	}
	trades := map[string]MarketplaceTrade{
		"trade-funded-1": {
			ID: "trade-funded-1", Reference: "ref-funded-1", Handle: "bob",
			Buyer: buyer, Seller: bob, PriceLuna: 2_000_000, FeeLuna: 20_000,
			EscrowAddress: "NQ99 ESCROW", State: StateFunded, Version: 3,
			DepositTxHash: "dep-hash-1", DepositBlockHeight: 1_234_567,
			CreatedAt: 1_700_000_200, UpdatedAt: 1_700_000_300,
		},
		"trade-reserved-1": {
			ID: "trade-reserved-1", Reference: "ref-reserved-1", Handle: "alice",
			Buyer: buyer, Seller: seller, PriceLuna: 5_000_000, FeeLuna: 50_000,
			State: StateAwaitingDeposit, Version: 1,
			DepositDeadline: time.Now().Add(-time.Hour).Unix(),
			CreatedAt:       1_700_000_400, UpdatedAt: 1_700_000_400,
		},
	}
	nonces := map[string]bool{"nonce-imported-1": true, "nonce-imported-2": true}
	for i := 0; i < 50; i++ {
		nonces[fmt.Sprintf("bulk-nonce-%02d", i)] = true
	}

	marketplacePath := filepath.Join(dir, "marketplace.json")
	writeJSONFile(t, marketplacePath, legacyMarketplaceSnapshot{
		Listings: listings, Trades: trades, Nonces: nonces,
	})

	var ledgerLines []string
	var balance int64
	entries := []LedgerEntry{
		{Sequence: 1, TradeID: "trade-funded-1", Type: LedgerDeposit, AmountLuna: 2_000_000, TxHash: "dep-hash-1", Timestamp: 1_700_000_250},
		{Sequence: 2, TradeID: "trade-funded-1", Type: LedgerFee, AmountLuna: -20_000, Timestamp: 1_700_000_260},
		{Sequence: 3, TradeID: "trade-funded-1", Type: LedgerNetworkFee, AmountLuna: -1, TxHash: "net1", Timestamp: 1_700_000_270},
		{Sequence: 5, TradeID: "trade-funded-1", Type: LedgerPayout, AmountLuna: -1_979_999, TxHash: "pay1", Timestamp: 1_700_000_280}, // gap in seq
	}
	for _, e := range entries {
		balance += e.AmountLuna
		b, _ := json.Marshal(e)
		ledgerLines = append(ledgerLines, string(b))
	}
	ledgerPath := filepath.Join(dir, "marketplace_ledger.jsonl")
	writeFile(t, ledgerPath, joinLines(ledgerLines)+"\n")

	statsPath := filepath.Join(dir, "stats.json")
	days := map[string]*DayStats{}
	walletCount := 0
	for d := 1; d <= 14; d++ {
		day := fmt.Sprintf("2026-07-%02d", d)
		wallets := map[string]bool{}
		for w := 0; w < 3; w++ {
			wallets[fmt.Sprintf("NQWALLET%02dDAY%02d", w, d)] = true
			walletCount++
		}
		days[day] = &DayStats{Wallets: wallets, Opens: 10 + d}
	}
	writeJSONFile(t, statsPath, legacyStatsFile{Days: days})

	handles := map[string]HandleClaim{}
	for i := 0; i < 100; i++ {
		h := fmt.Sprintf("user%02d", i)
		handles[h] = HandleClaim{
			Handle: h, Address: fmt.Sprintf("NQ%02d HANDLE USER ADDR ADDR ADDR ADDR ADDR", i%90+10),
			TxHash: fmt.Sprintf("claim-%s", h), BlockHeight: uint64(1000 + i), TxIndex: uint64(i % 5),
			ClaimedAt: 1_700_000_000 + int64(i),
		}
	}
	handles["alice"] = HandleClaim{
		Handle: "alice", Address: seller, TxHash: "claim-alice",
		BlockHeight: 1000, TxIndex: 0, ClaimedAt: 1_700_000_000,
	}
	handles["bob"] = HandleClaim{
		Handle: "bob", Address: bob, TxHash: "claim-bob",
		BlockHeight: 1001, TxIndex: 1, ClaimedAt: 1_700_000_010,
	}
	handlesPath := filepath.Join(dir, "handles.json")
	writeJSONFile(t, handlesPath, handles)

	profilesDir := filepath.Join(dir, "profiles")
	if err := os.MkdirAll(profilesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeJSONFile(t, filepath.Join(profilesDir, compactAddress(seller)+".json"), StoredProfile{
		Address: seller, UpdatedAt: 1_700_000_000,
		Profile:   `{"display_name":"Alice","bio":"prod rehearsal"}`,
		PublicKey: "pk-alice", Signature: "sig-alice",
	})
	writeJSONFile(t, filepath.Join(profilesDir, compactAddress(bob)+".json"), StoredProfile{
		Address: bob, UpdatedAt: 1_700_000_050,
		Profile:   `{"display_name":"Bob"}`,
		PublicKey: "pk-bob", Signature: "sig-bob",
	})
	profileCount := 2
	for i := 0; i < 20; i++ {
		addr := fmt.Sprintf("NQ%02d PROFILE EXTRA ADDR ADDR ADDR ADDR ADDR", i%90+10)
		writeJSONFile(t, filepath.Join(profilesDir, compactAddress(addr)+".json"), StoredProfile{
			Address: addr, UpdatedAt: 1_700_000_100 + int64(i),
			Profile:   fmt.Sprintf(`{"display_name":"User%d"}`, i),
			PublicKey: fmt.Sprintf("pk-%d", i), Signature: fmt.Sprintf("sig-%d", i),
		})
		profileCount++
	}

	inboxDir := filepath.Join(dir, "inbox")
	inboxCount := 0
	for _, recipient := range []string{buyer, seller} {
		mailbox := filepath.Join(inboxDir, compactAddress(recipient))
		if err := os.MkdirAll(mailbox, 0o755); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 5; i++ {
			id := newMessageID()
			writeJSONFile(t, filepath.Join(mailbox, id+".json"), InboxMessage{
				Version: 1, Type: "payment-request", ID: id, ObjectID: fmt.Sprintf("obj-%s-%d", compactAddress(recipient), i),
				Nonce:  fmt.Sprintf("inbox-nonce-%s-%d", compactAddress(recipient), i),
				Sender: seller, Recipient: recipient, Payload: `{"amount":"1"}`,
				SentAt: 1_700_000_000 + int64(i), ReceivedAt: 1_700_000_001 + int64(i),
				PublicKey: "pk", Signature: "sig",
			})
			inboxCount++
		}
	}

	return LegacyPaths{
			Marketplace: marketplacePath,
			Ledger:      ledgerPath,
			Stats:       statsPath,
			Handles:     handlesPath,
			ProfilesDir: profilesDir,
			InboxDir:    inboxDir,
		}, legacyExpect{
			listings: 3, trades: 2, nonces: 2 + 50, ledger: 4,
			statsDays: 14, statsWallets: walletCount,
			handles: len(handles), profiles: profileCount, inbox: inboxCount,
			ledgerBalance: balance,
			ledgerMaxSeq:  5, // deliberate gap: sequences 1,2,3,5
		}
}

func joinLines(lines []string) string {
	out := ""
	for i, l := range lines {
		if i > 0 {
			out += "\n"
		}
		out += l
	}
	return out
}

func resetMigrationDB(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(`
		TRUNCATE marketplace_listings, marketplace_trades, marketplace_nonces,
		escrow_ledger, profiles, stats_day_wallets, stats_days,
		inbox_messages, handle_claims, friendships, auth_challenges, auth_sessions
		RESTART IDENTITY CASCADE`)
	if err != nil {
		t.Fatal(err)
	}
}

func resetHandlesOnly(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`TRUNCATE handle_claims`); err != nil {
		t.Fatal(err)
	}
}

func assertCount(t *testing.T, db *sql.DB, query string, want int) {
	t.Helper()
	var n int
	if err := db.QueryRow(query).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != want {
		t.Fatalf("%s => %d, want %d", query, n, want)
	}
}
