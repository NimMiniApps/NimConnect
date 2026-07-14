# Handle Registry Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go backend for on-chain @handles: index `NCC:` claim transactions from the chain, store signed off-chain profiles keyed by address, and expose the public resolve/profile API (spec §1+§2 of `docs/superpowers/specs/2026-07-14-public-profiles-and-pay-links-design.md`).

**Architecture:** Claims are dust txs to a registry address with text payload `NCC:v1:claim:<handle>`; the backend polls the registry address via public JSON-RPC (`https://rpc-mainnet.nimiqscan.com`, the endpoint NimFeed uses in production) and rebuilds a handle→claim map in chain order on every sweep — always-recompute makes reorg/ordering bugs self-healing. Profiles are client-serialized JSON strings signed with the wallet key (same `verifySignedMessage` scheme as the inbox), stored one file per address.

**Tech Stack:** Go stdlib (`net/http` mux with method+path patterns, `encoding/json`, `crypto/ed25519` via existing `auth.go`), file-based stores mirroring `inbox_store.go`, table tests mirroring `inbox_store_test.go`.

## Global Constraints

- All Go files go in `backend/`, package `main`, flat layout — follow the existing style (no new packages, no new dependencies beyond the existing `golang.org/x/crypto`).
- Error sentinels `errBadRequest`, `errUnauthorized`, `errConflict`, `errNotFound` already exist (see `backend/backup.go` / `backend/inbox.go`); reuse them, don't redeclare.
- Signature verification MUST go through the existing `verifySignedMessage(address, publicKeyHex, signatureHex, message)` in `backend/auth.go`.
- Address helpers `compactAddress`, `normalizeAddress`, `isValidNimiqAddress` already exist — reuse.
- File writes are atomic: write `<path>.tmp` then `os.Rename` (pattern in `inbox_store.go:80-95`).
- Run Go commands from `backend/`: `cd /home/maestro/Documents/projects/NimConnect/backend`.
- The whole feature is opt-in: when `REGISTRY_ADDRESS` is unset, the routes are simply not registered (requests 404) and no syncer runs — the backend keeps working for deployments that don't configure it.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Claim payload codec, handle rules, reserved list

**Files:**
- Create: `backend/handles.go`
- Test: `backend/handles_test.go`

**Interfaces:**
- Consumes: nothing project-specific.
- Produces: `isValidHandle(h string) bool`; `parseClaimData(dataHex string) *claimAction` with `type claimAction struct { Verb, Handle string }` (Verb is `"claim"` or `"release"`; nil for anything invalid/unknown); `loadReservedHandles(path string) map[string]bool`; `makeClaimPayload(verb, handle string) string` (the plain-text form, used by tests here and later by the frontend plan as reference).

- [ ] **Step 1: Write the failing test**

Create `backend/handles_test.go`:

```go
package main

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestIsValidHandle(t *testing.T) {
	valid := []string{"chuck", "a_1", "abc", "x2345678901234567890123456"} // 26 chars
	for _, h := range valid {
		if !isValidHandle(h) {
			t.Errorf("expected %q valid", h)
		}
	}
	invalid := []string{"", "ab", "Chuck", "chü", "has space", "x23456789012345678901234567", "dash-ed"}
	for _, h := range invalid {
		if isValidHandle(h) {
			t.Errorf("expected %q invalid", h)
		}
	}
}

func TestParseClaimData(t *testing.T) {
	hexOf := func(s string) string { return hex.EncodeToString([]byte(s)) }

	cases := []struct {
		name   string
		data   string
		verb   string
		handle string
	}{
		{"claim", hexOf("NCC:v1:claim:chuck"), "claim", "chuck"},
		{"release", hexOf("NCC:v1:release:chuck"), "release", "chuck"},
		{"0x prefix tolerated", "0x" + hexOf("NCC:v1:claim:chuck"), "claim", "chuck"},
		{"round trip", hexOf(makeClaimPayload("claim", "a_1")), "claim", "a_1"},
	}
	for _, c := range cases {
		got := parseClaimData(c.data)
		if got == nil || got.Verb != c.verb || got.Handle != c.handle {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}

	rejected := []string{
		"",                                  // empty
		"zz-not-hex",                        // not hex
		hexOf("hello world"),                // unrelated payload
		hexOf("NFH:0102"),                   // NimFeed payload
		hexOf("NCC:v1:claim:Chuck"),         // bad handle casing
		hexOf("NCC:v1:claim:ab"),            // too short
		hexOf("NCC:v1:transfer:chuck"),      // unknown verb -> ignored (forward compat)
		hexOf("NCC:v2:claim:chuck"),         // unknown version
		hexOf("NCC:v1:claim"),               // missing handle
	}
	for _, data := range rejected {
		if got := parseClaimData(data); got != nil {
			t.Errorf("expected nil for %q, got %+v", data, got)
		}
	}
}

func TestClaimPayloadFitsNimiqPayTextLimit(t *testing.T) {
	longest := makeClaimPayload("release", "x2345678901234567890123456")
	if len(longest) > 64 {
		t.Errorf("payload %q is %d chars, exceeds Nimiq Pay 64-char text limit", longest, len(longest))
	}
}

func TestLoadReservedHandles(t *testing.T) {
	// Missing file -> builtin defaults.
	set := loadReservedHandles(filepath.Join(t.TempDir(), "missing.json"))
	if !set["nimiq"] || !set["admin"] {
		t.Fatalf("builtin reserved set missing expected entries: %v", set)
	}

	// File overrides builtins entirely.
	path := filepath.Join(t.TempDir(), "reserved.json")
	os.WriteFile(path, []byte(`["OnlyThis"]`), 0o600)
	set = loadReservedHandles(path)
	if !set["onlythis"] || set["nimiq"] {
		t.Fatalf("file should replace builtins (lowercased): %v", set)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./... -run 'TestIsValidHandle|TestParseClaimData|TestClaimPayload|TestLoadReserved' -v`
Expected: compile FAILURE — `isValidHandle`, `parseClaimData`, `makeClaimPayload`, `loadReservedHandles` undefined.

- [ ] **Step 3: Implement**

Create `backend/handles.go`:

```go
package main

import (
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
)

// On-chain claim payload: plain text "NCC:v1:<verb>:<handle>" sent as tx data
// to the registry address. Text (not binary) so it's readable in explorers and
// parseable by any indexer. Longest form ("NCC:v1:release:" + 26-char handle)
// is 41 chars — inside Nimiq Pay's 64-char text transaction limit.
const claimPrefix = "NCC:v1:"

var handleRe = regexp.MustCompile(`^[a-z0-9_]{3,26}$`)

func isValidHandle(h string) bool { return handleRe.MatchString(h) }

type claimAction struct {
	Verb   string // "claim" | "release"
	Handle string
}

func makeClaimPayload(verb, handle string) string {
	return claimPrefix + verb + ":" + handle
}

// parseClaimData decodes hex-encoded tx data into a claim action.
// Returns nil for anything that isn't a valid NimConnect claim — including
// unknown verbs, so future types (transfer, verify, …) don't break old indexers.
func parseClaimData(dataHex string) *claimAction {
	raw, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(dataHex), "0x"))
	if err != nil {
		return nil
	}
	text := string(raw)
	if !strings.HasPrefix(text, claimPrefix) {
		return nil
	}
	verb, handle, ok := strings.Cut(strings.TrimPrefix(text, claimPrefix), ":")
	if !ok || (verb != "claim" && verb != "release") || !isValidHandle(handle) {
		return nil
	}
	return &claimAction{Verb: verb, Handle: handle}
}

var builtinReserved = []string{
	"nimiq", "nimconnect", "nimpay", "nimfeed", "admin", "administrator",
	"support", "help", "official", "team", "security", "wallet", "pay", "root",
}

// loadReservedHandles reads a JSON string array; a valid non-empty file
// replaces the builtin set entirely. Entries are lowercased.
func loadReservedHandles(path string) map[string]bool {
	list := builtinReserved
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var fromFile []string
		if json.Unmarshal(data, &fromFile) == nil && len(fromFile) > 0 {
			list = fromFile
		}
	}
	set := make(map[string]bool, len(list))
	for _, h := range list {
		set[strings.ToLower(h)] = true
	}
	return set
}
```

Also add this small helper at the bottom of `backend/handles.go` (used above and by Task 3):

```go
// readFileIfExists returns (nil, nil) for a missing file, contents otherwise.
func readFileIfExists(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	return data, err
}
```

and add `"os"` to the imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./... -v -run 'TestIsValidHandle|TestParseClaimData|TestClaimPayload|TestLoadReserved'`
Expected: PASS (4 tests). Then run the whole suite: `go test ./...` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add handles.go handles_test.go
git commit -m "feat(backend): NCC claim payload codec, handle rules, reserved list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Minimal Nimiq JSON-RPC client

**Files:**
- Create: `backend/nimiq_rpc.go`
- Test: `backend/nimiq_rpc_test.go`

**Interfaces:**
- Consumes: `*http.Client` (main.go already builds one with a 10s timeout).
- Produces: `NewNimiqRPC(client *http.Client, url string) *NimiqRPC`; `(*NimiqRPC).GetTransactionsByAddress(address string, max int) ([]rpcTx, error)`; `(*NimiqRPC).GetTransactionByHash(hash string) (*rpcTx, error)`; `type rpcTx` with accessor methods `sender() string`, `recipient() string`, `data() string` and fields `Hash string`, `BlockNumber uint64`, `TransactionIndex uint64`. Tasks 3–4 consume `rpcTx`.

- [ ] **Step 1: Write the failing test**

Create `backend/nimiq_rpc_test.go`:

```go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeRPC answers JSON-RPC calls with canned results keyed by method.
func fakeRPC(t *testing.T, results map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		result, ok := results[req.Method]
		if !ok {
			result = `null`
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + result + `}`))
	}))
}

func TestGetTransactionsByAddressUnwrapsDataEnvelope(t *testing.T) {
	// PoS RPC wraps results as {"data": ...}; field names vary by node version.
	srv := fakeRPC(t, map[string]string{
		"getTransactionsByAddress": `{"data":[
			{"hash":"aa","from":"NQ11","to":"NQ22","recipientData":"0102","blockNumber":7,"transactionIndex":1},
			{"hash":"bb","sender":"NQ33","recipient":"NQ44","data":"0304","blockNumber":8,"transactionIndex":0}
		]}`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	txs, err := rpc.GetTransactionsByAddress("NQ22", 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(txs) != 2 {
		t.Fatalf("want 2 txs, got %d", len(txs))
	}
	if txs[0].sender() != "NQ11" || txs[0].recipient() != "NQ22" || txs[0].data() != "0102" {
		t.Errorf("from/to/recipientData variant not normalized: %+v", txs[0])
	}
	if txs[1].sender() != "NQ33" || txs[1].data() != "0304" {
		t.Errorf("sender/recipient/data variant not normalized: %+v", txs[1])
	}
}

func TestGetTransactionByHash(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getTransactionByHash": `{"hash":"cc","sender":"NQ55","recipient":"NQ66","data":"","blockNumber":9,"transactionIndex":2}`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	tx, err := rpc.GetTransactionByHash("cc")
	if err != nil {
		t.Fatal(err)
	}
	if tx.Hash != "cc" || tx.BlockNumber != 9 || tx.TransactionIndex != 2 {
		t.Errorf("unexpected tx: %+v", tx)
	}
}

func TestRPCErrorSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"nope"}}`))
	}))
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	if _, err := rpc.GetTransactionByHash("cc"); err == nil {
		t.Fatal("expected error from RPC error response")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./... -run TestGetTransactions -v`
Expected: compile FAILURE — `NewNimiqRPC` undefined.

- [ ] **Step 3: Implement**

Create `backend/nimiq_rpc.go`:

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
)

// NimiqRPC is a minimal JSON-RPC client for a Nimiq PoS node / public gateway.
// ponytail: positional params only; add the object-param calling convention
// if a target node ever rejects positional (NimFeed supports both).
type NimiqRPC struct {
	url    string
	client *http.Client
	id     atomic.Int64
}

func NewNimiqRPC(client *http.Client, url string) *NimiqRPC {
	return &NimiqRPC{url: url, client: client}
}

// rpcTx tolerates the field-name variants different node versions emit
// (from/to vs sender/recipient, data vs recipientData) — same normalization
// NimFeed applies.
type rpcTx struct {
	Hash             string `json:"hash"`
	Sender           string `json:"sender"`
	From             string `json:"from"`
	Recipient        string `json:"recipient"`
	To               string `json:"to"`
	Data             string `json:"data"`
	RecipientData    string `json:"recipientData"`
	BlockNumber      uint64 `json:"blockNumber"`
	TransactionIndex uint64 `json:"transactionIndex"`
}

func (t rpcTx) sender() string {
	if t.Sender != "" {
		return t.Sender
	}
	return t.From
}

func (t rpcTx) recipient() string {
	if t.Recipient != "" {
		return t.Recipient
	}
	return t.To
}

func (t rpcTx) data() string {
	if t.Data != "" {
		return t.Data
	}
	return t.RecipientData
}

func (c *NimiqRPC) call(method string, params []any, out any) error {
	body, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": c.id.Add(1), "method": method, "params": params,
	})
	if err != nil {
		return err
	}
	resp, err := c.client.Post(c.url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return err
	}
	if envelope.Error != nil {
		return fmt.Errorf("rpc %s: %s", method, envelope.Error.Message)
	}
	// PoS gateways wrap results as {"data": ...}; unwrap when present.
	var wrapped struct {
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(envelope.Result, &wrapped) == nil && wrapped.Data != nil {
		return json.Unmarshal(wrapped.Data, out)
	}
	return json.Unmarshal(envelope.Result, out)
}

func (c *NimiqRPC) GetTransactionsByAddress(address string, max int) ([]rpcTx, error) {
	var txs []rpcTx
	if err := c.call("getTransactionsByAddress", []any{address, max, nil}, &txs); err != nil {
		return nil, err
	}
	return txs, nil
}

func (c *NimiqRPC) GetTransactionByHash(hash string) (*rpcTx, error) {
	var tx rpcTx
	if err := c.call("getTransactionByHash", []any{hash}, &tx); err != nil {
		return nil, err
	}
	return &tx, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./... -run 'TestGetTransactions|TestGetTransactionByHash|TestRPCError' -v`
Expected: PASS. Then `go test ./...` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add nimiq_rpc.go nimiq_rpc_test.go
git commit -m "feat(backend): minimal Nimiq JSON-RPC client

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Handle registry — chain-order resolution + persistence

**Files:**
- Create: `backend/handles_registry.go`
- Test: `backend/handles_registry_test.go`

**Interfaces:**
- Consumes: `rpcTx` (Task 2), `parseClaimData`/`isValidHandle` (Task 1), `compactAddress`/`normalizeAddress` (existing).
- Produces: `type HandleClaim struct { Handle, Address, TxHash string; BlockHeight, TxIndex uint64 }` (JSON tags `handle`, `address`, `tx_hash`, `block_height`, `tx_index`); `NewHandleRegistry(path string, reserved map[string]bool) *HandleRegistry`; methods `Rebuild(txs []rpcTx) error`, `Resolve(handle string) (HandleClaim, bool)`, `Available(handle string) (bool, string)` (second value is a reason: `"invalid"`, `"reserved"`, `"taken"`, or `""` when available). Task 4 calls `Rebuild`; Task 6 calls `Resolve`/`Available`.

- [ ] **Step 1: Write the failing test**

Create `backend/handles_registry_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./... -run 'TestRebuild|TestRelease|TestReserved|TestRegistryPersists' -v`
Expected: compile FAILURE — `HandleRegistry` undefined.

- [ ] **Step 3: Implement**

Create `backend/handles_registry.go`:

```go
package main

import (
	"encoding/json"
	"os"
	"sort"
	"sync"
)

type HandleClaim struct {
	Handle      string `json:"handle"`
	Address     string `json:"address"`
	TxHash      string `json:"tx_hash"`
	BlockHeight uint64 `json:"block_height"`
	TxIndex     uint64 `json:"tx_index"`
}

// HandleRegistry maps handle -> winning claim. The whole map is recomputed
// from the registry address's tx history on every sweep (Rebuild), so ordering
// mistakes and reorgs self-heal; the JSON file is only a warm-start cache.
type HandleRegistry struct {
	path     string
	reserved map[string]bool
	mu       sync.RWMutex
	handles  map[string]HandleClaim
}

func NewHandleRegistry(path string, reserved map[string]bool) *HandleRegistry {
	r := &HandleRegistry{path: path, reserved: reserved, handles: map[string]HandleClaim{}}
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var stored map[string]HandleClaim
		if json.Unmarshal(data, &stored) == nil && stored != nil {
			r.handles = stored
		}
	}
	return r
}

// Rebuild replaces the registry from the registry address's full inbound tx
// list, applying claims and releases in chain order.
// ponytail: full-history rebuild each sweep; switch to cursor-paged
// incremental sync when the registry address accumulates >~10k txs.
func (r *HandleRegistry) Rebuild(txs []rpcTx) error {
	ordered := make([]rpcTx, len(txs))
	copy(ordered, txs)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].BlockNumber != ordered[j].BlockNumber {
			return ordered[i].BlockNumber < ordered[j].BlockNumber
		}
		return ordered[i].TransactionIndex < ordered[j].TransactionIndex
	})

	next := map[string]HandleClaim{}
	for _, tx := range ordered {
		action := parseClaimData(tx.data())
		if action == nil || r.reserved[action.Handle] {
			continue
		}
		switch action.Verb {
		case "claim":
			if _, taken := next[action.Handle]; !taken {
				next[action.Handle] = HandleClaim{
					Handle:      action.Handle,
					Address:     normalizeAddress(tx.sender()),
					TxHash:      tx.Hash,
					BlockHeight: tx.BlockNumber,
					TxIndex:     tx.TransactionIndex,
				}
			}
		case "release":
			if owner, taken := next[action.Handle]; taken &&
				compactAddress(owner.Address) == compactAddress(tx.sender()) {
				delete(next, action.Handle)
			}
		}
	}

	r.mu.Lock()
	r.handles = next
	r.mu.Unlock()
	return r.persist(next)
}

func (r *HandleRegistry) persist(handles map[string]HandleClaim) error {
	data, err := json.Marshal(handles)
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}

func (r *HandleRegistry) Resolve(handle string) (HandleClaim, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	claim, ok := r.handles[handle]
	return claim, ok
}

// Available reports whether a handle could be claimed and, when not, why:
// "invalid", "reserved", "taken". Advisory only — the chain decides.
func (r *HandleRegistry) Available(handle string) (bool, string) {
	if !isValidHandle(handle) {
		return false, "invalid"
	}
	if r.reserved[handle] {
		return false, "reserved"
	}
	if _, taken := r.Resolve(handle); taken {
		return false, "taken"
	}
	return true, ""
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./... -v -run 'TestRebuild|TestRelease|TestReserved|TestRegistryPersists'`
Expected: PASS (5 tests). Then `go test ./...` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add handles_registry.go handles_registry_test.go
git commit -m "feat(backend): handle registry with chain-order resolution and persistence

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Registry syncer — periodic reconcile + rate-limited on-demand sweep

**Files:**
- Create: `backend/handles_sync.go`
- Test: `backend/handles_sync_test.go`

**Interfaces:**
- Consumes: `*NimiqRPC` (Task 2), `*HandleRegistry.Rebuild` (Task 3).
- Produces: `NewHandleSyncer(rpc *NimiqRPC, registry *HandleRegistry, registryAddress string) *HandleSyncer`; methods `Sweep() error` (rate-limited: silently no-ops within 5s of the last sweep) and `Run(interval time.Duration, stop <-chan struct{})` (blocking loop; caller starts it as a goroutine). Task 6's claim-submit handler calls `Sweep()`.

- [ ] **Step 1: Write the failing test**

Create `backend/handles_sync_test.go`:

```go
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
		Data:        hex.EncodeToString([]byte("NCC:v1:claim:chuck")),
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./... -run TestSweep -v`
Expected: compile FAILURE — `NewHandleSyncer` undefined.

- [ ] **Step 3: Implement**

Create `backend/handles_sync.go`:

```go
package main

import (
	"log"
	"sync"
	"time"
)

const (
	sweepCooldown   = 5 * time.Second
	sweepMaxTxFetch = 5000
)

// HandleSyncer keeps the registry in sync with the chain: a periodic full
// sweep plus rate-limited on-demand sweeps after claim submissions.
type HandleSyncer struct {
	rpc             *NimiqRPC
	registry        *HandleRegistry
	registryAddress string
	mu              sync.Mutex
	lastSweep       time.Time
}

func NewHandleSyncer(rpc *NimiqRPC, registry *HandleRegistry, registryAddress string) *HandleSyncer {
	return &HandleSyncer{rpc: rpc, registry: registry, registryAddress: registryAddress}
}

// Sweep refetches the registry address's tx history and rebuilds the registry.
// No-ops silently when called again within the cooldown window.
func (s *HandleSyncer) Sweep() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.lastSweep) < sweepCooldown {
		return nil
	}
	txs, err := s.rpc.GetTransactionsByAddress(s.registryAddress, sweepMaxTxFetch)
	if err != nil {
		return err
	}
	s.lastSweep = time.Now()
	inbound := txs[:0]
	for _, tx := range txs {
		if compactAddress(tx.recipient()) == compactAddress(s.registryAddress) {
			inbound = append(inbound, tx)
		}
	}
	return s.registry.Rebuild(inbound)
}

// Run sweeps on a fixed interval until stop closes. Start as a goroutine.
func (s *HandleSyncer) Run(interval time.Duration, stop <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := s.Sweep(); err != nil {
			log.Printf("handle sync sweep failed err=%q", err)
		}
		select {
		case <-ticker.C:
		case <-stop:
			return
		}
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./... -v -run TestSweep`
Expected: PASS (2 tests). Then `go test ./...` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add handles_sync.go handles_sync_test.go
git commit -m "feat(backend): registry syncer — periodic reconcile with rate-limited sweeps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Profile store — signed, address-keyed, replay-protected

**Files:**
- Create: `backend/profiles.go`
- Test: `backend/profiles_test.go`

**Interfaces:**
- Consumes: `verifySignedMessage`, `compactAddress`, `normalizeAddress`, `isValidNimiqAddress`, `sha256Hex` (existing), error sentinels.
- Produces: `NewProfileStore(dir string) *ProfileStore`; `type ProfilePutRequest struct { Address string; UpdatedAt int64; Profile string; PublicKey string; Signature string }` (JSON tags `address`, `updated_at`, `profile`, `public_key`, `signature`; `Profile` is the client-serialized JSON string, signed as-is — no server-side canonicalization); `type StoredProfile struct { Address string; UpdatedAt int64; Profile string; PublicKey string; Signature string }` (same tags); methods `Put(req ProfilePutRequest) error`, `Get(address string) (StoredProfile, error)`, `Delete(address string, updatedAt int64, publicKey, signature string) error`; canonical messages `profilePutMessage(address string, updatedAt int64, payloadHash string) string` and `profileDeleteMessage(address string, updatedAt int64) string`. Task 6 consumes all of it; the frontend plan will sign these exact messages.

- [ ] **Step 1: Write the failing test**

Create `backend/profiles_test.go`. It needs a real keypair; reuse the helper approach from `auth_test.go` — read that file first and reuse its key/signing helper if one exists (`grep -n "GenerateKey\|sign" auth_test.go`). If `auth_test.go` has no reusable signing helper, define one here:

```go
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

// testSigner creates a keypair and returns (address, publicKeyHex, sign(message) -> signatureHex).
func testSigner(t *testing.T) (string, string, func(string) string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	address, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	sign := func(message string) string {
		hash := nimiqSignedMessageHash(message)
		return hex.EncodeToString(ed25519.Sign(priv, hash[:]))
	}
	return address, hex.EncodeToString(pub), sign
}

func validProfileJSON() string {
	return `{"display_name":"Chuck","bio":"Nimiq builder","tags":["friend"]}`
}

func putReq(t *testing.T, updatedAt int64, profile string) (ProfilePutRequest, string) {
	t.Helper()
	address, pubHex, sign := testSigner(t)
	return ProfilePutRequest{
		Address:   address,
		UpdatedAt: updatedAt,
		Profile:   profile,
		PublicKey: pubHex,
		Signature: sign(profilePutMessage(address, updatedAt, sha256Hex(profile))),
	}, address
}

func TestProfilePutGetRoundTrip(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	req, address := putReq(t, 1000, validProfileJSON())
	if err := store.Put(req); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	if got.Profile != validProfileJSON() || got.UpdatedAt != 1000 {
		t.Fatalf("round trip mismatch: %+v", got)
	}
}

func TestProfilePutRejectsBadSignature(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	req, _ := putReq(t, 1000, validProfileJSON())
	req.Profile = `{"display_name":"Tampered"}` // signature no longer matches
	if err := store.Put(req); !errors.Is(err, errUnauthorized) {
		t.Fatalf("want errUnauthorized, got %v", err)
	}
}

func TestProfilePutRejectsReplay(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	address, pubHex, sign := testSigner(t)
	mkReq := func(updatedAt int64, profile string) ProfilePutRequest {
		return ProfilePutRequest{
			Address: address, UpdatedAt: updatedAt, Profile: profile, PublicKey: pubHex,
			Signature: sign(profilePutMessage(address, updatedAt, sha256Hex(profile))),
		}
	}
	if err := store.Put(mkReq(2000, validProfileJSON())); err != nil {
		t.Fatal(err)
	}
	// Same timestamp and an older timestamp must both be rejected.
	if err := store.Put(mkReq(2000, `{"bio":"replayed"}`)); !errors.Is(err, errConflict) {
		t.Fatalf("want errConflict for same updated_at, got %v", err)
	}
	if err := store.Put(mkReq(1000, `{"bio":"older"}`)); !errors.Is(err, errConflict) {
		t.Fatalf("want errConflict for older updated_at, got %v", err)
	}
	// Newer is fine.
	if err := store.Put(mkReq(3000, `{"bio":"newer"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestProfilePayloadValidation(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	bad := []string{
		`not json`,
		`[]`,                                     // not an object
		`{"unknown_key":"x"}`,                    // unknown key
		`{"display_name":123}`,                   // wrong type
		`{"bio":"` + strings.Repeat("x", 400) + `"}`, // over cap
		`{"tags":["a","b","c","d","e","f","g","h","i"]}`, // too many tags
		`{"tags":[1]}`,                           // non-string tag
	}
	for _, profile := range bad {
		req, _ := putReq(t, 1000, profile)
		if err := store.Put(req); !errors.Is(err, errBadRequest) {
			t.Errorf("profile %q: want errBadRequest, got %v", profile, err)
		}
	}
}

func TestProfileDelete(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	address, pubHex, sign := testSigner(t)
	put := ProfilePutRequest{
		Address: address, UpdatedAt: 1000, Profile: validProfileJSON(), PublicKey: pubHex,
		Signature: sign(profilePutMessage(address, 1000, sha256Hex(validProfileJSON()))),
	}
	if err := store.Put(put); err != nil {
		t.Fatal(err)
	}
	// Delete needs a NEWER updated_at, signed.
	if err := store.Delete(address, 2000, pubHex, sign(profileDeleteMessage(address, 2000))); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(address); !errors.Is(err, errNotFound) {
		t.Fatalf("want errNotFound after delete, got %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./... -run TestProfile -v`
Expected: compile FAILURE — `ProfileStore` undefined. (If `auth_test.go` already defines a conflicting helper name, rename `testSigner` here.)

- [ ] **Step 3: Implement**

Create `backend/profiles.go`:

```go
package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
)

const profileMaxPayloadBytes = 2048

// Per-field caps mirror the SharedProfile limits in src/services/profile-share.ts.
var profileStringCaps = map[string]int{
	"display_name": 64,
	"bio":          300,
	"website":      200,
	"github":       39,
	"x":            15,
}

const (
	profileMaxTags   = 8
	profileTagMaxLen = 24
)

func profilePutMessage(address string, updatedAt int64, payloadHash string) string {
	return "nimconnect:profile:v1" +
		"\naddress=" + compactAddress(address) +
		"\nupdatedAt=" + strconv.FormatInt(updatedAt, 10) +
		"\npayloadHash=" + payloadHash
}

func profileDeleteMessage(address string, updatedAt int64) string {
	return "nimconnect:profile-delete:v1" +
		"\naddress=" + compactAddress(address) +
		"\nupdatedAt=" + strconv.FormatInt(updatedAt, 10)
}

// validateProfilePayload enforces the public-profile schema: a flat JSON
// object, whitelisted keys, capped strings, ≤8 short string tags.
// Unknown keys are rejected now; loosening later is non-breaking.
func validateProfilePayload(raw string) error {
	if len(raw) == 0 || len(raw) > profileMaxPayloadBytes {
		return errBadRequest
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil || obj == nil {
		return errBadRequest
	}
	for key, value := range obj {
		if cap, ok := profileStringCaps[key]; ok {
			s, isString := value.(string)
			if !isString || len(s) > cap {
				return errBadRequest
			}
			continue
		}
		if key == "tags" {
			tags, isArray := value.([]any)
			if !isArray || len(tags) > profileMaxTags {
				return errBadRequest
			}
			for _, tag := range tags {
				s, isString := tag.(string)
				if !isString || s == "" || len(s) > profileTagMaxLen {
					return errBadRequest
				}
			}
			continue
		}
		return errBadRequest // unknown key
	}
	return nil
}

type ProfilePutRequest struct {
	Address   string `json:"address"`
	UpdatedAt int64  `json:"updated_at"`
	Profile   string `json:"profile"`
	PublicKey string `json:"public_key"`
	Signature string `json:"signature"`
}

type StoredProfile struct {
	Address   string `json:"address"`
	UpdatedAt int64  `json:"updated_at"`
	Profile   string `json:"profile"`
	PublicKey string `json:"public_key"`
	Signature string `json:"signature"`
}

// ProfileStore holds one signed profile JSON file per address.
// ponytail: one global mutex; per-address locks if write volume ever matters.
type ProfileStore struct {
	dir string
	mu  sync.Mutex
}

func NewProfileStore(dir string) *ProfileStore {
	return &ProfileStore{dir: dir}
}

func (s *ProfileStore) path(compact string) string {
	return filepath.Join(s.dir, compact+".json")
}

// read returns the stored profile, errNotFound when absent. Callers hold s.mu.
func (s *ProfileStore) read(compact string) (StoredProfile, error) {
	var p StoredProfile
	data, err := readFileIfExists(s.path(compact))
	if err != nil {
		return p, err
	}
	if data == nil {
		return p, errNotFound
	}
	if err := json.Unmarshal(data, &p); err != nil {
		return p, err
	}
	return p, nil
}

func (s *ProfileStore) Put(req ProfilePutRequest) error {
	if !isValidNimiqAddress(req.Address) || req.UpdatedAt <= 0 {
		return errBadRequest
	}
	if err := validateProfilePayload(req.Profile); err != nil {
		return err
	}
	message := profilePutMessage(req.Address, req.UpdatedAt, sha256Hex(req.Profile))
	if err := verifySignedMessage(req.Address, req.PublicKey, req.Signature, message); err != nil {
		return errUnauthorized
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.read(compactAddress(req.Address))
	if err != nil && !errors.Is(err, errNotFound) {
		return err
	}
	if err == nil && req.UpdatedAt <= existing.UpdatedAt {
		return errConflict // replay or stale update
	}

	stored := StoredProfile{
		Address:   normalizeAddress(req.Address),
		UpdatedAt: req.UpdatedAt,
		Profile:   req.Profile,
		PublicKey: req.PublicKey,
		Signature: req.Signature,
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	path := s.path(compactAddress(req.Address))
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *ProfileStore) Get(address string) (StoredProfile, error) {
	if !isValidNimiqAddress(address) {
		return StoredProfile{}, errBadRequest
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read(compactAddress(address))
}

func (s *ProfileStore) Delete(address string, updatedAt int64, publicKey, signature string) error {
	if !isValidNimiqAddress(address) || updatedAt <= 0 {
		return errBadRequest
	}
	if err := verifySignedMessage(address, publicKey, signature, profileDeleteMessage(address, updatedAt)); err != nil {
		return errUnauthorized
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.read(compactAddress(address))
	if err != nil {
		return err
	}
	if updatedAt <= existing.UpdatedAt {
		return errConflict
	}
	return os.Remove(s.path(compactAddress(address)))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./... -v -run TestProfile`
Expected: PASS (5 tests). Then `go test ./...` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add profiles.go profiles_test.go
git commit -m "feat(backend): address-keyed profile store — signed writes, replay-protected

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: HTTP handlers + main.go wiring

**Files:**
- Create: `backend/handles_handlers.go`
- Test: `backend/handles_handlers_test.go`
- Modify: `backend/main.go:29-48`
- Modify: `backend/README.md` (endpoint list + env vars — match its existing format)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: public HTTP API —
  - `GET /api/resolve/{handle}` → 200 `{"handle","address","tx_hash","block_height","tx_index"}` with `ETag: "<tx_hash>"`, `Cache-Control: public, max-age=60`; 404 unknown; 400 invalid.
  - `GET /api/profile/{address}` → 200 `{"address","updated_at","profile":{…}}` with `ETag: "<updated_at>"`, same Cache-Control, 304 on `If-None-Match` match; 404/400.
  - `PUT /api/profile/{address}` (body = `ProfilePutRequest`, address must match path) → 204; 400/401/409.
  - `DELETE /api/profile/{address}` (headers `X-Profile-Updated-At`, `X-Profile-Public-Key`, `X-Profile-Signature`) → 204; 400/401/404/409.
  - `GET /api/handles/check?h=chuck` → 200 `{"handle","available",("reason")}` — advisory.
  - `POST /api/handles/claims` (body `{"tx_hash":"…"}`) → verifies the tx targets the registry and parses as a claim, sweeps, then 200 `{"status":"indexed"|"pending","claim":{…}|null}`.

- [ ] **Step 1: Write the failing test**

Create `backend/handles_handlers_test.go`:

```go
package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

// handlesTestMux wires the handlers exactly as main.go will.
func handlesTestMux(t *testing.T, registry *HandleRegistry, profiles *ProfileStore, syncer *HandleSyncer) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/resolve/{handle}", resolveHandler(registry))
	mux.HandleFunc("GET /api/profile/{address}", profileGetHandler(profiles))
	mux.HandleFunc("PUT /api/profile/{address}", profilePutHandler(profiles))
	mux.HandleFunc("DELETE /api/profile/{address}", profileDeleteHandler(profiles))
	mux.HandleFunc("GET /api/handles/check", handleCheckHandler(registry))
	if syncer != nil {
		mux.HandleFunc("POST /api/handles/claims", claimSubmitHandler(syncer, registry))
	}
	return mux
}

func seededRegistry(t *testing.T) *HandleRegistry {
	t.Helper()
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{"nimiq": true})
	r.Rebuild([]rpcTx{{
		Hash: "t1", Sender: "NQ11 OWNER", Recipient: "NQ77 REGISTRY",
		Data: hex.EncodeToString([]byte("NCC:v1:claim:chuck")), BlockNumber: 5,
	}})
	return r
}

func TestResolveHandler(t *testing.T) {
	mux := handlesTestMux(t, seededRegistry(t), NewProfileStore(t.TempDir()), nil)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resolve/chuck", nil))
	if rec.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("ETag") == "" || rec.Header().Get("Cache-Control") == "" {
		t.Error("missing cache headers")
	}
	var claim HandleClaim
	json.Unmarshal(rec.Body.Bytes(), &claim)
	if claim.Handle != "chuck" || compactAddress(claim.Address) != "NQ11OWNER" {
		t.Fatalf("unexpected claim: %+v", claim)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resolve/ghost", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown handle: want 404, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resolve/NOPE", nil))
	if rec.Code != 400 {
		t.Fatalf("invalid handle: want 400, got %d", rec.Code)
	}
}

func TestProfilePutGetDeleteOverHTTP(t *testing.T) {
	profiles := NewProfileStore(t.TempDir())
	mux := handlesTestMux(t, seededRegistry(t), profiles, nil)

	address, pubHex, sign := testSigner(t)
	profile := validProfileJSON()
	body, _ := json.Marshal(ProfilePutRequest{
		Address: address, UpdatedAt: 1000, Profile: profile, PublicKey: pubHex,
		Signature: sign(profilePutMessage(address, 1000, sha256Hex(profile))),
	})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/profile/"+compactAddress(address), bytes.NewReader(body)))
	if rec.Code != 204 {
		t.Fatalf("put: want 204, got %d: %s", rec.Code, rec.Body)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/profile/"+compactAddress(address), nil))
	if rec.Code != 200 {
		t.Fatalf("get: want 200, got %d", rec.Code)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	var got struct {
		Address   string          `json:"address"`
		UpdatedAt int64           `json:"updated_at"`
		Profile   json.RawMessage `json:"profile"`
	}
	json.Unmarshal(rec.Body.Bytes(), &got)
	if string(got.Profile) != profile {
		t.Fatalf("profile should be embedded raw: %s", got.Profile)
	}

	// Conditional GET -> 304.
	req := httptest.NewRequest("GET", "/api/profile/"+compactAddress(address), nil)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 304 {
		t.Fatalf("conditional get: want 304, got %d", rec.Code)
	}

	// Signed delete.
	req = httptest.NewRequest("DELETE", "/api/profile/"+compactAddress(address), nil)
	req.Header.Set("X-Profile-Updated-At", "2000")
	req.Header.Set("X-Profile-Public-Key", pubHex)
	req.Header.Set("X-Profile-Signature", sign(profileDeleteMessage(address, 2000)))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 204 {
		t.Fatalf("delete: want 204, got %d: %s", rec.Code, rec.Body)
	}
}

func TestProfilePutAddressMismatch(t *testing.T) {
	mux := handlesTestMux(t, seededRegistry(t), NewProfileStore(t.TempDir()), nil)
	address, pubHex, sign := testSigner(t)
	profile := validProfileJSON()
	body, _ := json.Marshal(ProfilePutRequest{
		Address: address, UpdatedAt: 1000, Profile: profile, PublicKey: pubHex,
		Signature: sign(profilePutMessage(address, 1000, sha256Hex(profile))),
	})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/profile/NQ110000000000000000000000000000000X", bytes.NewReader(body)))
	if rec.Code != 400 {
		t.Fatalf("path/body address mismatch: want 400, got %d", rec.Code)
	}
}

func TestHandleCheckAdvisory(t *testing.T) {
	mux := handlesTestMux(t, seededRegistry(t), NewProfileStore(t.TempDir()), nil)
	cases := map[string]string{
		"chuck":    `{"handle":"chuck","available":false,"reason":"taken"}`,
		"nimiq":    `{"handle":"nimiq","available":false,"reason":"reserved"}`,
		"free_one": `{"handle":"free_one","available":true}`,
	}
	for handle, want := range cases {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/handles/check?h="+handle, nil))
		if rec.Code != 200 {
			t.Fatalf("%s: want 200, got %d", handle, rec.Code)
		}
		var got, expected map[string]any
		json.Unmarshal(rec.Body.Bytes(), &got)
		json.Unmarshal([]byte(want), &expected)
		if got["available"] != expected["available"] || got["reason"] != expected["reason"] {
			t.Errorf("%s: got %v want %v", handle, got, expected)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./... -run 'TestResolveHandler|TestProfilePutGet|TestProfilePutAddress|TestHandleCheck' -v`
Expected: compile FAILURE — handlers undefined.

- [ ] **Step 3: Implement the handlers**

Create `backend/handles_handlers.go`:

```go
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
)

func writeCached(w http.ResponseWriter, r *http.Request, etag string, payload any) {
	w.Header().Set("ETag", `"`+etag+`"`)
	w.Header().Set("Cache-Control", "public, max-age=60")
	if r.Header.Get("If-None-Match") == `"`+etag+`"` {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(payload)
}

func resolveHandler(registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := r.PathValue("handle")
		if !isValidHandle(handle) {
			writeJSONError(w, http.StatusBadRequest, "invalid handle")
			return
		}
		claim, ok := registry.Resolve(handle)
		if !ok {
			writeJSONError(w, http.StatusNotFound, "unknown handle")
			return
		}
		writeCached(w, r, claim.TxHash, claim)
	}
}

func profileGetHandler(store *ProfileStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stored, err := store.Get(r.PathValue("address"))
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid address")
		case errors.Is(err, errNotFound):
			writeJSONError(w, http.StatusNotFound, "no profile")
		case err != nil:
			log.Printf("profile get error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "profiles unavailable")
		default:
			writeCached(w, r, strconv.FormatInt(stored.UpdatedAt, 10), map[string]any{
				"address":    stored.Address,
				"updated_at": stored.UpdatedAt,
				"profile":    json.RawMessage(stored.Profile),
			})
		}
	}
}

func profilePutHandler(store *ProfileStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req ProfilePutRequest
		r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if compactAddress(req.Address) != compactAddress(r.PathValue("address")) {
			writeJSONError(w, http.StatusBadRequest, "address mismatch")
			return
		}
		err := store.Put(req)
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid profile")
		case errors.Is(err, errUnauthorized):
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
		case errors.Is(err, errConflict):
			writeJSONError(w, http.StatusConflict, "stale updated_at")
		case err != nil:
			log.Printf("profile put error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "profiles unavailable")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

func profileDeleteHandler(store *ProfileStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		updatedAt, err := strconv.ParseInt(r.Header.Get("X-Profile-Updated-At"), 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid updated_at")
			return
		}
		err = store.Delete(
			r.PathValue("address"),
			updatedAt,
			r.Header.Get("X-Profile-Public-Key"),
			r.Header.Get("X-Profile-Signature"),
		)
		switch {
		case errors.Is(err, errBadRequest):
			writeJSONError(w, http.StatusBadRequest, "invalid request")
		case errors.Is(err, errUnauthorized):
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
		case errors.Is(err, errNotFound):
			writeJSONError(w, http.StatusNotFound, "no profile")
		case errors.Is(err, errConflict):
			writeJSONError(w, http.StatusConflict, "stale updated_at")
		case err != nil:
			log.Printf("profile delete error err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "profiles unavailable")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

// handleCheckHandler is advisory only — the chain is authoritative.
func handleCheckHandler(registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := r.URL.Query().Get("h")
		available, reason := registry.Available(handle)
		resp := map[string]any{"handle": handle, "available": available}
		if reason != "" {
			resp["reason"] = reason
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// claimSubmitHandler is the fast path after the app sends a claim tx: verify
// the tx targets the registry and parses, then sweep so it's indexed promptly.
func claimSubmitHandler(syncer *HandleSyncer, registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			TxHash string `json:"tx_hash"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.TxHash) == 0 || len(req.TxHash) > 128 {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		tx, err := syncer.rpc.GetTransactionByHash(req.TxHash)
		if err != nil {
			writeJSONError(w, http.StatusBadGateway, "chain lookup failed")
			return
		}
		action := parseClaimData(tx.data())
		if action == nil || compactAddress(tx.recipient()) != compactAddress(syncer.registryAddress) {
			writeJSONError(w, http.StatusBadRequest, "not a registry claim")
			return
		}
		if err := syncer.Sweep(); err != nil {
			log.Printf("claim submit sweep failed err=%q", err)
		}
		claim, ok := registry.Resolve(action.Handle)
		status := "pending" // tx seen but not yet in the indexed set (or lost the race)
		var body any
		if ok {
			status = "indexed"
			body = claim
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": status, "claim": body})
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./... -v -run 'TestResolveHandler|TestProfilePutGet|TestProfilePutAddress|TestHandleCheck'`
Expected: PASS. Then `go test ./...` — expected PASS.

- [ ] **Step 5: Wire into main.go**

In `backend/main.go`, add after `stats := NewStats(...)` (line 31):

```go
	// On-chain handle registry — disabled unless REGISTRY_ADDRESS is set.
	registryAddress := os.Getenv("REGISTRY_ADDRESS")
	if registryAddress != "" {
		rpc := NewNimiqRPC(httpClient, getEnv("NIMIQ_RPC_URL", "https://rpc-mainnet.nimiqscan.com"))
		reserved := loadReservedHandles(getEnv("RESERVED_HANDLES_FILE", "/data/reserved-handles.json"))
		registry := NewHandleRegistry(getEnv("HANDLES_FILE", "/data/handles.json"), reserved)
		profiles := NewProfileStore(getEnv("PROFILES_DIR", "/data/profiles"))
		syncer := NewHandleSyncer(rpc, registry, registryAddress)
		go syncer.Run(2*time.Minute, make(chan struct{}))

		mux.HandleFunc("GET /api/resolve/{handle}", resolveHandler(registry))
		mux.HandleFunc("GET /api/profile/{address}", profileGetHandler(profiles))
		mux.HandleFunc("PUT /api/profile/{address}", profilePutHandler(profiles))
		mux.HandleFunc("DELETE /api/profile/{address}", profileDeleteHandler(profiles))
		mux.HandleFunc("GET /api/handles/check", handleCheckHandler(registry))
		mux.HandleFunc("POST /api/handles/claims", claimSubmitHandler(syncer, registry))
	}
```

NOTE: this block references `mux`, so it must go AFTER `mux := http.NewServeMux()` (line 34) — place it between the existing route registrations and `log.Printf(...)`.

- [ ] **Step 6: Update backend/README.md**

Read `backend/README.md` first and add, matching its existing format: the six new endpoints, and env vars `REGISTRY_ADDRESS` (enables the feature), `NIMIQ_RPC_URL`, `HANDLES_FILE`, `PROFILES_DIR`, `RESERVED_HANDLES_FILE`.

- [ ] **Step 7: Full verification**

Run: `go vet ./... && go test ./...`
Expected: clean vet, all tests PASS.
Then a smoke run: `REGISTRY_ADDRESS='NQ77 0000 0000 0000 0000 0000 0000 0000 0000' HANDLES_FILE=/tmp/h.json PROFILES_DIR=/tmp/p go run . &` then `curl -s localhost:8787/api/handles/check?h=chuck` → expect `{"handle":"chuck","available":true}` (the first sweep against the real RPC may log an error for the dummy address — that's fine, endpoints still serve). Kill the server afterwards.

- [ ] **Step 8: Commit**

```bash
git add handles_handlers.go handles_handlers_test.go main.go README.md
git commit -m "feat(backend): handle registry API — resolve, profiles, check, claim submit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
