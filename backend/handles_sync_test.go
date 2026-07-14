package main

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func syncTestServer(t *testing.T, calls *atomic.Int64) *httptest.Server {
	t.Helper()
	txsJSON, _ := json.Marshal([]rpcTx{{
		Hash: "t1", Sender: "NQ11 OWNER", Recipient: "NQ77 REGISTRY",
		Data:        hex.EncodeToString([]byte(makeClaimPayload("chuck"))),
		BlockNumber: 5,
	}})
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + string(txsJSON) + `}`))
	}))
}

func TestSweepRebuildsRegistry(t *testing.T) {
	var calls atomic.Int64
	srv := syncTestServer(t, &calls)
	defer srv.Close()

	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{})
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")

	if err := syncer.Sweep(); err != nil {
		t.Fatal(err)
	}
	if _, ok := registry.Resolve("chuck"); !ok {
		t.Fatal("sweep should have indexed the claim")
	}
}

func TestSweepIsRateLimited(t *testing.T) {
	var calls atomic.Int64
	srv := syncTestServer(t, &calls)
	defer srv.Close()

	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{})
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")

	syncer.Sweep()
	syncer.Sweep() // within 5s -> no second RPC call
	if got := calls.Load(); got != 1 {
		t.Fatalf("want 1 RPC call, got %d", got)
	}

	syncer.lastSweep = time.Now().Add(-6 * time.Second)
	syncer.Sweep()
	if got := calls.Load(); got != 2 {
		t.Fatalf("want 2 RPC calls after cooldown, got %d", got)
	}
}
