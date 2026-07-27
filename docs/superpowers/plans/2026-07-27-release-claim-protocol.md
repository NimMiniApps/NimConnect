# Release Claim Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `RELEASE` claim type (`0x07`) to the shared handle registry protocol so a handle's current owner can give it up, mirrored across NimConnect's backend and `packages/profile-client`, gated by an activation height so no historical transaction is retroactively reinterpreted.

**Architecture:** `RELEASE` reuses the existing claim payload shape (`magic + version + type + handle`, no address), so it fits the same 26-char Nimiq Pay budget as a claim. The registry replay becomes a small per-handle state machine (claim assigns only if unowned, release clears only if sent by the current owner), applied identically in Go (`backend/`) and TypeScript (`packages/profile-client`). This plan does not touch NimFeed's codebase (separate repo) — it produces a written protocol contract for that migration instead, and it does not build any marketplace UI or wallet-send flow for releasing — that's the next plan, once this ships and both readers adopt the same activation height.

**Tech Stack:** Go (backend), TypeScript/Vitest (`packages/profile-client`).

## Global Constraints

- `RELEASE = 0x07` in the shared type namespace (`PROFILE_CLAIM=0x01, POST_INLINE=0x02, POST_START=0x03, POST_CHUNK=0x04, FOLLOW=0x05, UNFOLLOW=0x06, RELEASE=0x07`) — never `0x02`, which is NimFeed's `POST_INLINE`.
- Release payload has no target address — `"NF" 0x01 0x07 <handle>`, identical size budget to today's claim (fits Nimiq Pay's 64-char text envelope for handles up to 26 chars).
- A release is honored only when signed by the handle's current resolved owner (HTLC-routed senders resolve to their creating wallet, same as claims) and only at or after a configured activation height. Before activation, `0x07` payloads remain ignored, exactly as today.
- Registry replay order is unchanged: `(blockHeight, txIndex)` ascending.
- Default activation height must fail closed (releases never honored) until explicitly configured — never default to "always active."

---

### Task 1: `RELEASE` payload builder and parser (backend)

**Files:**
- Modify: `backend/handles.go`
- Test: `backend/handles_test.go`

**Interfaces:**
- Produces: `claimTypeRelease = 0x07` constant; `claimAction{ Handle string; IsRelease bool }` (adds `IsRelease` to the existing struct); `makeReleasePayload(handle string) string`; `parseClaimPayload`/`parseClaimData` now recognize both claim and release payloads and set `IsRelease` accordingly.

- [ ] **Step 1: Write the failing tests**

Add to `backend/handles_test.go`:

```go
// nimfeedRelease builds the raw binary RELEASE payload: "NF" 0x01 0x07 handle.
func nimfeedRelease(handle string) []byte {
	return append([]byte{0x4e, 0x46, 0x01, 0x07}, []byte(handle)...)
}

func TestParseClaimData_Release(t *testing.T) {
	hexOf := func(b []byte) string { return hex.EncodeToString(b) }

	action := parseClaimData(hexOf(nimfeedRelease("chuck")))
	if action == nil || action.Handle != "chuck" || !action.IsRelease {
		t.Fatalf("expected release action for chuck, got %+v", action)
	}

	// A claim payload must still parse as a non-release action.
	action = parseClaimData(hexOf(nimfeedClaim("chuck", "")))
	if action == nil || action.IsRelease {
		t.Fatalf("expected claim (non-release) action, got %+v", action)
	}

	// The NFH text envelope form works for releases too.
	action = parseClaimData(hexOf([]byte("NFH:" + hexOf(nimfeedRelease("chuck")))))
	if action == nil || action.Handle != "chuck" || !action.IsRelease {
		t.Fatalf("expected release via NFH envelope, got %+v", action)
	}

	// Our own makeReleasePayload round-trips.
	action = parseClaimData(hexOf([]byte(makeReleasePayload("a_1"))))
	if action == nil || action.Handle != "a_1" || !action.IsRelease {
		t.Fatalf("expected release round-trip, got %+v", action)
	}
}

func TestReleasePayloadFitsNimiqPayTextLimit(t *testing.T) {
	longest := makeReleasePayload(strings.Repeat("x", 26))
	if len(longest) > 64 {
		t.Errorf("release payload %q is %d chars, exceeds Nimiq Pay 64-char text limit", longest, len(longest))
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestParseClaimData_Release|TestReleasePayloadFitsNimiqPayTextLimit' -v`
Expected: FAIL — `IsRelease` does not exist on `claimAction`, `makeReleasePayload` is undefined.

- [ ] **Step 3: Implement the release type, builder, and parser**

In `backend/handles.go`, add the constant next to the existing ones:

```go
const (
	claimVersion     = 0x01
	claimTypeProfile = 0x01
	claimTypeRelease = 0x07 // next unused byte in NimFeed's shared type namespace (0x02-0x06 are taken by NimFeed's own post/follow types)
	claimTextPrefix  = "NFH:"
)
```

Change the struct and parser:

```go
type claimAction struct {
	Handle    string
	IsRelease bool
}

// makeReleasePayload builds the Nimiq Pay text envelope for giving up a
// handle. Same shape as makeClaimPayload — no target address — so it fits
// the same 26-char Nimiq Pay budget.
func makeReleasePayload(handle string) string {
	payload := append(append([]byte{}, claimMagic...), claimVersion, claimTypeRelease)
	payload = append(payload, []byte(handle)...)
	return claimTextPrefix + hex.EncodeToString(payload)
}

// parseClaimPayload decodes a binary PROFILE_CLAIM or RELEASE payload.
func parseClaimPayload(payload []byte) *claimAction {
	if len(payload) < 4 || !bytes.HasPrefix(payload, claimMagic) || payload[2] != claimVersion {
		return nil
	}
	var isRelease bool
	switch payload[3] {
	case claimTypeProfile:
		isRelease = false
	case claimTypeRelease:
		isRelease = true
	default:
		return nil
	}
	rest := payload[4:]
	// Username runs to the 0x00 separator (display name follows, claims only) or payload end.
	if i := bytes.IndexByte(rest, 0); i >= 0 {
		rest = rest[:i]
	}
	handle := string(rest)
	if !isValidHandle(handle) {
		return nil
	}
	return &claimAction{Handle: handle, IsRelease: isRelease}
}
```

No other function in the file needs to change — `parseClaimDataFromRaw` and `parseClaimData` already just call `parseClaimPayload` and pass the result through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestParseClaimData|TestReleasePayloadFitsNimiqPayTextLimit|TestClaimPayloadFitsNimiqPayTextLimit' -v`
Expected: PASS (including the pre-existing `TestParseClaimData` and `TestClaimPayloadFitsNimiqPayTextLimit`, unaffected by the change).

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `cd backend && go test ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/handles.go backend/handles_test.go
git commit -m "feat: add RELEASE claim-type parsing and payload builder"
```

---

### Task 2: Registry replay state machine with activation height (backend)

**Files:**
- Modify: `backend/handles_registry.go`
- Modify: `backend/main.go`
- Test: `backend/handles_registry_test.go`

**Interfaces:**
- Consumes: `claimAction{ Handle string; IsRelease bool }` from Task 1.
- Produces: `NewHandleRegistry(path string, reserved map[string]bool, releaseActivationHeight uint64) *HandleRegistry` (adds a third parameter); `Rebuild` now clears a handle on a valid post-activation release from its current owner.

- [ ] **Step 1: Write the failing tests**

Add to `backend/handles_registry_test.go`:

```go
func releaseTx(hash, sender, handle string, block, index uint64) rpcTx {
	return rpcTx{
		Hash: hash, Sender: sender, Recipient: "NQ77 REGISTRY",
		Data:        hex.EncodeToString([]byte(makeReleasePayload(handle))),
		BlockNumber: block, TransactionIndex: index,
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
		releaseTx("t2", "NQ11 OWNER", "chuck", 200, 0), // before activation height 1000
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
		releaseTx("t2", "NQ11 OWNER", "chuck", 200, 0), // exactly the activation height
		claimTx("t3", "NQ22 NEWOWNER", "chuck", 300, 0),
	})
	claim, ok := r.Resolve("chuck")
	if !ok || compactAddress(claim.Address) != "NQ22NEWOWNER" {
		t.Fatalf("release at the activation height must be honored: %+v ok=%v", claim, ok)
	}
}
```

Update `newTestRegistry` (used by the pre-existing tests in this file) to pass an activation height that doesn't affect them:

```go
func newTestRegistry(t *testing.T) *HandleRegistry {
	t.Helper()
	return NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{"nimiq": true}, 0)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestRebuild_Release' -v`
Expected: FAIL — `NewHandleRegistry` takes 2 arguments, not 3; releases aren't yet honored.

- [ ] **Step 3: Implement the state machine and activation height**

In `backend/handles_registry.go`:

```go
type HandleRegistry struct {
	path     string
	reserved map[string]bool
	// HTLCCreator resolves an HTLC contract address to the account that
	// created it (set by the syncer; nil = attribute to the raw sender).
	HTLCCreator             func(address string) string
	releaseActivationHeight uint64
	mu                      sync.RWMutex
	handles                 map[string]HandleClaim
}

func NewHandleRegistry(path string, reserved map[string]bool, releaseActivationHeight uint64) *HandleRegistry {
	r := &HandleRegistry{
		path: path, reserved: reserved, handles: map[string]HandleClaim{},
		releaseActivationHeight: releaseActivationHeight,
	}
	if data, err := readFileIfExists(path); err == nil && data != nil {
		var stored map[string]HandleClaim
		if json.Unmarshal(data, &stored) == nil && stored != nil {
			r.handles = stored
		}
	}
	return r
}
```

Replace the replay loop in `Rebuild`:

```go
// Rebuild replaces the registry from the registry address's full inbound tx
// list, applying claims and releases in chain order: a claim assigns a
// handle only when it is currently unowned; a release frees it only when
// sent by the currently resolved owner, and only at or after
// releaseActivationHeight (a release payload before that height is unknown
// data, exactly as it was before this type existed — this prevents any
// pre-existing on-chain data from being retroactively reinterpreted).
// ponytail: full-history rebuild each sweep; the NimFeed catalog address also
// carries posts/follows, so switch to cursor-paged incremental sync once the
// sweep gets slow (>~10k txs).
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
		if action == nil {
			continue
		}
		signer := normalizeAddress(claimantAddress(tx, r.HTLCCreator))

		if action.IsRelease {
			if tx.BlockNumber < r.releaseActivationHeight {
				continue
			}
			if owner, taken := next[action.Handle]; taken && compactAddress(owner.Address) == compactAddress(signer) {
				delete(next, action.Handle)
			}
			continue
		}

		if _, taken := next[action.Handle]; !taken {
			next[action.Handle] = HandleClaim{
				Handle:      action.Handle,
				Address:     signer,
				TxHash:      tx.Hash,
				BlockHeight: tx.BlockNumber,
				TxIndex:     tx.TransactionIndex,
			}
		}
	}

	r.mu.Lock()
	r.handles = next
	r.mu.Unlock()
	return r.persist(next)
}
```

Update the `TestClaimsArePermanent` test's doc comment context is unaffected (it tests two claims with no release in between, which still holds), but reword the file-level comment on `HandleRegistry` slightly is optional — skip it, the struct doc is still accurate about warm-start caching.

In `backend/main.go`, wire the activation height (fail-closed default — `math.MaxUint64` means "never honor a release until this is explicitly configured"):

```go
releaseActivationHeight := parseActivationHeight(getEnv("RELEASE_ACTIVATION_HEIGHT", ""))
...
registry := NewHandleRegistry(getEnv("HANDLES_FILE", "/data/handles.json"), reserved, releaseActivationHeight)
```

Add the small parsing helper next to `getEnv` in `main.go`:

```go
// parseActivationHeight parses RELEASE_ACTIVATION_HEIGHT. Empty or invalid
// input fails closed (math.MaxUint64: no release is ever honored) rather
// than defaulting to "always active," so RELEASE stays inert until an
// operator deliberately sets a real height.
func parseActivationHeight(v string) uint64 {
	if v == "" {
		return math.MaxUint64
	}
	h, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return math.MaxUint64
	}
	return h
}
```

Add `"math"` and `"strconv"` to `main.go`'s imports if not already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestRebuild' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite and build**

Run: `cd backend && go build ./... && go test ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/handles_registry.go backend/main.go backend/handles_registry_test.go
git commit -m "feat: honor RELEASE in registry replay behind an activation height"
```

---

### Task 3: `RELEASE` payload builder (profile-client)

**Files:**
- Modify: `packages/profile-client/src/claim.ts`
- Test: `packages/profile-client/src/claim.test.ts`

**Interfaces:**
- Produces: `buildHandleReleasePayload(handle: string): HandleClaimPayload` (same return shape as `buildHandleClaimPayload`, exported from `claim.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `packages/profile-client/src/claim.test.ts`:

```ts
import { buildHandleClaimPayload, buildHandleReleasePayload, isValidHandle, HANDLE_REGISTRY_ADDRESS } from './claim.js'

describe('buildHandleReleasePayload', () => {
  it('targets the shared registry address', () => {
    const { recipient } = buildHandleReleasePayload('chuck')
    expect(recipient).toBe(HANDLE_REGISTRY_ADDRESS)
  })

  it('encodes "NF" + version 0x01 + type 0x07 + handle bytes as the NFH: hex envelope', () => {
    // Mirrors backend/handles.go's makeReleasePayload — decode independently
    // here so this test fails if the two implementations ever drift.
    const { extraData } = buildHandleReleasePayload('chuck')
    expect(extraData.startsWith('NFH:')).toBe(true)

    const payloadHex = extraData.slice('NFH:'.length)
    const bytes = payloadHex.match(/../g)!.map((b) => parseInt(b, 16))
    expect(bytes.slice(0, 4)).toEqual([0x4e, 0x46, 0x01, 0x07])
    const handle = String.fromCharCode(...bytes.slice(4))
    expect(handle).toBe('chuck')
  })

  it('throws on an invalid handle', () => {
    expect(() => buildHandleReleasePayload('AB')).toThrow(/invalid handle/)
  })

  it('fits Nimiq Pay\'s 64-char text-transaction limit for the longest supported handle', () => {
    const { extraData } = buildHandleReleasePayload('x'.repeat(26))
    expect(extraData.length).toBeLessThanOrEqual(64)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/profile-client && npx vitest run claim.test.ts`
Expected: FAIL — `buildHandleReleasePayload` is not exported.

- [ ] **Step 3: Implement the release payload builder**

In `packages/profile-client/src/claim.ts`, add the type constant next to `CLAIM_TYPE_PROFILE` and the new builder function:

```ts
const CLAIM_TYPE_RELEASE = 0x07 // next unused byte in the shared NimFeed type namespace

/**
 * Builds the transaction payload for giving up a @handle you currently own,
 * freeing it for anyone to claim. Same shape as buildHandleClaimPayload — no
 * target address — so it fits the same Nimiq Pay text-transaction budget.
 * Only a transaction signed by the handle's current owner is honored by the
 * registry (see backend/handles_registry.go's Rebuild).
 */
export function buildHandleReleasePayload(handle: string): HandleClaimPayload {
  if (!isValidHandle(handle)) {
    throw new Error(`invalid handle: ${handle}`)
  }
  const bytes = [
    ...CLAIM_MAGIC,
    CLAIM_VERSION,
    CLAIM_TYPE_RELEASE,
    ...Array.from(handle, (c) => c.charCodeAt(0)),
  ]
  const extraDataBytes = new Uint8Array(bytes)
  const payloadHex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return {
    recipient: HANDLE_REGISTRY_ADDRESS,
    extraData: CLAIM_TEXT_PREFIX + payloadHex,
    extraDataBytes,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/profile-client && npx vitest run claim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/profile-client/src/claim.ts packages/profile-client/src/claim.test.ts
git commit -m "feat(profile-client): add buildHandleReleasePayload"
```

---

### Task 4: Registry replay state machine with activation height (profile-client)

**Files:**
- Modify: `packages/profile-client/src/registry.ts`
- Modify: `packages/profile-client/src/rpc.ts`
- Modify: `packages/profile-client/src/index.ts`
- Test: `packages/profile-client/src/registry.test.ts`

**Interfaces:**
- Consumes: `buildHandleReleasePayload` from Task 3.
- Produces: `parseClaimTxData(dataHex: string): { handle: string; isRelease: boolean } | null` (return shape gains `isRelease`); `resolveHandleRegistry(txs, options)` gains `options.releaseActivationHeight?: number` (default `Infinity` — fail closed, mirroring the backend's `math.MaxUint64` default); `FetchHandleRegistryOptions` gains the same passthrough field.

- [ ] **Step 1: Write the failing tests**

Add to `packages/profile-client/src/registry.test.ts`:

```ts
import { buildHandleReleasePayload } from './claim.js'

function releaseTx(hash: string, sender: string, handle: string, blockHeight: number, txIndex: number): RegistryTx {
  const { extraData } = buildHandleReleasePayload(handle)
  const data = Array.from(extraData, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return { hash, sender, data, blockHeight, txIndex }
}

describe('parseClaimTxData — release', () => {
  it('parses a release payload and marks isRelease true', () => {
    const tx = releaseTx('t1', 'NQ11 X', 'chuck', 1, 0)
    expect(parseClaimTxData(tx.data)).toEqual({ handle: 'chuck', isRelease: true })
  })

  it('marks a claim payload isRelease false', () => {
    const tx = claimTx('t1', 'NQ11 X', 'chuck', 1, 0)
    expect(parseClaimTxData(tx.data)).toEqual({ handle: 'chuck', isRelease: false })
  })
})

describe('resolveHandleRegistry — release and reclaim', () => {
  it('a release from the current owner frees the handle for the next claim', async () => {
    const registry = await resolveHandleRegistry(
      [
        claimTx('t1', 'NQ11 OWNER', 'chuck', 5, 0),
        releaseTx('t2', 'NQ11 OWNER', 'chuck', 200, 0),
        claimTx('t3', 'NQ22 NEWOWNER', 'chuck', 300, 0),
      ],
      { releaseActivationHeight: 100 },
    )
    expect(registry.get('chuck')).toMatchObject({ address: 'NQ22 NEWOWNER', txHash: 't3' })
  })

  it('a release from a non-owner is a no-op', async () => {
    const registry = await resolveHandleRegistry(
      [
        claimTx('t1', 'NQ11 OWNER', 'chuck', 5, 0),
        releaseTx('t2', 'NQ99 IMPOSTOR', 'chuck', 200, 0),
        claimTx('t3', 'NQ22 SNIPER', 'chuck', 300, 0),
      ],
      { releaseActivationHeight: 100 },
    )
    expect(registry.get('chuck')?.address).toBe('NQ11 OWNER')
  })

  it('a release before the activation height is ignored like unknown data', async () => {
    const registry = await resolveHandleRegistry(
      [
        claimTx('t1', 'NQ11 OWNER', 'chuck', 5, 0),
        releaseTx('t2', 'NQ11 OWNER', 'chuck', 200, 0),
        claimTx('t3', 'NQ22 SNIPER', 'chuck', 300, 0),
      ],
      { releaseActivationHeight: 1000 },
    )
    expect(registry.get('chuck')?.address).toBe('NQ11 OWNER')
  })

  it('defaults releaseActivationHeight to Infinity — releases are inert unless explicitly enabled', async () => {
    const registry = await resolveHandleRegistry([
      claimTx('t1', 'NQ11 OWNER', 'chuck', 5, 0),
      releaseTx('t2', 'NQ11 OWNER', 'chuck', 200, 0),
      claimTx('t3', 'NQ22 SNIPER', 'chuck', 300, 0),
    ])
    expect(registry.get('chuck')?.address).toBe('NQ11 OWNER')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/profile-client && npx vitest run registry.test.ts`
Expected: FAIL — `parseClaimTxData` doesn't return `isRelease`; `resolveHandleRegistry` doesn't accept or honor `releaseActivationHeight`.

- [ ] **Step 3: Implement the release-aware parser and state machine**

In `packages/profile-client/src/registry.ts`, update the constants and internal parser:

```ts
const CLAIM_TYPE_RELEASE = 0x07

function parseClaimPayload(payload: Uint8Array): { handle: string; isRelease: boolean } | null {
  if (
    payload.length < 4 ||
    payload[0] !== CLAIM_MAGIC0 ||
    payload[1] !== CLAIM_MAGIC1 ||
    payload[2] !== CLAIM_VERSION
  ) {
    return null
  }
  let isRelease: boolean
  if (payload[3] === CLAIM_TYPE_PROFILE) isRelease = false
  else if (payload[3] === CLAIM_TYPE_RELEASE) isRelease = true
  else return null

  let rest = payload.slice(4)
  const zeroIdx = rest.indexOf(0)
  if (zeroIdx >= 0) rest = rest.slice(0, zeroIdx)
  const handle = bytesToAscii(rest)
  return isValidHandle(handle) ? { handle, isRelease } : null
}
```

Update the public function's return type and doc comment:

```ts
export interface ParsedRegistryAction {
  handle: string
  isRelease: boolean
}

/**
 * Parses a transaction's hex data field into a claim or release action, or
 * null if it's neither (e.g. a post/follow on the same shared registry
 * address). Accepts the raw binary form (Nimiq Hub), the "NFH:" text
 * envelope (Nimiq Pay), and Nimiq Pay's double-hex-encoded variant. Mirrors
 * backend/handles.go's parseClaimData byte-for-byte.
 */
export function parseClaimTxData(dataHex: string): ParsedRegistryAction | null {
  const raw = hexToBytes(dataHex)
  if (!raw) return null
  const direct = parseClaimDataFromRaw(raw)
  if (direct) return direct
  const ascii = bytesToAscii(raw)
  if (isHexDigitsString(ascii)) {
    const inner = hexToBytes(ascii)
    if (inner) return parseClaimDataFromRaw(inner)
  }
  return null
}
```

`parseClaimDataFromRaw` already just forwards to `parseClaimPayload` and returns its result unchanged, so it needs no edit beyond its inferred return type following `parseClaimPayload`'s new shape.

Add the activation-height option and rewrite the replay loop in `resolveHandleRegistry`:

```ts
export interface ResolveHandleRegistryOptions {
  resolveHtlcOwner?: (contractAddress: string) => string | null | Promise<string | null>
  /**
   * A release is honored only for transactions at or after this height —
   * before it, a RELEASE payload is treated as unknown data, exactly as it
   * was before this type existed. Defaults to Infinity (releases never
   * honored) so a caller must explicitly opt in once NimFeed and NimConnect
   * have coordinated a real activation height.
   */
  releaseActivationHeight?: number
}

export async function resolveHandleRegistry(
  txs: RegistryTx[],
  options: ResolveHandleRegistryOptions = {},
): Promise<Map<string, ResolvedHandleClaim>> {
  const releaseActivationHeight = options.releaseActivationHeight ?? Infinity
  const ordered = [...txs].sort((a, b) =>
    a.blockHeight !== b.blockHeight ? a.blockHeight - b.blockHeight : a.txIndex - b.txIndex,
  )
  const registry = new Map<string, ResolvedHandleClaim>()
  const htlcOwnerCache = new Map<string, string | null>()
  for (const tx of ordered) {
    const action = parseClaimTxData(tx.data)
    if (!action) continue
    const signer = await claimantAddress(tx, options.resolveHtlcOwner, htlcOwnerCache)

    if (action.isRelease) {
      if (tx.blockHeight < releaseActivationHeight) continue
      const owner = registry.get(action.handle)
      if (owner && compactAddress(owner.address) === compactAddress(signer)) {
        registry.delete(action.handle)
      }
      continue
    }

    if (!registry.has(action.handle)) {
      registry.set(action.handle, {
        handle: action.handle,
        address: signer,
        txHash: tx.hash,
        blockHeight: tx.blockHeight,
        txIndex: tx.txIndex,
      })
    }
  }
  return registry
}
```

In `packages/profile-client/src/rpc.ts`, add the passthrough field and forward it:

```ts
export interface FetchHandleRegistryOptions {
  rpcUrl?: string
  registryAddress?: string
  maxTx?: number
  resolveHtlcOwner?: ResolveHandleRegistryOptions['resolveHtlcOwner']
  /** Forwarded to resolveHandleRegistry; defaults to Infinity (releases never honored). */
  releaseActivationHeight?: ResolveHandleRegistryOptions['releaseActivationHeight']
}
```

```ts
  return resolveHandleRegistry(txs, {
    resolveHtlcOwner: options.resolveHtlcOwner ?? ((contractAddress) => resolveHtlcOwnerViaRpc(rpcUrl, contractAddress)),
    releaseActivationHeight: options.releaseActivationHeight,
  })
```

In `packages/profile-client/src/index.ts`, export the new builder and type:

```ts
export { buildHandleClaimPayload, buildHandleReleasePayload, isValidHandle, HANDLE_REGISTRY_ADDRESS } from './claim.js'
```

and add `ParsedRegistryAction` to the existing registry type export line:

```ts
export type { RegistryTx, ResolvedHandleClaim, ResolveHandleRegistryOptions, ParsedRegistryAction } from './registry.js'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/profile-client && npx vitest run registry.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full profile-client test suite and typecheck**

Run: `cd packages/profile-client && npx vitest run && npx tsc --noEmit`
Expected: PASS — this also catches any other file relying on `parseClaimTxData`'s old `{ handle } | null` shape.

- [ ] **Step 6: Commit**

```bash
git add packages/profile-client/src/registry.ts packages/profile-client/src/rpc.ts packages/profile-client/src/index.ts packages/profile-client/src/registry.test.ts
git commit -m "feat(profile-client): honor RELEASE in registry replay behind an activation height"
```

---

### Task 5: NimFeed protocol contract (coordination document)

NimFeed is a separate repository this plan cannot modify directly, but `RELEASE` is only safe to enable once both readers agree on the byte value, the payload shape, and the activation height. This task produces the written contract to hand to that migration — it's a real deliverable (the exact values NimFeed's implementation must match), not a placeholder.

**Files:**
- Create: `docs/superpowers/specs/2026-07-27-nimfeed-release-protocol-contract.md`

- [ ] **Step 1: Write the contract document**

```markdown
# NimFeed RELEASE Protocol Contract

**Date:** 2026-07-27
**Status:** Ready for NimFeed implementation

This is the exact contract NimConnect's `RELEASE` implementation
(`backend/handles.go`, `packages/profile-client`) commits to. NimFeed's
resolver must match every value here before either reader enables release
handling — implemented ahead of an agreed activation height is safe (the
type byte is unrecognized until then); enabling recognition on only one side
is not.

## Type byte

`RELEASE = 0x07` in the shared type namespace already defined in
`NimFeed/src/protocol/constants.js`:

```js
export const TYPES = Object.freeze({
  PROFILE_CLAIM: 0x01,
  POST_INLINE: 0x02,
  POST_START: 0x03,
  POST_CHUNK: 0x04,
  FOLLOW: 0x05,
  UNFOLLOW: 0x06,
  RELEASE: 0x07, // add this
})
```

## Payload shape

Identical to a claim, no target address:

```text
raw binary (Hub):          "NF" 0x01 0x07 <handle>
text envelope (Nimiq Pay): "NFH:" + hex(raw payload)
```

## Activation height

A release is honored only for a transaction at or after a fixed block
height, agreed and hardcoded identically on both sides before deployment.
`0x07` before that height is unrecognized data, exactly as it is today —
this is what prevents any already-mined transaction that happens to contain
these bytes from being retroactively reinterpreted as a release.

**Action for NimFeed:** pick the activation height jointly with NimConnect's
`RELEASE_ACTIVATION_HEIGHT` deployment value; do not deploy independently
with a different height.

## Resolver semantics

Replay `(block_height, tx_index)` ascending as a per-username state machine:

- `CLAIM` assigns ownership only if the username is currently unowned.
- `RELEASE` (at or after the activation height) clears ownership only if its
  resolved signer is the username's current owner; from any other signer, or
  before the activation height, it is a recorded no-op.
- HTLC-routed transactions resolve to their creating wallet (NimFeed already
  does this for claims — apply the same resolution to releases).

## Required schema change

NimFeed's `profile_claims` table is primary-keyed `[username+address]`
(`NimFeed/src/db/schema.js`), which silently overwrites history: if an owner
claims, releases, and later reclaims the same username, the later claim
event replaces the earlier row and the release is lost.

Replace this with an **append-only event log**, one row per on-chain event
(claim or release), keyed by transaction identity/order
(`tx_hash` or `[block_height+tx_index]`) — never by `[username+address]`.
`getWinningClaim` becomes a resolver that replays this log through the state
machine above, not a single-table earliest-row lookup.

## Rollout

1. NimFeed implements the schema migration and resolver above, gated by the
   same activation height NimConnect uses, deployed but inert until that
   height is reached.
2. Full rescan of existing history through the new resolver (a release can
   only apply at or after the agreed activation height, so this rescan
   cannot change any handle's current owner before that point).
3. Confirm NimConnect and NimFeed resolve to the same owner for a shared set
   of test fixtures (claim, release, reclaim, non-owner release, HTLC-routed
   claim) before the activation height is reached on mainnet.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-27-nimfeed-release-protocol-contract.md
git commit -m "docs: write the NimFeed RELEASE protocol contract"
```

---

## Self-Review Notes

- **Spec coverage:** This plan covers the design spec's "Protocol change: RELEASE claim type," "Activation height," "Registry semantics," and "Cross-reader migration" sections in full. It deliberately does not cover "Wallet surface," "Trade flow," "Persisted state and accounting," "Trade state machine," "Custody controls," or "Rollout" beyond step 1 — those belong to the marketplace plan that follows this one, once `RELEASE` is live and activated on both readers.
- **Placeholder scan:** No TBDs; every step has runnable code and exact commands.
- **Type consistency:** `claimAction{ Handle, IsRelease }` (Go) and `ParsedRegistryAction{ handle, isRelease }` (TS) are used with the same field names throughout every task that references them. `NewHandleRegistry`'s third parameter (`releaseActivationHeight uint64`) and `resolveHandleRegistry`'s `options.releaseActivationHeight?: number` are named consistently across their respective test and implementation steps.
