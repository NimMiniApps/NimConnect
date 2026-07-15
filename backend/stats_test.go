package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestStatsRecordAndSummary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stats.json")
	s := NewStats(path)
	s.now = func() time.Time { return time.Date(2026, 7, 13, 10, 0, 0, 0, time.UTC) }

	s.RecordWallet("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")
	s.RecordWallet("NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD") // same wallet, compact form
	s.RecordWallet("NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF")
	s.RecordWallet("")
	s.RecordOpen()
	s.RecordOpen()

	s.now = func() time.Time { return time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC) }
	s.RecordWallet("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD") // repeat wallet, new day

	sum := s.Summary()
	if sum.UniqueWallets != 2 {
		t.Fatalf("unique wallets = %d, want 2", sum.UniqueWallets)
	}
	if sum.TotalOpens != 2 {
		t.Fatalf("total opens = %d, want 2", sum.TotalOpens)
	}
	if len(sum.Days) != 2 || sum.Days[0].Wallets != 2 || sum.Days[1].Wallets != 1 {
		t.Fatalf("unexpected days: %+v", sum.Days)
	}

	// Persistence: reload from disk.
	s2 := NewStats(path)
	if got := s2.Summary().UniqueWallets; got != 2 {
		t.Fatalf("reloaded unique wallets = %d, want 2", got)
	}
}

func TestStatsHandlerAuth(t *testing.T) {
	s := NewStats("") // no persistence
	s.RecordWallet("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")

	h := statsHandler(s, "secret")

	r := httptest.NewRequest("GET", "/api/stats", nil)
	w := httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no token: got %d, want 401", w.Code)
	}

	r = httptest.NewRequest("GET", "/api/stats", nil)
	r.Header.Set("X-Admin-Token", "secret")
	w = httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("with token: got %d, want 200", w.Code)
	}

	// Empty configured token disables the endpoint entirely.
	h = statsHandler(s, "")
	r = httptest.NewRequest("GET", "/api/stats", nil)
	w = httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("disabled: got %d, want 401", w.Code)
	}
}

func TestWithWalletStat(t *testing.T) {
	s := NewStats("")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/backup/{address}", withWalletStat(s, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	r := httptest.NewRequest("GET", "/api/backup/NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD", nil)
	mux.ServeHTTP(httptest.NewRecorder(), r)
	if got := s.Summary().UniqueWallets; got != 1 {
		t.Fatalf("unique wallets = %d, want 1", got)
	}
}
