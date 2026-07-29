package main

import (
	"encoding/json"
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

	sum := s.Summary(HandleStats{})
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
	if got := s2.Summary(HandleStats{}).UniqueWallets; got != 2 {
		t.Fatalf("reloaded unique wallets = %d, want 2", got)
	}
}

func TestStatsSummaryMergesUsageAndHandleDays(t *testing.T) {
	s := NewStats("")
	s.now = func() time.Time { return time.Date(2026, 7, 21, 10, 0, 0, 0, time.UTC) }
	s.RecordWallet("NQ11 OWNER")
	s.RecordOpen()

	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	onUsageDay := claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)
	onUsageDay.Timestamp = time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC).UnixMilli()
	onClaimOnlyDay := claimTx("t2", "NQ22 OWNER", "alice", 6, 0)
	onClaimOnlyDay.Timestamp = time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC).UnixMilli()
	if err := registry.Rebuild([]rpcTx{onUsageDay, onClaimOnlyDay}); err != nil {
		t.Fatal(err)
	}

	sum := s.Summary(registry.Stats())
	if sum.UniqueHandles != 2 {
		t.Fatalf("unique handles = %d, want 2", sum.UniqueHandles)
	}
	if len(sum.Days) != 2 {
		t.Fatalf("days = %+v, want usage and claim-only dates", sum.Days)
	}
	if got := sum.Days[0]; got.Day != "2026-07-21" || got.Wallets != 1 || got.Opens != 1 || got.Handles != 1 {
		t.Fatalf("merged usage day = %+v", got)
	}
	if got := sum.Days[1]; got.Day != "2026-07-22" || got.Wallets != 0 || got.Opens != 0 || got.Handles != 1 {
		t.Fatalf("claim-only day = %+v", got)
	}
}

func TestStatsHandlerAuth(t *testing.T) {
	s := NewStats("") // no persistence
	s.RecordWallet("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")

	sessions := NewAdminSessions(nil)
	token, _, err := sessions.Issue()
	if err != nil {
		t.Fatal(err)
	}

	h := statsHandler(s, sessions, nil)

	r := httptest.NewRequest("GET", "/api/stats", nil)
	w := httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no session header: got %d, want 401", w.Code)
	}

	r = httptest.NewRequest("GET", "/api/stats", nil)
	r.Header.Set("X-Admin-Session", token)
	w = httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("with valid session: got %d, want 200", w.Code)
	}
	var summary statsSummary
	if err := json.NewDecoder(w.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.UniqueHandles != 0 {
		t.Fatalf("disabled registry unique handles = %d, want 0", summary.UniqueHandles)
	}

	r = httptest.NewRequest("GET", "/api/stats", nil)
	r.Header.Set("X-Admin-Session", "not-a-real-token")
	w = httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("invalid session: got %d, want 401", w.Code)
	}
}

func TestAdminHandlesHandler(t *testing.T) {
	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	if err := registry.Rebuild([]rpcTx{
		claimTx("t2", "NQ22 OWNER", "chuck", 6, 0),
		claimTx("t1", "NQ11 OWNER", "alice", 5, 0),
	}); err != nil {
		t.Fatal(err)
	}

	sessions := NewAdminSessions(nil)
	token, _, err := sessions.Issue()
	if err != nil {
		t.Fatal(err)
	}
	h := adminHandlesHandler(sessions, registry)

	req := httptest.NewRequest(http.MethodGet, "/api/admin/handles", nil)
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session header: got %d, want 401", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/admin/handles", nil)
	req.Header.Set("X-Admin-Session", token)
	rec = httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid session: got %d, want 200", rec.Code)
	}
	var body struct {
		Handles []HandleClaim `json:"handles"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Handles) != 2 || body.Handles[0].Handle != "alice" || body.Handles[1].Handle != "chuck" {
		t.Fatalf("handles = %+v", body.Handles)
	}

	h = adminHandlesHandler(sessions, nil)
	req = httptest.NewRequest(http.MethodGet, "/api/admin/handles", nil)
	req.Header.Set("X-Admin-Session", token)
	rec = httptest.NewRecorder()
	h(rec, req)
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Handles == nil || len(body.Handles) != 0 {
		t.Fatalf("disabled registry handles = %#v, want empty array", body.Handles)
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
	if got := s.Summary(HandleStats{}).UniqueWallets; got != 1 {
		t.Fatalf("unique wallets = %d, want 1", got)
	}
}
