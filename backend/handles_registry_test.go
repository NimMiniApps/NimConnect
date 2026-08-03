package main

import (
	"encoding/hex"
	"path/filepath"
	"testing"
	"time"
)

func claimTx(hash, sender, handle string, block, index uint64) rpcTx {
	return rpcTx{
		Hash: hash, Sender: sender, Recipient: "NQ77 REGISTRY",
		Data:             hex.EncodeToString([]byte(makeClaimPayload(handle))),
		BlockNumber:      block,
		TransactionIndex: ptrUint64(index),
	}
}

func releaseTx(hash, sender, handle string, block, index uint64) rpcTx {
	return rpcTx{
		Hash: hash, Sender: sender, Recipient: "NQ77 REGISTRY",
		Data:             hex.EncodeToString([]byte(makeReleasePayload(handle))),
		BlockNumber:      block,
		TransactionIndex: ptrUint64(index),
	}
}

func TestRebuild_ReleaseThenReclaim(t *testing.T) {
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 100)
	err := r.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 OWNER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 OWNER", "chuck", 200, 0),
		claimTx("t3", "NQ22 NEWOWNER", "chuck", 300, 0),
	})
	if err != nil {
		t.Fatal(err)
	}
	claim, ok := r.Resolve("chuck")
	if !ok || compactAddress(claim.Address) != "NQ22NEWOWNER" || claim.TxHash != "t3" {
		t.Fatalf("expected new owner after release+reclaim: %+v ok=%v", claim, ok)
	}
}

func TestHandleRegistryStatsFollowCurrentWinningClaims(t *testing.T) {
	path := filepath.Join(t.TempDir(), "handles.json")
	r := NewHandleRegistry(path, map[string]bool{}, 100)

	first := claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)
	first.Timestamp = time.Date(2026, 7, 20, 1, 0, 0, 0, time.UTC).UnixMilli()
	release := releaseTx("t2", "NQ11 OWNER", "chuck", 200, 0)
	reclaim := claimTx("t3", "NQ22 NEW", "chuck", 300, 0)
	reclaim.Timestamp = time.Date(2026, 7, 22, 1, 0, 0, 0, time.UTC).UnixMilli()
	alice := claimTx("t4", "NQ33 OWNER", "alice", 301, 0)
	alice.Timestamp = time.Date(2026, 7, 22, 2, 0, 0, 0, time.UTC).UnixMilli()

	if err := r.Rebuild([]rpcTx{first, release, reclaim, alice}); err != nil {
		t.Fatal(err)
	}
	got := r.Stats()
	if got.UniqueHandles != 2 || got.Days["2026-07-22"] != 2 {
		t.Fatalf("unexpected handle stats: %+v", got)
	}
	if got.Days["2026-07-20"] != 0 {
		t.Fatalf("released claim still counted on its old day: %+v", got)
	}

	reloaded := NewHandleRegistry(path, map[string]bool{}, 100)
	reloadedClaim, ok := reloaded.Resolve("chuck")
	if !ok || reloadedClaim.ClaimedAt != reclaim.Timestamp {
		t.Fatalf("reloaded claim timestamp = %d, want %d", reloadedClaim.ClaimedAt, reclaim.Timestamp)
	}
	if got := reloaded.Stats(); got.UniqueHandles != 2 || got.Days["2026-07-22"] != 2 {
		t.Fatalf("unexpected reloaded stats: %+v", got)
	}
}

func TestHandleRegistryStatsIncludeLegacyClaimWithoutDailyBucket(t *testing.T) {
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	if err := r.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)}); err != nil {
		t.Fatal(err)
	}

	got := r.Stats()
	if got.UniqueHandles != 1 {
		t.Fatalf("unique handles = %d, want 1", got.UniqueHandles)
	}
	if len(got.Days) != 0 {
		t.Fatalf("zero timestamp should not create a daily bucket: %+v", got.Days)
	}
}

func TestHandleRegistryClaimsReturnsCurrentClaimsAlphabetically(t *testing.T) {
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 100)
	if err := r.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 OLD", "chuck", 5, 0),
		claimTx("t2", "NQ22 OWNER", "alice", 6, 0),
		releaseTx("t3", "NQ11 OLD", "chuck", 200, 0),
		claimTx("t4", "NQ33 NEW", "chuck", 201, 0),
		claimTx("t5", "NQ44 OWNER", "bob", 202, 0),
		releaseTx("t6", "NQ44 OWNER", "bob", 203, 0),
	}); err != nil {
		t.Fatal(err)
	}

	claims := r.Claims()
	if len(claims) != 2 || claims[0].Handle != "alice" || claims[1].Handle != "chuck" {
		t.Fatalf("claims = %+v", claims)
	}
	if compactAddress(claims[1].Address) != "NQ33NEW" {
		t.Fatalf("reclaimed owner = %q, want NQ33 NEW", claims[1].Address)
	}

	claims[0].Handle = "mutated"
	if got := r.Claims(); got[0].Handle != "alice" {
		t.Fatalf("Claims exposed mutable registry state: %+v", got)
	}
}

func TestRebuild_ReleaseFromNonOwnerIsNoOp(t *testing.T) {
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 100)
	r.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 OWNER", "chuck", 5, 0),
		releaseTx("t2", "NQ99 IMPOSTOR", "chuck", 200, 0),
		claimTx("t3", "NQ22 SNIPER", "chuck", 300, 0),
	})
	claim, ok := r.Resolve("chuck")
	if !ok || compactAddress(claim.Address) != "NQ11OWNER" {
		t.Fatalf("release from a non-owner must not free the handle: %+v ok=%v", claim, ok)
	}
}

func TestRebuild_ReleaseBeforeActivationHeightIgnored(t *testing.T) {
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 1000)
	r.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 OWNER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 OWNER", "chuck", 200, 0),
		claimTx("t3", "NQ22 SNIPER", "chuck", 300, 0),
	})
	claim, ok := r.Resolve("chuck")
	if !ok || compactAddress(claim.Address) != "NQ11OWNER" {
		t.Fatalf("pre-activation release must be ignored like unknown data: %+v ok=%v", claim, ok)
	}
}

func TestRebuild_ReleaseAtActivationHeightIsHonored(t *testing.T) {
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 200)
	r.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 OWNER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 OWNER", "chuck", 200, 0),
		claimTx("t3", "NQ22 NEWOWNER", "chuck", 300, 0),
	})
	claim, ok := r.Resolve("chuck")
	if !ok || compactAddress(claim.Address) != "NQ22NEWOWNER" {
		t.Fatalf("release at the activation height must be honored: %+v ok=%v", claim, ok)
	}
}

func newTestRegistry(t *testing.T) *HandleRegistry {
	t.Helper()
	return NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{"nimiq": true}, 0)
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

func TestResolveAddress_MultipleClaimsSameAddress_EarliestWins(t *testing.T) {
	r := newTestRegistry(t)
	// Same address claims two handles; by-address lookup must deterministically
	// pick the earliest one, not whatever a random map iteration hits.
	r.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 OWNER", "second", 20, 0),
		claimTx("t2", "NQ11 OWNER", "first", 5, 0),
	})
	for i := 0; i < 20; i++ {
		claim, ok := r.ResolveAddress("NQ11 OWNER")
		if !ok || claim.Handle != "first" {
			t.Fatalf("want earliest claim 'first', got %+v ok=%v", claim, ok)
		}
	}
}

func TestRegistryPersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "handles.json")
	r := NewHandleRegistry(path, map[string]bool{}, 0)
	r.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)})

	reloaded := NewHandleRegistry(path, map[string]bool{}, 0)
	if _, ok := reloaded.Resolve("chuck"); !ok {
		t.Fatal("registry should load persisted state")
	}
}
