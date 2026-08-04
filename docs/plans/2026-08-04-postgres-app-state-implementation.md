# Postgres App-State Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Big-bang cutover of NimConnect backend app state from JSON/JSONL files to Postgres (marketplace, ledger, profiles, stats, inbox, handle cache), with one-shot import and no production file fallback.

**Architecture:** Add a Postgres service; backend requires `DATABASE_URL`, runs embedded SQL migrations on boot, optionally imports legacy files when the DB is empty, then serves via SQL-backed stores. Encrypted backups stay on disk. Design: `docs/plans/2026-08-04-postgres-app-state-design.md`.

**Tech Stack:** Go 1.24, `database/sql` + `github.com/jackc/pgx/v5/stdlib`, embed SQL migrations, Docker Compose / Swarm Postgres, `go test` with a disposable Postgres (Compose service or `TEST_DATABASE_URL`)

---

### Task 1: Postgres service + driver dependency

**Files:**
- Modify: `docker-compose.yml`
- Modify: `backend/go.mod` / `backend/go.sum` (via `go get`)
- Modify: `backend/README.md` (DATABASE_URL row)
- Note: update local Swarm stack (`docker-compose.homelab.yml` is gitignored) when deploying

**Step 1: Add Postgres to local Compose**

In `docker-compose.yml`, add:

```yaml
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: nimconnect
      POSTGRES_PASSWORD: nimconnect
      POSTGRES_DB: nimconnect
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nimconnect -d nimconnect"]
      interval: 5s
      timeout: 5s
      retries: 10
```

Add to `backend.environment`:

```yaml
      DATABASE_URL: postgres://nimconnect:nimconnect@postgres:5432/nimconnect?sslmode=disable
```

Add volume `postgres_data` under `volumes:`.

Backend should `depends_on` postgres with `condition: service_healthy` if Compose version supports it.

**Step 2: Add pgx stdlib driver**

Run:

```bash
cd backend && go get github.com/jackc/pgx/v5/stdlib
```

**Step 3: Document env**

Add `DATABASE_URL` (required) to `backend/README.md` configuration table. Mark JSON path envs as import-only / deprecated.

**Step 4: Commit**

```bash
git add docker-compose.yml backend/go.mod backend/go.sum backend/README.md
git commit -m "chore: add Postgres service and pgx driver"
```

---

### Task 2: DB open + embedded migrations

**Files:**
- Create: `backend/db.go`
- Create: `backend/db_test.go`
- Create: `backend/migrations/001_init.sql`
- Create: `backend/migrations/migrations.go` (embed FS)

**Step 1: Write failing test for Open + Migrate**

```go
package main

import (
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

func TestOpenAndMigrateCreatesSchema(t *testing.T) {
	db, err := OpenDB(testDatabaseURL(t))
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	defer db.Close()
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'marketplace_listings'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected marketplace_listings table, count=%d", n)
	}
}
```

**Step 2: Run test — expect fail**

Run: `cd backend && go test -run TestOpenAndMigrate -count=1`

Expected: FAIL — `OpenDB` / `Migrate` undefined

**Step 3: Migration SQL (`backend/migrations/001_init.sql`)**

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  handle TEXT PRIMARY KEY,
  seller TEXT NOT NULL,
  price_luna BIGINT NOT NULL CHECK (price_luna >= 0),
  fee_luna BIGINT NOT NULL CHECK (fee_luna >= 0),
  status TEXT NOT NULL,
  ownership_epoch_tx_hash TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_listings_one_active
  ON marketplace_listings (handle) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS marketplace_trades (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  buyer TEXT NOT NULL,
  seller TEXT NOT NULL,
  price_luna BIGINT NOT NULL,
  fee_luna BIGINT NOT NULL,
  escrow_address TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  deposit_tx_hash TEXT NOT NULL DEFAULT '',
  deposit_block_height BIGINT NOT NULL DEFAULT 0,
  release_tx_hash TEXT NOT NULL DEFAULT '',
  claim_tx_hash TEXT NOT NULL DEFAULT '',
  payout_attempted_at BIGINT NOT NULL DEFAULT 0,
  payout_tx_hash TEXT NOT NULL DEFAULT '',
  refund_attempted_at BIGINT NOT NULL DEFAULT 0,
  refund_tx_hash TEXT NOT NULL DEFAULT '',
  deposit_deadline BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS marketplace_trades_handle_state ON marketplace_trades (handle, state);
CREATE INDEX IF NOT EXISTS marketplace_trades_buyer ON marketplace_trades (buyer);
CREATE INDEX IF NOT EXISTS marketplace_trades_seller ON marketplace_trades (seller);

CREATE TABLE IF NOT EXISTS marketplace_nonces (
  nonce TEXT PRIMARY KEY,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escrow_ledger (
  sequence BIGSERIAL PRIMARY KEY,
  trade_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_luna BIGINT NOT NULL,
  tx_hash TEXT NOT NULL DEFAULT '',
  timestamp BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  address TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stats_days (
  day DATE PRIMARY KEY,
  opens INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stats_day_wallets (
  day DATE NOT NULL REFERENCES stats_days(day) ON DELETE CASCADE,
  address TEXT NOT NULL,
  PRIMARY KEY (day, address)
);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id TEXT PRIMARY KEY,
  version INT NOT NULL,
  type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload TEXT NOT NULL,
  sent_at BIGINT NOT NULL,
  received_at BIGINT NOT NULL,
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_messages_recipient ON inbox_messages (recipient);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_sender_nonce ON inbox_messages (sender, nonce);

CREATE TABLE IF NOT EXISTS handle_claims (
  handle TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_height BIGINT NOT NULL,
  tx_index BIGINT NOT NULL,
  claimed_at BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS handle_claims_address ON handle_claims (address);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  requester_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_active
  ON friendships (
    LEAST(requester_address, recipient_address),
    GREATEST(requester_address, recipient_address)
  ) WHERE status IN ('pending', 'accepted');
```

**Step 4: Implement OpenDB + Migrate**

```go
// backend/db.go — sketch
func OpenDB(databaseURL string) (*sql.DB, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func Migrate(db *sql.DB) error {
	// ensure schema_migrations, read embed FS, apply each file once in name order
}
```

`backend/migrations/migrations.go`:

```go
package migrations

import "embed"

//go:embed *.sql
var Files embed.FS
```

**Step 5: Run tests**

Run: `docker compose up -d postgres && cd backend && go test -run TestOpenAndMigrate -count=1`

Expected: PASS

**Step 6: Commit**

```bash
git add backend/db.go backend/db_test.go backend/migrations
git commit -m "feat: add Postgres open and initial schema migrations"
```

---

### Task 3: Test helper — clean DB per test

**Files:**
- Create: `backend/pgtest.go` (build-tagged or plain helper used by `*_test.go`)

**Step 1: Helper**

```go
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
	// Truncate all app tables between tests (not schema_migrations)
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
```

**Step 2: Commit**

```bash
git add backend/pgtest.go
git commit -m "test: add Postgres truncate helper for store tests"
```

---

### Task 4: SQL-backed MarketplaceStore + EscrowLedger

**Files:**
- Modify: `backend/marketplace_store.go` (constructor takes `*sql.DB`; remove JSON persist)
- Modify: `backend/marketplace_ledger.go` (SQL append / balance)
- Modify: `backend/marketplace_store_test.go`, `backend/marketplace_ledger_test.go`, callers in `*_test.go` / `main.go` later
- Keep method signatures used by handlers/watchers identical

**Step 1: Port one failing store test to DB**

Change `NewMarketplaceStore(path)` tests to `NewMarketplaceStore(withTestDB(t))`.

Example:

```go
func TestMarketplaceStore_PersistsAcrossRestart(t *testing.T) {
	db := withTestDB(t)
	s := NewMarketplaceStore(db)
	if _, err := s.CreateListing("alice", "NQ11...", 1000, 10, "tx"); err != nil {
		t.Fatal(err)
	}
	reloaded := NewMarketplaceStore(db)
	listings := reloaded.ActiveListings()
	if len(listings) != 1 || listings[0].Handle != "alice" {
		t.Fatalf("got %+v", listings)
	}
}
```

**Step 2: Run — expect fail** until constructor/SQL written

**Step 3: Implement**

- `ConsumeNonce`: `INSERT INTO marketplace_nonces`; unique violation → already used
- `CreateListing` / `ReserveListing` / `Transition` / expire / mark payout: single `BEGIN`…`COMMIT`; use `SELECT … FOR UPDATE` on trade/listing rows; bump `version` on transition
- `EscrowLedger.Append`: `INSERT … RETURNING sequence`; `Balance`: `SELECT COALESCE(SUM(amount_luna),0)`

Do **not** rewrite ledger rows.

**Step 4: Run full marketplace package tests**

Run: `cd backend && go test -count=1 -run 'Marketplace|EscrowLedger|Settlement|Watcher|Choreography'`

Expected: PASS (skip if no Postgres)

**Step 5: Commit**

```bash
git add backend/marketplace_store.go backend/marketplace_ledger.go backend/*marketplace* backend/*ledger* backend/*settlement* backend/*escrow*
git commit -m "feat: persist marketplace and escrow ledger in Postgres"
```

---

### Task 5: Profiles + Stats SQL stores

**Files:**
- Modify: `backend/profiles.go` (+ tests)
- Modify: `backend/stats.go` (+ tests)

**Step 1: Retarget tests to `withTestDB`**

**Step 2: Implement**

- Profiles: UPSERT by address; GET/DELETE as today
- Stats: `INSERT … ON CONFLICT` for day opens; wallet set via `stats_day_wallets`

**Step 3: Run**

`cd backend && go test -count=1 -run 'Profile|Stats'`

**Step 4: Commit**

```bash
git commit -am "feat: persist profiles and stats in Postgres"
```

---

### Task 6: Inbox SQL store

**Files:**
- Modify: `backend/inbox_store.go`
- Modify: `backend/inbox_store_test.go`

**Step 1: Retarget tests** from temp dirs to `withTestDB`

**Step 2: Implement** Put/List/Delete with recipient index + sender/nonce uniqueness matching current dedupe behavior

**Step 3: Run** `go test -count=1 -run Inbox`

**Step 4: Commit**

```bash
git commit -am "feat: persist inbox messages in Postgres"
```

---

### Task 7: HandleRegistry cache in Postgres

**Files:**
- Modify: `backend/handles_registry.go`
- Modify: `backend/handles_registry_test.go`, `backend/handles_sync_test.go`
- Create: admin resync hook in `backend/admin.go` / `backend/handles_handlers.go` (optional route)

**Step 1: Tests**

- Persist claims across `NewHandleRegistry(db, …)` reload
- `PurgeHandleClaims(db)` empties table
- Rebuild after purge repopulates

**Step 2: Implement**

- `Rebuild` computes map as today, then replaces table in one transaction (`DELETE` + `INSERT` or `TRUNCATE` + insert)
- Warm-start: load all rows into memory on construct (same in-memory read path for resolve speed)
- `PurgeHandles()` truncates `handle_claims` and clears in-memory map

**Step 3: Admin route (recommended)**

`POST /api/admin/handles/resync` (admin session): purge + trigger syncer sweep

**Step 4: Commit**

```bash
git commit -am "feat: store handle registry cache in Postgres with purge/resync"
```

---

### Task 8: One-shot legacy importer

**Files:**
- Create: `backend/import_legacy.go`
- Create: `backend/import_legacy_test.go`
- Create: `backend/testdata/legacy/` (small marketplace.json, ledger.jsonl, stats.json, handles.json, profile file, inbox message)

**Step 1: Failing test**

```go
func TestImportLegacyWhenEmpty(t *testing.T) {
	db := withTestDB(t)
	dir := t.TempDir()
	// write fixture files mirroring production shapes
	imported, err := ImportLegacyIfEmpty(db, LegacyPaths{
		Marketplace: filepath.Join(dir, "marketplace.json"),
		Ledger:      filepath.Join(dir, "marketplace_ledger.jsonl"),
		Stats:       filepath.Join(dir, "stats.json"),
		Handles:     filepath.Join(dir, "handles.json"),
		ProfilesDir: filepath.Join(dir, "profiles"),
		InboxDir:    filepath.Join(dir, "inbox"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !imported {
		t.Fatal("expected import")
	}
	// assert row counts
	imported2, err := ImportLegacyIfEmpty(db, LegacyPaths{ /* same */ })
	if err != nil || imported2 {
		t.Fatalf("second call should no-op: imported=%v err=%v", imported2, err)
	}
}
```

**Step 2: Implement**

- `isEmpty(db)`: no rows in `marketplace_trades` AND `profiles` AND `handle_claims` AND `stats_days` AND `inbox_messages` (or a single `app_meta.imported_at` — prefer checking core tables)
- Import in one transaction per domain (or one big transaction)
- On success, rename each source to `*.imported-<unix>` beside original
- Missing files are OK (partial deploys)
- Corrupt file → return error, abort, leave files untouched

**Step 3: Commit**

```bash
git commit -am "feat: one-shot import legacy JSON state into Postgres"
```

---

### Task 9: Wire `main.go` — DB required

**Files:**
- Modify: `backend/main.go`
- Modify: `backend/README.md`
- Update Compose env already done in Task 1

**Step 1: Startup sequence**

```go
db, err := OpenDB(secretEnv("DATABASE_URL"))
if err != nil {
	log.Fatalf("database: %v", err)
}
defer db.Close()
if err := Migrate(db); err != nil {
	log.Fatalf("migrate: %v", err)
}
if _, err := ImportLegacyIfEmpty(db, LegacyPaths{
	Marketplace: getEnv("MARKETPLACE_FILE", "/data/marketplace.json"),
	Ledger:      getEnv("MARKETPLACE_LEDGER_FILE", "/data/marketplace_ledger.jsonl"),
	Stats:       getEnv("STATS_FILE", "/data/stats.json"),
	Handles:     getEnv("HANDLES_FILE", "/data/handles.json"),
	ProfilesDir: getEnv("PROFILES_DIR", "/data/profiles"),
	InboxDir:    getEnv("INBOX_DIR", "/data/inbox"),
}); err != nil {
	log.Fatalf("legacy import: %v", err)
}

stats := NewStats(db)
inboxStore := NewInboxStore(db)
// registry / profiles / marketplace / ledger all take db
```

Remove JSON-only constructors from production path. Fail closed — no file store fallback.

**Step 2: Optional readiness**

Extend `/api/health` or add `/api/ready` that `Ping`s DB. Prefer keeping `/api/health` as liveness and adding `/api/ready` for orchestrators.

**Step 3: Run all backend tests**

```bash
cd backend && go test ./... -count=1
```

**Step 4: Commit**

```bash
git commit -am "feat: require Postgres at backend startup with legacy import"
```

---

### Task 10: Docs + friends plan alignment + deploy notes

**Files:**
- Modify: `backend/README.md` (ops: pg_dump, cutover)
- Modify: `docs/plans/2026-08-04-friends-social-graph-design.md` — persistence row → Postgres `friendships` (already migrated in 001)
- Modify: `docs/plans/2026-08-04-friends-social-graph-implementation.md` — replace JSON store tasks with SQL against `friendships`
- Modify: `docs/escrow-architecture.md` — note ledger persistence is Postgres append-only table (behavior unchanged)
- Create short cutover checklist in design doc or README

**Cutover checklist (document):**

1. Snapshot volumes / copy JSON files
2. Deploy Postgres + new backend with `DATABASE_URL`
3. Confirm import log lines
4. Smoke: health/ready, resolve handle, get profile, list listings, admin stats, inbox
5. Keep `*.imported-*` until verified, then delete

**Step 1: Commit**

```bash
git commit -am "docs: Postgres cutover notes and friends plan alignment"
```

---

### Task 11: CI Postgres for backend tests

**Files:**
- Modify: `.github/workflows/*` (whichever runs `go test`)

**Step 1:** Add Postgres service container + `TEST_DATABASE_URL` / `DATABASE_URL` env to the backend test job so tests do not skip in CI.

**Step 2: Commit**

```bash
git commit -am "ci: run backend tests against Postgres"
```

---

## Out of scope (do not do in this plan)

- Storing encrypted backups in Postgres
- Changing marketplace HTTP API contracts
- Implementing friends handlers (table only; see friends plans)
- Dual-write / long JSON coexistence

## Execution notes

- Prefer TDD per task; keep commits small
- If a test skips locally, start Compose Postgres first
- Homelab Swarm: add postgres service + secret for password; mount only backups volume for blobs; drop inbox volume once import succeeds
