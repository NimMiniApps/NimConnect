package main

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

	registry := newTestHandleRegistry(t, map[string]bool{}, 0)
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

	registry := newTestHandleRegistry(t, map[string]bool{}, 0)
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

func TestSweepDoesNotRateLimitAFailedRebuild(t *testing.T) {
	var calls atomic.Int64
	srv := syncTestServer(t, &calls)
	defer srv.Close()

	db := withTestDB(t)
	registry := NewHandleRegistry(db, map[string]bool{}, 0)
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")
	_ = db.Close()

	if err := syncer.Sweep(); err == nil {
		t.Fatal("want persistence failure")
	}
	if err := syncer.Sweep(); err == nil {
		t.Fatal("want persistence failure on retry")
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("failed rebuild must be retried immediately: want 2 RPC calls, got %d", got)
	}
	if syncer.Complete() {
		t.Fatal("failed sweep must leave completeness false")
	}
}

func TestSweepMarksCompleteAfterShortPage(t *testing.T) {
	var calls atomic.Int64
	srv := syncTestServer(t, &calls)
	defer srv.Close()
	registry := newTestHandleRegistry(t, map[string]bool{}, 0)
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")
	if err := syncer.Sweep(); err != nil {
		t.Fatal(err)
	}
	if !syncer.Complete() {
		t.Fatal("short page should prove completeness")
	}
}

func TestGetAllTransactionsByAddressPaginatesAndDetectsIncomplete(t *testing.T) {
	var calls atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var req struct {
			Params []any `json:"params"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		pageSize := 2
		startAt, _ := req.Params[2].(string)
		var page []rpcTx
		switch startAt {
		case "":
			page = []rpcTx{
				{Hash: "h2", BlockNumber: 2, TransactionIndex: ptrUint64(0)},
				{Hash: "h1", BlockNumber: 1, TransactionIndex: ptrUint64(0)},
			}
		case "h1":
			page = []rpcTx{
				{Hash: "h0", BlockNumber: 0, TransactionIndex: ptrUint64(0)},
				{Hash: "h-1", BlockNumber: 0, TransactionIndex: ptrUint64(0)},
			}
		default:
			page = []rpcTx{{Hash: "h-2", BlockNumber: 0, TransactionIndex: ptrUint64(0)}}
		}
		if len(page) > pageSize {
			page = page[:pageSize]
		}
		body, _ := json.Marshal(page)
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + string(body) + `}`))
	}))
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	complete, err := rpc.GetAllTransactionsByAddress("NQ77", 2, 10)
	if err != nil {
		t.Fatal(err)
	}
	if !complete.Complete || len(complete.Txs) != 5 {
		t.Fatalf("want complete 5 txs, got complete=%v n=%d", complete.Complete, len(complete.Txs))
	}
	if calls.Load() != 3 {
		t.Fatalf("want 3 pages, got %d", calls.Load())
	}

	incomplete, err := rpc.GetAllTransactionsByAddress("NQ77", 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	if incomplete.Complete {
		t.Fatal("maxPages=1 with full page must be incomplete")
	}
}

func TestSweepDoesNotClobberOnIncompleteHistory(t *testing.T) {
	oldSize, oldPages := sweepTxPageSize, sweepTxMaxPages
	sweepTxPageSize, sweepTxMaxPages = 2, 2
	t.Cleanup(func() { sweepTxPageSize, sweepTxMaxPages = oldSize, oldPages })

	registry := newTestHandleRegistry(t, map[string]bool{}, 0)
	if err := registry.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)}); err != nil {
		t.Fatal(err)
	}

	// Always return a full page so pagination never terminates as complete.
	page := []rpcTx{
		claimTx("evil", "NQ22 THIEF", "chuck", 999, 0),
		claimTx("h1", "NQ99 OTHER", "ghost", 998, 0),
	}
	body, _ := json.Marshal(page)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + string(body) + `}`))
	}))
	defer srv.Close()

	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")
	if err := syncer.Sweep(); err == nil {
		t.Fatal("want incomplete-history error")
	}
	if syncer.Complete() {
		t.Fatal("incomplete history must not mark complete")
	}
	claim, ok := registry.Resolve("chuck")
	if !ok || claim.TxHash != "t1" {
		t.Fatalf("prior owner must be preserved, got %+v ok=%v", claim, ok)
	}
}

func TestRegistryOrderingAmbiguousSameBlockMissingIndex(t *testing.T) {
	a := claimTx("t1", "NQ11 A", "alpha", 10, 0)
	b := claimTx("t2", "NQ22 B", "beta", 10, 1)
	b.TransactionIndex = nil
	if !registryOrderingAmbiguous([]rpcTx{a, b}) {
		t.Fatal("expected ambiguous when same-block claim lacks index")
	}
	b.TransactionIndex = ptrUint64(1)
	if registryOrderingAmbiguous([]rpcTx{a, b}) {
		t.Fatal("indexed same-block claims are not ambiguous")
	}
}

func TestSweepRejectsAmbiguousOrdering(t *testing.T) {
	a := claimTx("t1", "NQ11 A", "alpha", 10, 0)
	b := claimTx("t2", "NQ22 B", "beta", 10, 1)
	b.TransactionIndex = nil
	txsJSON, _ := json.Marshal([]rpcTx{a, b})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + string(txsJSON) + `}`))
	}))
	defer srv.Close()

	registry := newTestHandleRegistry(t, map[string]bool{}, 0)
	_ = registry.Rebuild([]rpcTx{claimTx("old", "NQ11 A", "alpha", 1, 0)})
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")
	if err := syncer.Sweep(); err == nil {
		t.Fatal("want ambiguous-ordering error")
	}
	if syncer.Complete() {
		t.Fatal("ambiguous ordering must leave completeness false")
	}
	if claim, ok := registry.Resolve("alpha"); !ok || claim.TxHash != "old" {
		t.Fatalf("prior state must remain, got %+v ok=%v", claim, ok)
	}
}

func TestForceSweepBypassesCooldown(t *testing.T) {
	var calls atomic.Int64
	srv := syncTestServer(t, &calls)
	defer srv.Close()

	registry := newTestHandleRegistry(t, map[string]bool{}, 0)
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")

	syncer.Sweep()
	if err := syncer.ForceSweep(); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("ForceSweep should bypass cooldown: want 2 RPC calls, got %d", got)
	}
}
