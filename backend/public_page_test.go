package main

import (
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func publicPageMux(t *testing.T, registry *HandleRegistry, profiles *ProfileStore) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /p/{handle}", publicPageHandler(registry, profiles, "https://nimconnect.example"))
	return mux
}

func seededPublicPageFixture(t *testing.T) (*HandleRegistry, *ProfileStore) {
	t.Helper()
	db := withTestDB(t)
	registry := NewHandleRegistry(db, map[string]bool{"nimiq": true}, 0)
	registry.Rebuild([]rpcTx{{
		Hash: "t1", Sender: "NQ11 OWNER", Recipient: "NQ77 REGISTRY",
		Data: hex.EncodeToString([]byte(makeClaimPayload("chuck"))), BlockNumber: 5,
	}})
	return registry, NewProfileStore(db)
}

func TestPublicPageServesOGTags(t *testing.T) {
	registry, profiles := seededPublicPageFixture(t)

	rec := httptest.NewRecorder()
	publicPageMux(t, registry, profiles).ServeHTTP(rec, httptest.NewRequest("GET", "/p/chuck", nil))
	if rec.Code != 200 {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{
		`og:title`, `@chuck`, `nimconnect.example/#/u/chuck`, `og:description`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q:\n%s", want, body)
		}
	}
}

func TestPublicPageUnknownHandleIs404ButRedirects(t *testing.T) {
	registry, profiles := seededPublicPageFixture(t)
	rec := httptest.NewRecorder()
	publicPageMux(t, registry, profiles).ServeHTTP(rec, httptest.NewRequest("GET", "/p/ghost", nil))
	if rec.Code != 404 {
		t.Fatalf("want 404, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "nimconnect.example") {
		t.Error("404 page should still link to the app")
	}
}

func TestPublicPageInvalidHandle(t *testing.T) {
	registry, profiles := seededPublicPageFixture(t)
	rec := httptest.NewRecorder()
	publicPageMux(t, registry, profiles).ServeHTTP(rec, httptest.NewRequest("GET", "/p/NOT_valid!", nil))
	if rec.Code != 400 {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestPublicPageEscapesProfileContent(t *testing.T) {
	db := withTestDB(t)
	profiles := NewProfileStore(db)
	req, address := putReq(t, 1000, `{"display_name":"Evil","bio":"<script>alert(1)</script>"}`)
	if err := profiles.Put(req); err != nil {
		t.Fatal(err)
	}
	registry := NewHandleRegistry(db, map[string]bool{"nimiq": true}, 0)
	registry.Rebuild([]rpcTx{claimTx("t1", address, "evil", 5, 0)})

	rec := httptest.NewRecorder()
	publicPageMux(t, registry, profiles).ServeHTTP(rec, httptest.NewRequest("GET", "/p/evil", nil))
	body := rec.Body.String()
	if strings.Contains(body, "<script>alert(1)</script>") {
		t.Fatal("profile content must be HTML-escaped")
	}
	if !strings.Contains(body, "Evil") {
		t.Error("display name should appear (escaped)")
	}
}
