package main

import (
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuthorizationsListHandlerRequiresFirstPartySession(t *testing.T) {
	db := withTestDB(t)
	authStore := NewAuthStore(db)
	userSessions := NewUserSessions()
	userSessions.scoped = authStore
	pub, _, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	if _, _, err := authStore.IssueSession(address, "nimworld", []string{ScopeFriendsRead}); err != nil {
		t.Fatal(err)
	}

	handler := authorizationsListHandler(userSessions, authStore)

	unauth := httptest.NewRecorder()
	handler(unauth, httptest.NewRequest(http.MethodGet, "/api/authorizations", nil))
	if unauth.Code != http.StatusUnauthorized {
		t.Fatalf("no session: got %d, want 401", unauth.Code)
	}

	token, _, err := userSessions.Issue(address, defaultAudience)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/authorizations", nil)
	req.Header.Set(userSessionHeader, token)
	rec := httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}

	var body struct {
		Authorizations []struct {
			Audience    string   `json:"audience"`
			DisplayName string   `json:"display_name"`
			IconURL     string   `json:"icon_url"`
			Verified    bool     `json:"verified"`
			Scopes      []string `json:"scopes"`
			GrantedAt   int64    `json:"granted_at"`
			ExpiresAt   int64    `json:"expires_at"`
		} `json:"authorizations"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	if len(body.Authorizations) != 1 {
		t.Fatalf("authorizations = %+v, want 1 grant", body.Authorizations)
	}
	g := body.Authorizations[0]
	if g.Audience != "nimworld" {
		t.Fatalf("audience = %q, want nimworld", g.Audience)
	}
	if g.DisplayName == "" || g.GrantedAt == 0 || g.ExpiresAt == 0 || len(g.Scopes) == 0 {
		t.Fatalf("missing required fields: %+v", g)
	}
	// icon_url and verified must be present in JSON (seed defaults: "", false).
	raw := rec.Body.String()
	for _, key := range []string{`"icon_url"`, `"verified"`, `"scopes"`, `"granted_at"`, `"expires_at"`, `"display_name"`} {
		if !strings.Contains(raw, key) {
			t.Fatalf("response missing %s: %s", key, raw)
		}
	}
}

func TestListGrantsExcludesRevokedExpiredAndDisabled(t *testing.T) {
	store, db := newTestAuthStore(t)
	base := time.Now().UTC().Truncate(time.Second)
	store.now = func() time.Time { return base }
	pub, _, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	t.Run("revoked excluded", func(t *testing.T) {
		token, _, err := store.IssueSession(address, "nimworld", []string{ScopeFriendsRead})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.RevokeSession(token); err != nil {
			t.Fatal(err)
		}
		grants, err := store.ListGrants(address)
		if err != nil {
			t.Fatal(err)
		}
		for _, g := range grants {
			if g.Audience == "nimworld" {
				t.Fatalf("revoked nimworld grant still listed: %+v", grants)
			}
		}
	})

	t.Run("expired excluded", func(t *testing.T) {
		if _, err := db.Exec(`UPDATE auth_apps SET enabled = true`); err != nil {
			t.Fatal(err)
		}
		if _, _, err := store.IssueSession(address, "nimconnect", []string{ScopeFriendsRead}); err != nil {
			t.Fatal(err)
		}
		store.now = func() time.Time { return base.Add(authSessionTTL + time.Second) }
		grants, err := store.ListGrants(address)
		if err != nil {
			t.Fatal(err)
		}
		if len(grants) != 0 {
			t.Fatalf("expired grants still listed: %+v", grants)
		}
		store.now = func() time.Time { return base }
	})

	t.Run("disabled app excluded", func(t *testing.T) {
		if _, err := db.Exec(`
			TRUNCATE auth_sessions;
			UPDATE auth_apps SET enabled = true`); err != nil {
			t.Fatal(err)
		}
		if _, _, err := store.IssueSession(address, "nimworld", []string{ScopeFriendsRead}); err != nil {
			t.Fatal(err)
		}
		if _, _, err := store.IssueSession(address, "nimconnect", []string{ScopeFriendsRead}); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE auth_apps SET enabled = false WHERE audience = 'nimworld'`); err != nil {
			t.Fatal(err)
		}
		grants, err := store.ListGrants(address)
		if err != nil {
			t.Fatal(err)
		}
		if len(grants) != 1 || grants[0].Audience != "nimconnect" {
			t.Fatalf("expected only nimconnect, got %+v", grants)
		}
	})
}
