package main

import (
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

func TestPublicPageServesOGTags(t *testing.T) {
	// seededRegistry owns @chuck (see handles_handlers_test.go); no published
	// profile, so this asserts the fallback title/description path.
	registry := seededRegistry(t)
	profiles := NewProfileStore(t.TempDir())

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
	registry := seededRegistry(t)
	rec := httptest.NewRecorder()
	publicPageMux(t, registry, NewProfileStore(t.TempDir())).ServeHTTP(rec, httptest.NewRequest("GET", "/p/ghost", nil))
	if rec.Code != 404 {
		t.Fatalf("want 404, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "nimconnect.example") {
		t.Error("404 page should still link to the app")
	}
}

func TestPublicPageInvalidHandle(t *testing.T) {
	registry := seededRegistry(t)
	rec := httptest.NewRecorder()
	publicPageMux(t, registry, NewProfileStore(t.TempDir())).ServeHTTP(rec, httptest.NewRequest("GET", "/p/NOT_valid!", nil))
	if rec.Code != 400 {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestPublicPageEscapesProfileContent(t *testing.T) {
	// A handle whose owner we control end-to-end: seed registry claim from a
	// signer-derived address, publish a bio containing HTML, expect it escaped.
	profiles := NewProfileStore(t.TempDir())
	req, address := putReq(t, 1000, `{"display_name":"Evil","bio":"<script>alert(1)</script>"}`)
	if err := profiles.Put(req); err != nil {
		t.Fatal(err)
	}
	registry := newTestRegistry(t)
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
