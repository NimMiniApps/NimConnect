package main

import (
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
	if err := db.QueryRow(`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'marketplace_listings'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected marketplace_listings table, count=%d", n)
	}
}
