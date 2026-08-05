package main

import (
	"database/sql"
	"reflect"
	"testing"
)

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
		"auth_apps":        {"audience", "display_name", "enabled"},
		"auth_app_origins": {"audience", "origin"},
		"auth_app_scopes":  {"audience", "scope"},
		"auth_challenges":  {"id", "nonce_hash", "address", "audience", "scopes", "message", "created_at", "expires_at", "consumed_at"},
		"auth_sessions":    {"token_hash", "address", "audience", "scopes", "created_at", "expires_at", "last_used_at", "revoked_at"},
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

	for _, table := range []string{"auth_apps", "auth_app_origins", "auth_app_scopes", "auth_challenges", "auth_sessions"} {
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

	for _, table := range []string{"auth_app_origins", "auth_app_scopes", "auth_challenges", "auth_sessions"} {
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
				"backup:read", "backup:write", "friends:read", "friends:write", "inbox:delete",
				"inbox:read", "inbox:send", "marketplace:read", "marketplace:trade", "profile:write",
			},
		},
		"nimworld": {
			displayName: "NimWorld",
			origins:     []string{"http://localhost:5175", "https://nimworld.nimiqminiapps.com"},
			scopes:      []string{"friends:read", "friends:write"},
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
