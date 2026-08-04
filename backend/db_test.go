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
