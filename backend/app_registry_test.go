package main

import (
	"crypto/ed25519"
	"testing"
)

func TestUpsertAppRevokesSessionsOnScopeChangeAndOwnerChange(t *testing.T) {
	db := withTestDB(t)
	store := NewAuthStore(db)
	pub, _, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	audience := "testapp1"
	if err := store.UpsertApp(AppRecord{
		Audience: audience, DisplayName: "Test App", OwnerID: "owner-a",
		Scopes: []string{ScopeFriendsRead}, Origins: []string{"https://example.test"},
	}); err != nil {
		t.Fatal(err)
	}

	if _, _, err := store.IssueSession(address, audience, []string{ScopeFriendsRead}); err != nil {
		t.Fatal(err)
	}
	if grants, err := store.ListGrants(address); err != nil || len(grants) != 1 {
		t.Fatalf("expected 1 live grant before app change, got %+v (err=%v)", grants, err)
	}

	// Same owner, same scopes: session survives.
	if err := store.UpsertApp(AppRecord{
		Audience: audience, DisplayName: "Test App Renamed", OwnerID: "owner-a",
		Scopes: []string{ScopeFriendsRead}, Origins: []string{"https://example.test"},
	}); err != nil {
		t.Fatal(err)
	}
	rec, err := store.GetApp(audience)
	if err != nil {
		t.Fatal(err)
	}
	if rec.DisplayName != "Test App Renamed" {
		t.Fatalf("display name not updated: %+v", rec)
	}
	if grants, err := store.ListGrants(address); err != nil || len(grants) != 1 {
		t.Fatalf("rename must not revoke: got %+v (err=%v)", grants, err)
	}

	// Owner change must revoke outstanding sessions.
	if err := store.UpsertApp(AppRecord{
		Audience: audience, DisplayName: "Test App Renamed", OwnerID: "owner-b",
		Scopes: []string{ScopeFriendsRead}, Origins: []string{"https://example.test"},
	}); err != nil {
		t.Fatal(err)
	}
	grants, err := store.ListGrants(address)
	if err != nil {
		t.Fatal(err)
	}
	if len(grants) != 0 {
		t.Fatalf("expected sessions revoked on owner change, got %+v", grants)
	}

	// Scope escalation must also revoke — an app never inherits consent for new scopes.
	if _, _, err := store.IssueSession(address, audience, []string{ScopeFriendsRead}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertApp(AppRecord{
		Audience: audience, DisplayName: "Test App Renamed", OwnerID: "owner-b",
		Scopes: []string{ScopeFriendsRead, ScopeFriendsWrite}, Origins: []string{"https://example.test"},
	}); err != nil {
		t.Fatal(err)
	}
	if grants, err = store.ListGrants(address); err != nil || len(grants) != 0 {
		t.Fatalf("expected sessions revoked on scope escalation, got %+v (err=%v)", grants, err)
	}
}

func TestAppAPIKeyRoundTrip(t *testing.T) {
	db := withTestDB(t)
	store := NewAuthStore(db)
	audience := "testapp2"
	if err := store.UpsertApp(AppRecord{Audience: audience, DisplayName: "Test App", Scopes: []string{ScopeAchievementsRead}}); err != nil {
		t.Fatal(err)
	}
	key, err := store.IssueAppAPIKey(audience)
	if err != nil || key == "" {
		t.Fatalf("issue: key=%q err=%v", key, err)
	}
	resolved, err := store.ResolveAppByAPIKey(key)
	if err != nil || resolved != audience {
		t.Fatalf("resolve: got %q, %v", resolved, err)
	}
	if _, err := store.ResolveAppByAPIKey("wrong-key"); err == nil {
		t.Fatal("expected wrong key to fail")
	}
}
