package main

import (
	"encoding/hex"
	"path/filepath"
	"testing"
)

func claimTx(hash, sender, handle string, block, index uint64) rpcTx {
	return rpcTx{
		Hash: hash, Sender: sender, Recipient: "NQ77 REGISTRY",
		Data:        hex.EncodeToString([]byte(makeClaimPayload(handle))),
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
		claimTx("t2", "NQ22 LATE", "chuck", 10, 0),
		claimTx("t1", "NQ11 EARLY", "chuck", 5, 3),
		claimTx("t3", "NQ33 OTHER", "alice", 10, 1),
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
		claimTx("t2", "NQ22 SECOND", "chuck", 5, 7),
		claimTx("t1", "NQ11 FIRST", "chuck", 5, 2),
	})
	claim, _ := r.Resolve("chuck")
	if claim.TxHash != "t1" {
		t.Fatalf("lower tx index in same block should win: %+v", claim)
	}
}

func TestClaimsArePermanent(t *testing.T) {
	// The shared NimFeed protocol has no release type: once claimed, later
	// claims for the same handle never displace the owner.
	r := newTestRegistry(t)
	r.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 OWNER", "chuck", 5, 0),
		claimTx("t2", "NQ22 THIEF", "chuck", 800, 0),
	})
	claim, ok := r.Resolve("chuck")
	if !ok || compactAddress(claim.Address) != "NQ11OWNER" {
		t.Fatalf("original owner should keep the handle: %+v ok=%v", claim, ok)
	}
}

func TestReservedHandlesGateUIOnly(t *testing.T) {
	// Reserved names block NimConnect's claim UI, but resolution follows the
	// chain — a name claimed via NimFeed must resolve identically here.
	r := newTestRegistry(t)
	r.Rebuild([]rpcTx{claimTx("t1", "NQ11 X", "nimiq", 5, 0)})
	if _, ok := r.Resolve("nimiq"); !ok {
		t.Fatal("chain-claimed reserved handle must still resolve")
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

func TestResolveAddress(t *testing.T) {
	r := newTestRegistry(t)
	r.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)})
	claim, ok := r.ResolveAddress("NQ11OWNER") // spacing-insensitive
	if !ok || claim.Handle != "chuck" {
		t.Fatalf("want chuck, got %+v ok=%v", claim, ok)
	}
	if _, ok := r.ResolveAddress("NQ99 NOBODY"); ok {
		t.Fatal("unknown address must not resolve")
	}
}

func TestRegistryPersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "handles.json")
	r := NewHandleRegistry(path, map[string]bool{})
	r.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)})

	reloaded := NewHandleRegistry(path, map[string]bool{})
	if _, ok := reloaded.Resolve("chuck"); !ok {
		t.Fatal("registry should load persisted state")
	}
}
