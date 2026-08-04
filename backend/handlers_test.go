package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestReadyHandler_ReturnsOKWhenDBAvailable(t *testing.T) {
	db := withTestDB(t)
	req := httptest.NewRequest(http.MethodGet, "/api/ready", nil)
	rec := httptest.NewRecorder()
	readyHandler(db)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status ok, got %q", body["status"])
	}
}

func TestReadyHandler_Returns503WhenDBUnavailable(t *testing.T) {
	db := withTestDB(t)
	db.Close()

	req := httptest.NewRequest(http.MethodGet, "/api/ready", nil)
	rec := httptest.NewRecorder()
	readyHandler(db)(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "unavailable" {
		t.Fatalf("expected status unavailable, got %q", body["status"])
	}
}

func TestChainHeightHandler_ReturnsHeightFromRPC(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getBlockNumber": `999`,
	})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	cache := NewChainHeightCache(2*time.Second, rpc.GetBlockNumber)

	req := httptest.NewRequest(http.MethodGet, "/api/chain/height", nil)
	rec := httptest.NewRecorder()
	chainHeightHandler(cache)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		Height uint64 `json:"height"`
	}
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Height != 999 {
		t.Fatalf("expected height 999, got %d", body.Height)
	}
}

func TestChainHeightHandler_CachesRepeatedRequests(t *testing.T) {
	calls := 0
	cache := NewChainHeightCache(2*time.Second, func() (uint64, error) {
		calls++
		return 999, nil
	})

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/chain/height", nil)
		rec := httptest.NewRecorder()
		chainHeightHandler(cache)(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	}

	if calls != 1 {
		t.Fatalf("expected the RPC fetch to be called once due to caching, got %d calls", calls)
	}
}
