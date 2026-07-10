package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWithCORS_SetsHeaderAndCallsNext(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := withCORS("https://example.com", next)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if !called {
		t.Error("expected next handler to be called")
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://example.com" {
		t.Errorf("expected Access-Control-Allow-Origin=https://example.com, got %q", got)
	}
}

func TestWithCORS_MultiOrigin_ReflectsAllowedOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := withCORS("https://nimiqlens.maestroi.cc, https://maestroi.github.io", next)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://maestroi.github.io")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://maestroi.github.io" {
		t.Errorf("expected Access-Control-Allow-Origin=https://maestroi.github.io, got %q", got)
	}
	if got := w.Header().Get("Vary"); got != "Origin" {
		t.Errorf("expected Vary=Origin, got %q", got)
	}
}

func TestWithCORS_MultiOrigin_OmitsHeaderForUnknownOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := withCORS("https://nimiqlens.maestroi.cc,https://maestroi.github.io", next)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("expected no Access-Control-Allow-Origin header, got %q", got)
	}
}

func TestWithCORS_HandlesOptionsPreflight(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	handler := withCORS("*", next)

	req := httptest.NewRequest(http.MethodOptions, "/api/rates", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if called {
		t.Error("expected next handler not to be called for OPTIONS preflight")
	}
	if w.Code != http.StatusNoContent {
		t.Errorf("expected status 204, got %d", w.Code)
	}
}

func TestWithCORS_AllowsInboxAuthHeadersAndMethods(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	handler := withCORS("*", next)

	req := httptest.NewRequest(http.MethodOptions, "/api/inbox/NQ00TEST/messages", nil)
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "x-inbox-public-key, x-inbox-signature, x-inbox-issued-at")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	allowHeaders := strings.ToLower(w.Header().Get("Access-Control-Allow-Headers"))
	for _, h := range []string{"x-inbox-public-key", "x-inbox-signature", "x-inbox-issued-at"} {
		if !strings.Contains(allowHeaders, h) {
			t.Errorf("Access-Control-Allow-Headers %q missing %q", allowHeaders, h)
		}
	}
	allowMethods := w.Header().Get("Access-Control-Allow-Methods")
	for _, m := range []string{"POST", "DELETE"} {
		if !strings.Contains(allowMethods, m) {
			t.Errorf("Access-Control-Allow-Methods %q missing %q", allowMethods, m)
		}
	}
}
