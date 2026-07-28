package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChainHeightHandler_ReturnsHeightFromRPC(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getBlockNumber": `999`,
	})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/chain/height", nil)
	rec := httptest.NewRecorder()
	chainHeightHandler(rpc)(rec, req)

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
