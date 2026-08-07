package main

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	neturl "net/url"
	"reflect"
	"sync"
	"testing"
	"time"

	"nimconnect-backend/migrations"
)

func isolatedSchemaDatabaseURL(t *testing.T, prefix string) string {
	t.Helper()
	databaseURL, err := resolveTestDatabaseURLFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	adminDB, err := OpenDB(databaseURL)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	t.Cleanup(func() { _ = adminDB.Close() })

	schema := fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
	if _, err := adminDB.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	// Register this immediately after creation so even a later OpenDB failure
	// cannot strand an isolated test schema.
	t.Cleanup(func() {
		if _, err := adminDB.Exec(`DROP SCHEMA ` + schema + ` CASCADE`); err != nil {
			t.Errorf("drop isolated schema: %v", err)
		}
	})

	parsedURL, err := neturl.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsedURL.Query()
	query.Set("search_path", schema)
	parsedURL.RawQuery = query.Encode()
	return parsedURL.String()
}

func applyMigration001Only(t *testing.T, db *sql.DB) {
	t.Helper()
	body, err := migrations.Files.ReadFile("001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(body)); err != nil {
		t.Fatalf("apply 001: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO schema_migrations (version) VALUES ('001_init')`); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateSerializesConcurrentReplicas(t *testing.T) {
	databaseURL := isolatedSchemaDatabaseURL(t, "migration_race")
	db1, err := OpenDB(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db1.Close() })
	db2, err := OpenDB(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db2.Close() })

	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, db := range []*sql.DB{db1, db2} {
		wg.Add(1)
		go func(db *sql.DB) {
			defer wg.Done()
			<-start
			results <- Migrate(db)
		}(db)
	}
	close(start)
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Errorf("concurrent Migrate: %v", err)
		}
	}
	assertCount(t, db1, `SELECT COUNT(*) FROM schema_migrations WHERE version = '001_init'`, 1)
	assertCount(t, db1, `SELECT COUNT(*) FROM schema_migrations WHERE version = '002_scoped_authorization'`, 1)
}

func TestMigrateFailureRollsBackAndReleasesAdvisoryLock(t *testing.T) {
	databaseURL := isolatedSchemaDatabaseURL(t, "migration_failure")
	db, err := OpenDB(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	applyMigration001Only(t, db)
	if _, err := db.Exec(`CREATE TABLE auth_sessions (bogus INT)`); err != nil {
		t.Fatal(err)
	}

	if err := Migrate(db); err == nil {
		t.Fatal("Migrate succeeded with incompatible auth_sessions table")
	}
	var authAppsExists bool
	if err := db.QueryRow(`SELECT to_regclass('auth_apps') IS NOT NULL`).Scan(&authAppsExists); err != nil {
		t.Fatal(err)
	}
	if authAppsExists {
		t.Error("failed migration left auth_apps behind; migration body was not rolled back")
	}
	assertCount(t, db, `SELECT COUNT(*) FROM schema_migrations WHERE version = '002_scoped_authorization'`, 0)

	probeDB, err := OpenDB(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = probeDB.Close() })
	conn, err := probeDB.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var acquired bool
	if err := conn.QueryRowContext(context.Background(), `SELECT pg_try_advisory_lock($1)`, migrationAdvisoryLockKey).Scan(&acquired); err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("migration advisory lock remained held after failure")
	}
	if _, err := conn.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1)`, migrationAdvisoryLockKey); err != nil {
		t.Fatal(err)
	}
}

func TestScopedAuthorizationSchemaRejectsInvalidRows(t *testing.T) {
	databaseURL := isolatedSchemaDatabaseURL(t, "auth_constraints")
	db, err := OpenDB(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}

	createdAt := time.Now().UTC().Truncate(time.Second)
	tests := []struct {
		name string
		stmt string
		args []any
	}{
		{
			name: "short challenge hash",
			stmt: `INSERT INTO auth_challenges (id, nonce_hash, address, audience, scopes, message, created_at, expires_at)
			       VALUES ('bad-challenge-hash', $1, 'NQTEST', 'nimconnect', ARRAY['friends:read'], 'message', $2, $3)`,
			args: []any{bytes.Repeat([]byte{1}, 31), createdAt, createdAt.Add(time.Minute)},
		},
		{
			name: "challenge expires at creation",
			stmt: `INSERT INTO auth_challenges (id, nonce_hash, address, audience, scopes, message, created_at, expires_at)
			       VALUES ('bad-challenge-order', $1, 'NQTEST', 'nimconnect', ARRAY['friends:read'], 'message', $2, $2)`,
			args: []any{bytes.Repeat([]byte{2}, 32), createdAt},
		},
		{
			name: "challenge exceeds five minutes",
			stmt: `INSERT INTO auth_challenges (id, nonce_hash, address, audience, scopes, message, created_at, expires_at)
			       VALUES ('bad-challenge-ttl', $1, 'NQTEST', 'nimconnect', ARRAY['friends:read'], 'message', $2, $3)`,
			args: []any{bytes.Repeat([]byte{3}, 32), createdAt, createdAt.Add(5*time.Minute + time.Second)},
		},
		{
			name: "challenge consumed before creation",
			stmt: `INSERT INTO auth_challenges (id, nonce_hash, address, audience, scopes, message, created_at, expires_at, consumed_at)
			       VALUES ('bad-challenge-consumed', $1, 'NQTEST', 'nimconnect', ARRAY['friends:read'], 'message', $2, $3, $4)`,
			args: []any{bytes.Repeat([]byte{4}, 32), createdAt, createdAt.Add(time.Minute), createdAt.Add(-time.Second)},
		},
		{
			name: "short session hash",
			stmt: `INSERT INTO auth_sessions (token_hash, address, audience, scopes, created_at, expires_at, last_used_at)
			       VALUES ($1, 'NQTEST', 'nimconnect', ARRAY['friends:read'], $2, $3, $2)`,
			args: []any{bytes.Repeat([]byte{5}, 31), createdAt, createdAt.Add(time.Hour)},
		},
		{
			name: "session expires at creation",
			stmt: `INSERT INTO auth_sessions (token_hash, address, audience, scopes, created_at, expires_at, last_used_at)
			       VALUES ($1, 'NQTEST', 'nimconnect', ARRAY['friends:read'], $2, $2, $2)`,
			args: []any{bytes.Repeat([]byte{6}, 32), createdAt},
		},
		{
			name: "session exceeds seven days",
			stmt: `INSERT INTO auth_sessions (token_hash, address, audience, scopes, created_at, expires_at, last_used_at)
			       VALUES ($1, 'NQTEST', 'nimconnect', ARRAY['friends:read'], $2, $3, $2)`,
			args: []any{bytes.Repeat([]byte{7}, 32), createdAt, createdAt.Add(7*24*time.Hour + time.Second)},
		},
		{
			name: "session revoked before creation",
			stmt: `INSERT INTO auth_sessions (token_hash, address, audience, scopes, created_at, expires_at, last_used_at, revoked_at)
			       VALUES ($1, 'NQTEST', 'nimconnect', ARRAY['friends:read'], $2, $3, $2, $4)`,
			args: []any{bytes.Repeat([]byte{8}, 32), createdAt, createdAt.Add(time.Hour), createdAt.Add(-time.Second)},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := db.Exec(tc.stmt, tc.args...); err == nil {
				t.Fatal("invalid authorization row was accepted")
			}
		})
	}
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
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'marketplace_listings'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected marketplace_listings table, count=%d", n)
	}
}

func TestOpenAndMigrateCreatesScopedAuthorizationSchema(t *testing.T) {
	db, err := OpenDB(testDatabaseURL(t))
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	defer db.Close()
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}

	wantColumns := map[string][]string{
		"auth_apps":        {"audience", "display_name", "enabled", "icon_url", "verified", "owner_id", "api_key_hash"},
		"auth_app_origins": {"audience", "origin"},
		"auth_app_scopes":  {"audience", "scope"},
		"auth_challenges":  {"id", "nonce_hash", "address", "audience", "scopes", "message", "created_at", "expires_at", "consumed_at"},
		"auth_sessions":    {"token_hash", "address", "audience", "scopes", "created_at", "expires_at", "last_used_at", "revoked_at"},
		"awards":           {"id", "app_id", "achievement_id", "address", "title", "description", "rarity", "progress", "visibility", "granted_at"},
	}
	for table, want := range wantColumns {
		rows, err := db.Query(`
			SELECT column_name
			FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = $1
			ORDER BY ordinal_position`, table)
		if err != nil {
			t.Fatal(err)
		}
		var got []string
		for rows.Next() {
			var column string
			if err := rows.Scan(&column); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			got = append(got, column)
		}
		if err := rows.Close(); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s columns = %v, want %v", table, got, want)
		}
	}

	for _, table := range []string{"auth_apps", "auth_app_origins", "auth_app_scopes", "auth_challenges", "auth_sessions", "awards"} {
		var primaryKeyCount int
		if err := db.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.table_constraints
			WHERE table_schema = 'public' AND table_name = $1 AND constraint_type = 'PRIMARY KEY'`, table).Scan(&primaryKeyCount); err != nil {
			t.Fatal(err)
		}
		if primaryKeyCount != 1 {
			t.Errorf("%s primary key count = %d, want 1", table, primaryKeyCount)
		}
	}

	var nonceUnique bool
	if err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.table_constraints tc
			JOIN information_schema.constraint_column_usage ccu
			  ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.constraint_schema
			WHERE tc.table_schema = 'public' AND tc.table_name = 'auth_challenges'
			  AND tc.constraint_type = 'UNIQUE' AND ccu.column_name = 'nonce_hash'
		)`).Scan(&nonceUnique); err != nil {
		t.Fatal(err)
	}
	if !nonceUnique {
		t.Error("auth_challenges.nonce_hash must be unique")
	}

	awardUniqueCols := queryStrings(t, db, `
		SELECT ccu.column_name
		FROM information_schema.table_constraints tc
		JOIN information_schema.constraint_column_usage ccu
		  ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.constraint_schema
		WHERE tc.table_schema = 'public' AND tc.table_name = 'awards'
		  AND tc.constraint_type = 'UNIQUE'
		ORDER BY ccu.column_name`)
	if !reflect.DeepEqual(awardUniqueCols, []string{"achievement_id", "address", "app_id"}) {
		t.Errorf("awards unique columns = %v, want [achievement_id address app_id]", awardUniqueCols)
	}

	var awardsVisibilityCheck bool
	if err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.check_constraints cc
			JOIN information_schema.constraint_column_usage ccu
			  ON cc.constraint_name = ccu.constraint_name AND cc.constraint_schema = ccu.constraint_schema
			WHERE ccu.table_schema = 'public' AND ccu.table_name = 'awards'
			  AND ccu.column_name = 'visibility'
			  AND cc.check_clause ILIKE '%public%'
			  AND cc.check_clause ILIKE '%private%'
		)`).Scan(&awardsVisibilityCheck); err != nil {
		t.Fatal(err)
	}
	if !awardsVisibilityCheck {
		t.Error("awards.visibility must CHECK IN ('public', 'private')")
	}

	for _, table := range []string{"auth_app_origins", "auth_app_scopes", "auth_challenges", "auth_sessions", "awards"} {
		var foreignKeyCount int
		if err := db.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.table_constraints
			WHERE table_schema = 'public' AND table_name = $1 AND constraint_type = 'FOREIGN KEY'`, table).Scan(&foreignKeyCount); err != nil {
			t.Fatal(err)
		}
		if foreignKeyCount != 1 {
			t.Errorf("%s foreign key count = %d, want 1", table, foreignKeyCount)
		}
	}

	wantSeeds := map[string]struct {
		displayName string
		origins     []string
		scopes      []string
	}{
		"nimconnect": {
			displayName: "NimConnect",
			origins:     []string{"http://localhost:5173", "https://nimconnect.nimiqminiapps.com"},
			scopes: []string{
				"achievements:read", "backup:read", "backup:write", "friends:read", "friends:write", "inbox:delete",
				"inbox:read", "inbox:send", "marketplace:read", "marketplace:trade", "profile:write",
			},
		},
		"nimworld": {
			displayName: "NimWorld",
			origins:     []string{"http://localhost:5175", "https://nimworld.nimiqminiapps.com"},
			scopes:      []string{"achievements:read", "friends:read", "friends:write"},
		},
	}
	for audience, want := range wantSeeds {
		var displayName string
		var enabled bool
		if err := db.QueryRow(`SELECT display_name, enabled FROM auth_apps WHERE audience = $1`, audience).Scan(&displayName, &enabled); err != nil {
			t.Fatal(err)
		}
		if displayName != want.displayName || !enabled {
			t.Errorf("%s seed = (%q, %v), want (%q, true)", audience, displayName, enabled, want.displayName)
		}
		if got := queryStrings(t, db, `SELECT origin FROM auth_app_origins WHERE audience = $1 ORDER BY origin`, audience); !reflect.DeepEqual(got, want.origins) {
			t.Errorf("%s origins = %v, want %v", audience, got, want.origins)
		}
		if got := queryStrings(t, db, `SELECT scope FROM auth_app_scopes WHERE audience = $1 ORDER BY scope`, audience); !reflect.DeepEqual(got, want.scopes) {
			t.Errorf("%s scopes = %v, want %v", audience, got, want.scopes)
		}
	}

	if err := Migrate(db); err != nil {
		t.Fatalf("rerun migration: %v", err)
	}
	assertCount(t, db, `SELECT COUNT(*) FROM schema_migrations WHERE version = '002_scoped_authorization'`, 1)
	assertCount(t, db, `SELECT COUNT(*) FROM schema_migrations WHERE version = '004_awards_and_app_registry'`, 1)
}

func queryStrings(t *testing.T, db interface {
	Query(string, ...any) (*sql.Rows, error)
}, query string, args ...any) []string {
	t.Helper()
	rows, err := db.Query(query, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			t.Fatal(err)
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}
