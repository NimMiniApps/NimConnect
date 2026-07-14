package main

import (
	"encoding/hex"
	"path/filepath"
	"testing"
)

func claimTx(hash, sender, verb, handle string, block, index uint64) rpcTx {
	return rpcTx{
		Hash: hash, Sender: sender, Recipient: "NQ77 REGISTRY",
		Data:        hex.EncodeToString([]byte(makeClaimPayload(verb, handle))),
		BlockNumber: block, TransactionIndex: index,
	}
}

func newTestRegistry(t *testing.T) *HandleRegistry {
	t.Helper()
	return NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{"nimiq": true})
}

func TestRebuildEarliestClaimWins(t *testing.T) {
	r := newTestRegistry(t)
	err := r.Rebuild([]rpcTx{
		// Out of chain order on purpose — Rebuild must sort.
		claimTx("t2", "NQ22 LATE", "claim", "chuck", 10, 0),
		claimTx("t1", "NQ11 EARLY", "claim", "chuck", 5, 3),
		claimTx("t3", "NQ33 OTHER", "claim", "alice", 10, 1),
		{Hash: "junk", Sender: "NQ44", Data: "zznothex", BlockNumber: 1}, // ignored
	})
	if err != nil {
		t.Fatal(err)
	}
	claim, ok := r.Resolve("chuck")
	if !ok || compactAddress(claim.Address) != "NQ11EARLY" || claim.TxHash != "t1" {
		t.Fatalf("earliest claim should win: %+v ok=%v", claim, ok)
	}
	if _, ok := r.Resolve("alice"); !ok {
		t.Fatal("alice should be claimed")
	}
}

func TestRebuildSameBlockOrdersByTxIndex(t *testing.T) {
	r := newTestRegistry(t)
	r.Rebuild([]rpcTx{
		claimTx("t2", "NQ22 SECOND", "claim", "chuck", 5, 7),
		claimTx("t1", "NQ11 FIRST", "claim", "chuck", 5, 2),
	})
	claim, _ := r.Resolve("chuck")
	if claim.TxHash != "t1" {
		t.Fatalf("lower tx index in same block should win: %+v", claim)
	}
}

func TestReleaseFreesHandleForReclaim(t *testing.T) {
	r := newTestRegistry(t)
	r.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 OWNER", "claim", "chuck", 5, 0),
		claimTx("t2", "NQ22 THIEF", "release", "chuck", 6, 0), // not owner -> ignored
		claimTx("t3", "NQ11 OWNER", "release", "chuck", 7, 0), // owner releases
		claimTx("t4", "NQ22 THIEF", "claim", "chuck", 8, 0),   // reclaim works
	})
	claim, ok := r.Resolve("chuck")
	if !ok || compactAddress(claim.Address) != "NQ22THIEF" {
		t.Fatalf("handle should be reclaimed after owner release: %+v ok=%v", claim, ok)
	}
}

func TestReservedHandlesNeverClaimable(t *testing.T) {
	r := newTestRegistry(t)
	r.Rebuild([]rpcTx{claimTx("t1", "NQ11 X", "claim", "nimiq", 5, 0)})
	if _, ok := r.Resolve("nimiq"); ok {
		t.Fatal("reserved handle must not resolve")
	}
	if ok, reason := r.Available("nimiq"); ok || reason != "reserved" {
		t.Fatalf("want reserved, got ok=%v reason=%q", ok, reason)
	}
	if ok, reason := r.Available("Ch"); ok || reason != "invalid" {
		t.Fatalf("want invalid, got ok=%v reason=%q", ok, reason)
	}
	if ok, reason := r.Available("free_one"); !ok || reason != "" {
		t.Fatalf("want available, got ok=%v reason=%q", ok, reason)
	}
}

func TestRegistryPersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "handles.json")
	r := NewHandleRegistry(path, map[string]bool{})
	r.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "claim", "chuck", 5, 0)})

	reloaded := NewHandleRegistry(path, map[string]bool{})
	if _, ok := reloaded.Resolve("chuck"); !ok {
		t.Fatal("registry should load persisted state")
	}
}
