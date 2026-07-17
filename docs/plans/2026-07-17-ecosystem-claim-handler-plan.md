# Ecosystem Claim Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@nimconnect/profile-client`'s claim builder/parser the one canonical `@handle` claiming implementation for the Nimiq mini-app ecosystem, and migrate NimFeed onto it — dropping on-chain `displayName` in favor of NimConnect's off-chain profile, since NimFeed has no real users yet and can absorb this breaking change for free.

**Architecture:** `packages/profile-client`'s `claim.ts`/`registry.ts` already implement the byte-for-byte reference protocol NimConnect's Go backend (`backend/handles.go`) uses: `"NF" 0x01 0x01 <username>`, tolerant of raw binary (Hub), the `"NFH:"` hex-text envelope (Nimiq Pay), Nimiq Pay's double-hex variant, and swap-HTLC sender attribution. NimFeed's own `protocol/encoder.js`/`decoder.js` currently reinvent a *different, incompatible* claim payload (username + on-chain displayName) that only understands its own raw-binary form. This plan (a) extends the package's builder to also emit a raw-binary payload (NimFeed needs bytes, not hex-text, for its own wallet signing calls), (b) migrates NimFeed's claim building/parsing to call the package directly instead of maintaining parallel logic, and (c) replaces the removed on-chain display name with NimConnect off-chain-profile enrichment via `getDisplayIdentity`, mirroring the pattern NimBomber already uses (`apps/frontend/src/services/ecosystemProfile.ts`).

**No backend (Go) changes are required.** `backend/handles.go`'s `parseClaimData`/`claimantAddress` already implement the full tolerant protocol and already treat on-chain display name as parsed-but-discarded (`makeClaimPayload`'s comment: "display names live in the off-chain profile, not on chain"). This plan brings NimFeed in line with a decision the backend already made.

**Tech Stack:** TypeScript (`profile-client`, Vitest), Vue 3 + Vite + Dexie + Vitest (NimFeed).

## Global Constraints

- Claim wire format stays `"NF" (0x4e 0x46) + version 0x01 + type 0x01 + username bytes` — no on-chain display name in any new code path.
- `HANDLE_REGISTRY_ADDRESS` in `profile-client` (`NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y`) is mainnet-only; NimFeed must keep sending to its own network-configurable `POST_CATALOG_ADDRESS` (mainnet/testnet), never blindly trust `buildHandleClaimPayload(...).recipient`.
- Username charset/length stays `^[a-z0-9_]{3,31}$` everywhere — unchanged.
- Do not touch `POST_INLINE`/`POST_START`/`POST_CHUNK`/`FOLLOW`/`UNFOLLOW` encode/decode in NimFeed — those are NimFeed's own protocol, not shared.
- Do not modify `backend/handles.go`, `handles_registry.go`, or `handles_handlers.go` — verified already correct.
- `npm publish` for `@nimconnect/profile-client` is a real, irreversible, public action. No task in this plan runs it automatically — Task 2 ends with an explicit manual confirmation gate.

---

## Part A — `@nimconnect/profile-client` (repo: `NimConnect`)

### Task 1: Add raw-binary claim payload output

**Files:**
- Modify: `packages/profile-client/src/types.ts`
- Modify: `packages/profile-client/src/claim.ts`
- Test: `packages/profile-client/src/claim.test.ts`

**Interfaces:**
- Produces: `HandleClaimPayload` gains a new field `extraDataBytes: Uint8Array` — the raw binary payload (`"NF" 0x01 0x01 <username>`), for wallet SDKs that take binary `extraData` directly (e.g. Nimiq Hub, NimFeed's own signing path). Existing `extraData` (the `"NFH:"` hex-text envelope) and `recipient` are unchanged.

- [ ] **Step 1: Write the failing test**

Add to the end of `packages/profile-client/src/claim.test.ts` (inside the existing `describe('buildHandleClaimPayload', ...)` block):

```ts
  it('also returns the raw binary payload for wallets that accept binary extraData', () => {
    const { extraDataBytes } = buildHandleClaimPayload('chuck')
    expect(extraDataBytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(extraDataBytes.slice(0, 4))).toEqual([0x4e, 0x46, 0x01, 0x01])
    const handle = String.fromCharCode(...extraDataBytes.slice(4))
    expect(handle).toBe('chuck')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/profile-client && npx vitest run src/claim.test.ts`
Expected: FAIL — `extraDataBytes` is `undefined`, `toBeInstanceOf(Uint8Array)` fails.

- [ ] **Step 3: Implement**

In `packages/profile-client/src/types.ts`, change:

```ts
/** Recipient + tx data for claiming a @handle — sign and send with your own wallet integration. */
export interface HandleClaimPayload {
  recipient: string
  extraData: string
}
```

to:

```ts
/** Recipient + tx data for claiming a @handle — sign and send with your own wallet integration. */
export interface HandleClaimPayload {
  recipient: string
  /** "NFH:" + hex envelope — for wallets that only accept text extraData (e.g. Nimiq Pay). */
  extraData: string
  /** Raw binary payload — for wallets that accept binary extraData directly (e.g. Nimiq Hub). */
  extraDataBytes: Uint8Array
}
```

In `packages/profile-client/src/claim.ts`, change `buildHandleClaimPayload` from:

```ts
export function buildHandleClaimPayload(handle: string): HandleClaimPayload {
  if (!isValidHandle(handle)) {
    throw new Error(`invalid handle: ${handle}`)
  }
  const bytes = [
    ...CLAIM_MAGIC,
    CLAIM_VERSION,
    CLAIM_TYPE_PROFILE,
    ...Array.from(handle, (c) => c.charCodeAt(0)),
  ]
  const payloadHex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return { recipient: HANDLE_REGISTRY_ADDRESS, extraData: CLAIM_TEXT_PREFIX + payloadHex }
}
```

to:

```ts
export function buildHandleClaimPayload(handle: string): HandleClaimPayload {
  if (!isValidHandle(handle)) {
    throw new Error(`invalid handle: ${handle}`)
  }
  const bytes = [
    ...CLAIM_MAGIC,
    CLAIM_VERSION,
    CLAIM_TYPE_PROFILE,
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/profile-client && npx vitest run src/claim.test.ts`
Expected: PASS (all tests in the file, including the existing `extraData` one, which is untouched).

- [ ] **Step 5: Commit**

```bash
git add packages/profile-client/src/types.ts packages/profile-client/src/claim.ts packages/profile-client/src/claim.test.ts
git commit -m "feat(profile-client): expose raw binary claim payload alongside hex-text envelope"
```

---

### Task 2: Version bump, build, and manual publish gate

**Files:**
- Modify: `packages/profile-client/package.json`

- [ ] **Step 1: Bump the version**

In `packages/profile-client/package.json`, change `"version": "0.2.0"` to `"version": "0.3.0"` (additive field on an existing type — minor bump, not a breaking change for existing consumers like NimBomber, which never destructure `extraDataBytes`).

- [ ] **Step 2: Run the full package test suite**

Run: `cd packages/profile-client && npm test`
Expected: PASS — all existing suites (`client.test.ts`, `registry.test.ts`, `rpc.test.ts`, `nimiqAddress.test.ts`, `claim.test.ts`) still pass unchanged.

- [ ] **Step 3: Build**

Run: `cd packages/profile-client && npm run build`
Expected: `dist/claim.js`/`dist/claim.d.ts`/`dist/types.d.ts` regenerate with no TypeScript errors.

- [ ] **Step 4: Commit the version bump and rebuilt dist**

```bash
git add packages/profile-client/package.json packages/profile-client/dist
git commit -m "chore(profile-client): bump to 0.3.0, rebuild dist for raw binary claim payload"
```

- [ ] **Step 5: STOP — manual publish gate**

Do not run `npm publish` as part of automated execution. Ask the user to confirm and run it themselves (or explicitly authorize it) once this task is reviewed:

```bash
cd packages/profile-client && npm publish
```

Until this is published, Part B (NimFeed) must consume the package via `npm link` (see Task 3) rather than a real semver range.

---

## Part B — NimFeed (repo: `NimFeed`)

### Task 3: Depend on the updated package (local link for development)

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: `@nimconnect/profile-client`'s `buildHandleClaimPayload(handle: string): HandleClaimPayload` (Task 1) and `parseClaimTxData(dataHex: string): { handle: string } | null` (already exists, exported from `packages/profile-client/src/index.ts` via `registry.ts`).

- [ ] **Step 1: Link the package locally for development**

Until Task 2's `npm publish` happens, link the local build so NimFeed can develop/test against it:

```bash
cd /home/maestro/Documents/projects/NimConnect/packages/profile-client && npm link
cd /home/maestro/Documents/projects/NimFeed && npm link @nimconnect/profile-client
```

- [ ] **Step 2: Add the real dependency to package.json**

In `NimFeed/package.json`, add to `"dependencies"` (alphabetical, matches existing style):

```json
    "@nimconnect/profile-client": "^0.3.0",
    "@nimiq/hub-api": "^1.14.0",
```

- [ ] **Step 3: Verify the link resolves**

Run: `cd /home/maestro/Documents/projects/NimFeed && node -e "require('@nimconnect/profile-client')"`
Expected: no error (ESM package — if this errors on `require`, instead run `node --input-type=module -e "import('@nimconnect/profile-client').then(m => console.log(Object.keys(m)))"` and expect it to print an array including `buildHandleClaimPayload` and `parseClaimTxData`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: depend on @nimconnect/profile-client for shared claim protocol"
```

*(Before this ships to production, replace the `npm link` with a real install once Task 2's publish is confirmed: `npm install @nimconnect/profile-client@^0.3.0` and re-run `npm install` to refresh the lockfile with the registry-resolved tarball instead of the linked path.)*

---

### Task 4: Decoder/encoder delegate PROFILE_CLAIM to the package

**Files:**
- Modify: `src/protocol/decoder.js`
- Modify: `src/protocol/encoder.js`
- Test: `tests/protocol/decoder.test.js`
- Test: `tests/protocol/encoder.test.js`

**Interfaces:**
- Produces: `parseTransaction(tx)` for a `PROFILE_CLAIM` event now returns `{ txHash, from, to, blockHeight, txIndex, event: 'PROFILE_CLAIM', username }` — **no `displayName` field**. `encoder.js` no longer exports `buildProfileClaim`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/protocol/decoder.test.js` in full with:

```js
import { describe, it, expect } from 'vitest'
import { parseTransaction } from '../../src/protocol/decoder.js'
import { buildPostInline, buildPostStart, buildPostChunk } from '../../src/protocol/encoder.js'
import { bytesToHex, postIdToHex } from '../../src/protocol/utils.js'
import { POST_CATALOG_ADDRESS } from '../../src/protocol/constants.js'
import { encodeMiniAppEnvelope } from '../../src/protocol/miniAppEnvelope.js'
import { buildHandleClaimPayload } from '@nimconnect/profile-client'

function mockTx(payload, to = POST_CATALOG_ADDRESS) {
  return {
    hash: 'abc',
    from: 'NQ01SENDER',
    to,
    data: bytesToHex(payload),
    blockHeight: 100,
    transactionIndex: 0,
    timestamp: 0,
  }
}

describe('parseTransaction', () => {
  it('returns null for non-NF magic', () => {
    const tx = mockTx(new Uint8Array([0x00, 0x00, 0x01, 0x01]))
    expect(parseTransaction(tx)).toBeNull()
  })

  it('parses a raw-binary PROFILE_CLAIM (Hub) with no display name', () => {
    const { extraDataBytes } = buildHandleClaimPayload('bob')
    const tx = mockTx(extraDataBytes)
    const ev = parseTransaction(tx)
    expect(ev.event).toBe('PROFILE_CLAIM')
    expect(ev.username).toBe('bob')
    expect(ev.displayName).toBeUndefined()
    expect(ev.from).toBe('NQ01SENDER')
  })

  it('parses the "NFH:" hex-text envelope PROFILE_CLAIM (Nimiq Pay)', () => {
    const { extraData } = buildHandleClaimPayload('bob')
    const tx = mockTx(new TextEncoder().encode(extraData))
    const ev = parseTransaction(tx)
    expect(ev.event).toBe('PROFILE_CLAIM')
    expect(ev.username).toBe('bob')
  })

  it('parses POST_INLINE without reply', () => {
    const postId = new Uint8Array(8).fill(1)
    const tx = mockTx(buildPostInline(postId, 'hello world'))
    const ev = parseTransaction(tx)
    expect(ev.event).toBe('POST_INLINE')
    expect(ev.text).toBe('hello world')
    expect(ev.isReply).toBe(false)
  })

  it('parses a text-enveloped mini app post', () => {
    const payload = buildPostInline(new Uint8Array(8).fill(1), 'hello pay')
    const tx = mockTx(new TextEncoder().encode(encodeMiniAppEnvelope(payload)))
    const ev = parseTransaction(tx)

    expect(ev.event).toBe('POST_INLINE')
    expect(ev.text).toBe('hello pay')
  })

  it('parses POST_START', () => {
    const postId = new Uint8Array(8).fill(2)
    const hash = new Uint8Array(8).fill(0xab)
    const tx = mockTx(buildPostStart(postId, 3, true, hash))
    const ev = parseTransaction(tx)
    expect(ev.event).toBe('POST_START')
    expect(ev.totalChunks).toBe(3)
    expect(ev.compressed).toBe(true)
    expect(ev.contentHash).toHaveLength(16)
  })

  it('parses a compact-reply POST_START', () => {
    const postId = new Uint8Array(8).fill(2)
    const hash = new Uint8Array(8).fill(0xab)
    const replyPostId = new Uint8Array(8).fill(0x42)
    const tx = mockTx(buildPostStart(postId, 1, false, hash, { replyPostId }))
    const ev = parseTransaction(tx)

    expect(ev.event).toBe('POST_START')
    expect(ev.isReply).toBe(true)
    expect(ev.isCompactReply).toBe(true)
    expect(ev.replyToAuthor).toBeNull()
    expect(ev.replyToPostId).toBe(postIdToHex(replyPostId))
  })

  it('parses a full-reply POST_START with isCompactReply false', () => {
    const postId = new Uint8Array(8).fill(2)
    const hash = new Uint8Array(8).fill(0xab)
    const replyAuthor = new Uint8Array(20).fill(1)
    const replyPostId = new Uint8Array(8).fill(2)
    const tx = mockTx(buildPostStart(postId, 1, false, hash, { replyAuthor, replyPostId }))
    const ev = parseTransaction(tx)

    expect(ev.isReply).toBe(true)
    expect(ev.isCompactReply).toBe(false)
    expect(ev.replyToAuthor).not.toBeNull()
    expect(ev.replyToPostId).toBe(postIdToHex(replyPostId))
  })

  it('parses POST_CHUNK', () => {
    const postId = new Uint8Array(8).fill(3)
    const data = new Uint8Array(30).fill(0xcc)
    const tx = mockTx(buildPostChunk(postId, 1, data), 'NQ_DERIVED')
    const ev = parseTransaction(tx)
    expect(ev.event).toBe('POST_CHUNK')
    expect(ev.chunkIndex).toBe(1)
    expect(ev.dataLen).toBe(30)
  })
})
```

Replace `tests/protocol/encoder.test.js` in full with (drops the whole `buildProfileClaim` describe block, keeps everything else verbatim):

```js
import { describe, it, expect } from 'vitest'
import {
  buildPostInline,
  buildPostStart,
  buildPostChunk,
} from '../../src/protocol/encoder.js'
import { TYPES } from '../../src/protocol/constants.js'

describe('buildPostInline', () => {
  it('produces 64-byte payload', () => {
    const bytes = buildPostInline(new Uint8Array(8), 'hello')
    expect(bytes.byteLength).toBe(64)
    expect(bytes[3]).toBe(TYPES.POST_INLINE)
  })

  it('sets is_reply flag correctly', () => {
    const noReply = buildPostInline(new Uint8Array(8), 'hi')
    expect(noReply[12] & 0x01).toBe(0)

    const replyAuthor = new Uint8Array(20).fill(1)
    const replyPostId = new Uint8Array(8).fill(2)
    const withReply = buildPostInline(new Uint8Array(8), 'hi', { replyAuthor, replyPostId })
    expect(withReply[12] & 0x01).toBe(1)
  })
})

describe('buildPostStart', () => {
  it('produces 64-byte payload with total_chunks', () => {
    const postId = new Uint8Array(8).fill(7)
    const hash = new Uint8Array(8).fill(0xff)
    const bytes = buildPostStart(postId, 3, false, hash)
    expect(bytes.byteLength).toBe(64)
    expect(bytes[3]).toBe(TYPES.POST_START)
    expect(bytes[12]).toBe(3)
  })

  it('sets compressed flag in byte 13', () => {
    const postId = new Uint8Array(8)
    const hash = new Uint8Array(8)
    const noComp = buildPostStart(postId, 1, false, hash)
    const comp = buildPostStart(postId, 1, true, hash)
    expect(noComp[13] & 0x01).toBe(0)
    expect(comp[13] & 0x01).toBe(1)
  })

  it('produces a 30-byte compact-reply payload referencing only replyToPostId', () => {
    const postId = new Uint8Array(8).fill(7)
    const hash = new Uint8Array(8).fill(0xff)
    const replyPostId = new Uint8Array(8).fill(0x42)
    const bytes = buildPostStart(postId, 1, false, hash, { replyPostId })

    expect(bytes[13] & 0x02).toBe(0x02) // isReply
    expect(bytes[13] & 0x04).toBe(0x04) // compact
    expect(bytes.slice(22, 30)).toEqual(replyPostId)
    expect(bytes.slice(30, 50)).toEqual(new Uint8Array(20))
  })

  it('produces the existing 50-byte full-reply payload when replyAuthor is provided', () => {
    const postId = new Uint8Array(8).fill(7)
    const hash = new Uint8Array(8).fill(0xff)
    const replyAuthor = new Uint8Array(20).fill(1)
    const replyPostId = new Uint8Array(8).fill(2)
    const bytes = buildPostStart(postId, 1, false, hash, { replyAuthor, replyPostId })

    expect(bytes[13] & 0x02).toBe(0x02) // isReply
    expect(bytes[13] & 0x04).toBe(0x00) // not compact
    expect(bytes.slice(22, 42)).toEqual(replyAuthor)
    expect(bytes.slice(42, 50)).toEqual(replyPostId)
  })
})

describe('buildPostChunk', () => {
  it('produces 64-byte payload with chunk_index and data_len', () => {
    const postId = new Uint8Array(8).fill(9)
    const data = new Uint8Array(30).fill(0xaa)
    const bytes = buildPostChunk(postId, 2, data)
    expect(bytes.byteLength).toBe(64)
    expect(bytes[3]).toBe(TYPES.POST_CHUNK)
    expect(bytes[12]).toBe(2)
    expect(bytes[13]).toBe(30)
    expect(bytes.slice(14, 44)).toEqual(data)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/protocol/decoder.test.js tests/protocol/encoder.test.js`
Expected: FAIL — `buildProfileClaim` import errors (still exported from `encoder.js` at this point, but the test file no longer imports it — actual failure is the new decoder tests calling `buildHandleClaimPayload` while `decoder.js` still runs its own PROFILE_CLAIM parsing without package delegation, so `ev.displayName` is `'Bob B'`-shaped logic paths don't exist yet / raw-binary-only decode may still work by coincidence but the `"NFH:"` envelope test fails since current decoder rejects it at the version-byte check).

- [ ] **Step 3: Implement — remove `buildProfileClaim` from encoder.js**

In `src/protocol/encoder.js`, remove the `buildProfileClaim` function (lines 18-32) and its now-unused `normalizeUsername` import:

```js
import { MAGIC, VERSION, TYPES, CHUNK_DATA_SIZE } from './constants.js'
```

(drop `import { normalizeUsername } from './utils.js'` entirely — nothing else in this file uses it.)

- [ ] **Step 4: Implement — delegate PROFILE_CLAIM parsing in decoder.js**

Replace `src/protocol/decoder.js` in full with:

```js
import { TYPES, VERSION } from './constants.js'
import { hexToBytes, trimNulls, postIdToHex } from './utils.js'
import { addressBytesToNq, canonicalNqAddress } from './address.js'
import { decodeMiniAppEnvelopeHex } from './miniAppEnvelope.js'
import { parseClaimTxData } from '@nimconnect/profile-client'

const MAGIC_HEX = '4e46'

export function parseTransaction(tx) {
  const chainHex = (tx.data ?? '').toLowerCase().replace(/^0x/, '')
  const hex = decodeMiniAppEnvelopeHex(chainHex) ?? chainHex
  if (!hex || hex.length < 8) return null

  const base = {
    txHash: tx.hash,
    from: tx.from ? canonicalNqAddress(tx.from) : tx.from,
    to: tx.to ? canonicalNqAddress(tx.to) : tx.to,
    blockHeight: tx.blockHeight,
    txIndex: tx.transactionIndex ?? 0,
  }

  // Tried first: accepts raw binary (Hub), the "NFH:" text envelope (Nimiq
  // Pay), and Nimiq Pay's double-hex variant — none of which pass the
  // strict raw-binary magic/version check below. Non-claim txs (posts,
  // follows) correctly return null here since their type byte isn't
  // CLAIM_TYPE_PROFILE, and fall through to the dispatch below.
  const claim = parseClaimTxData(hex)
  if (claim) {
    return { ...base, event: 'PROFILE_CLAIM', username: claim.handle }
  }

  if (hex.slice(0, 4) !== MAGIC_HEX) return null
  const bytes = hexToBytes(hex)
  if (bytes[2] !== VERSION) return null

  const type = bytes[3]
  switch (type) {
    case TYPES.POST_INLINE:
      return decodePostInline(base, bytes)
    case TYPES.POST_START:
      return decodePostStart(base, bytes)
    case TYPES.POST_CHUNK:
      return decodePostChunk(base, bytes)
    case TYPES.FOLLOW:
      return decodeFollowUnfollow(base, bytes, 'FOLLOW')
    case TYPES.UNFOLLOW:
      return decodeFollowUnfollow(base, bytes, 'UNFOLLOW')
    default:
      return null
  }
}

function readNullTerminated(bytes, offset, maxLen) {
  return new TextDecoder().decode(trimNulls(bytes.slice(offset, offset + maxLen)))
}

function decodePostInline(base, bytes) {
  const postId = postIdToHex(bytes.slice(4, 12))
  const flags = bytes[12]
  const isReply = !!(flags & 0x01)
  let replyToAuthor = null
  let replyToPostId = null
  let text
  if (isReply) {
    replyToAuthor = addressBytesToNq(bytes.slice(13, 33))
    replyToPostId = postIdToHex(bytes.slice(33, 41))
    text = new TextDecoder().decode(trimNulls(bytes.slice(41, 64)))
  } else {
    text = new TextDecoder().decode(trimNulls(bytes.slice(13, 64)))
  }
  return { ...base, event: 'POST_INLINE', postId, isReply, replyToAuthor, replyToPostId, text }
}

function decodePostStart(base, bytes) {
  const postId = postIdToHex(bytes.slice(4, 12))
  const totalChunks = bytes[12]
  const flags = bytes[13]
  const compressed = !!(flags & 0x01)
  const isCompactReply = !!(flags & 0x04)
  const isReply = !!(flags & 0x02) || isCompactReply
  const contentHash = Array.from(bytes.slice(14, 22))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  let replyToAuthor = null
  let replyToPostId = null
  if (isCompactReply) {
    replyToPostId = postIdToHex(bytes.slice(22, 30))
  } else if (isReply) {
    replyToAuthor = addressBytesToNq(bytes.slice(22, 42))
    replyToPostId = postIdToHex(bytes.slice(42, 50))
  }
  return {
    ...base,
    event: 'POST_START',
    postId,
    totalChunks,
    compressed,
    contentHash,
    isReply,
    isCompactReply,
    replyToAuthor,
    replyToPostId,
  }
}

function decodePostChunk(base, bytes) {
  const postId = postIdToHex(bytes.slice(4, 12))
  const chunkIndex = bytes[12]
  const dataLen = bytes[13]
  const data = bytes.slice(14, 14 + dataLen)
  return { ...base, event: 'POST_CHUNK', postId, chunkIndex, dataLen, data }
}

function decodeFollowUnfollow(base, bytes, event) {
  const targetAddress = addressBytesToNq(bytes.slice(4, 24))
  return { ...base, event, targetAddress }
}
```

Note: `readNullTerminated` is kept (still used by `decodePostInline`/`decodePostStart` indirectly through `trimNulls`... actually only `trimNulls` is used directly in those two; `readNullTerminated` itself is now dead code since `decodeProfileClaim` was its only caller). Delete `readNullTerminated` entirely — it is unused after this change. Corrected final decoder.js should **not** include the `readNullTerminated` function at all (remove those 3 lines from the block above).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/protocol/decoder.test.js tests/protocol/encoder.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/protocol/encoder.js src/protocol/decoder.js tests/protocol/decoder.test.js tests/protocol/encoder.test.js
git commit -m "refactor: delegate PROFILE_CLAIM parsing to @nimconnect/profile-client, drop on-chain display name"
```

---

### Task 5: `usePost.js` claim flow drops `displayName`

**Files:**
- Modify: `src/composables/usePost.js`
- Test: `tests/composables/usePost.claimProfile.test.js`

**Interfaces:**
- Produces: `claimProfile(username: string): Promise<void>` — one argument, not two.
- Consumes: `buildHandleClaimPayload(handle: string): { recipient, extraData, extraDataBytes }` from `@nimconnect/profile-client` (Task 1).

- [ ] **Step 1: Write the failing test changes**

In `tests/composables/usePost.claimProfile.test.js`, update every call site from `claimProfile('maestro', 'Maestro')` to `claimProfile('maestro')` (5 occurrences: lines 79, 90, 103, 118, 135 in the original file). Example diff for one case — apply the same pattern to all five:

```js
  it('rejects when user is not logged in', async () => {
    mocks.auth.isLoggedIn = false
    const { claimProfile } = usePost()
    await expect(claimProfile('maestro')).rejects.toThrow('Not logged in')
    expect(mocks.signTransaction).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/composables/usePost.claimProfile.test.js`
Expected: FAIL — `claimProfile` still requires/uses a `displayName` argument that tests no longer pass (or passes but is now silently ignored — either way, the payload-shape assertion added in Step 4 below doesn't exist yet, so add it now as part of Step 1 too):

In the `'sends the compact profile claim through Nimiq Pay...'` test, add after the existing `sendMiniAppTransaction` assertion:

```js
    const sentPayload = mocks.sendMiniAppTransaction.mock.calls[0][0].extraData
    expect(Array.from(sentPayload.slice(0, 4))).toEqual([0x4e, 0x46, 0x01, 0x01])
    expect(String.fromCharCode(...sentPayload.slice(4))).toBe('maestro')
```

- [ ] **Step 3: Implement**

In `src/composables/usePost.js`, change the import block from:

```js
import {
  buildProfileClaim,
  buildPostInline,
  buildPostStart,
  buildPostChunk,
  splitInto50ByteChunks,
} from '../protocol/encoder.js'
```

to:

```js
import {
  buildPostInline,
  buildPostStart,
  buildPostChunk,
  splitInto50ByteChunks,
} from '../protocol/encoder.js'
import { buildHandleClaimPayload } from '@nimconnect/profile-client'
```

Change `claimProfile` from:

```js
  async function claimProfile(username, displayName) {
    if (!auth.isLoggedIn) throw new Error('Not logged in')
    const currentWinner = await getWinningClaim(username)
    if (currentWinner?.address && !sameAddress(currentWinner.address, auth.address)) {
      throw new Error(`@${username} is already taken.`)
    }

    const payload = buildProfileClaim(username, displayName)
    await sendPayload(POST_CATALOG_ADDRESS, payload)
    await startDeltaSync()
    await auth.loadProfile()
    if (auth.username !== username) {
      const winnerAfter = await getWinningClaim(username)
      if (winnerAfter?.address && !sameAddress(winnerAfter.address, auth.address)) {
        throw new Error(`@${username} is already taken.`)
      }
      throw new Error('Claim sent, but username is not confirmed yet. Please refresh and try again.')
    }
  }
```

to:

```js
  async function claimProfile(username) {
    if (!auth.isLoggedIn) throw new Error('Not logged in')
    const currentWinner = await getWinningClaim(username)
    if (currentWinner?.address && !sameAddress(currentWinner.address, auth.address)) {
      throw new Error(`@${username} is already taken.`)
    }

    const { extraDataBytes } = buildHandleClaimPayload(username)
    await sendPayload(POST_CATALOG_ADDRESS, extraDataBytes)
    await startDeltaSync()
    await auth.loadProfile()
    if (auth.username !== username) {
      const winnerAfter = await getWinningClaim(username)
      if (winnerAfter?.address && !sameAddress(winnerAfter.address, auth.address)) {
        throw new Error(`@${username} is already taken.`)
      }
      throw new Error('Claim sent, but username is not confirmed yet. Please refresh and try again.')
    }
  }
```

`buildHandleClaimPayload` throws `invalid handle: ${handle}` for a malformed username instead of the old silent lowercase-and-truncate behavior in `buildProfileClaim` — callers (Task 10) already validate with `normalizeUsername` before calling `claimProfile`, so this is a strictly stricter, not looser, guard.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/composables/usePost.claimProfile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/composables/usePost.js tests/composables/usePost.claimProfile.test.js
git commit -m "refactor: usePost.claimProfile uses @nimconnect/profile-client, drops on-chain display name"
```

---

### Task 6: Indexer stops writing on-chain display name

**Files:**
- Modify: `src/indexer/handlers.js`
- Test: `tests/indexer/handlers.test.js`

**Interfaces:**
- Produces: `handleProfileClaim(ev)` no longer reads `ev.displayName` (the field no longer exists on parsed `PROFILE_CLAIM` events per Task 4) and no longer writes `display_name` into `profile_claims` rows from a claim event. `db.users.display_name` is left untouched by claim processing from this point on (existing rows/behavior for reading it elsewhere are unaffected — it just never gets set from a claim again).

- [ ] **Step 1: Write the failing test changes**

Replace the first three `it(...)` blocks in `tests/indexer/handlers.test.js` (down through `'ignores PROFILE_CLAIM not sent to post catalog'`) with:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../src/db/schema.js'
import { processPostCatalogTx } from '../../src/indexer/handlers.js'
import { putPost } from '../../src/db/queries.js'
import { buildPostInline, buildPostStart } from '../../src/protocol/encoder.js'
import { bytesToHex, generatePostId, postIdToHex, hexToPostIdBytes } from '../../src/protocol/utils.js'
import { POST_CATALOG_ADDRESS } from '../../src/protocol/constants.js'
import { buildHandleClaimPayload } from '@nimconnect/profile-client'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

function tx(payload, from, to = POST_CATALOG_ADDRESS, blockHeight = 100, txIndex = 0) {
  return {
    hash: Math.random().toString(36),
    from,
    to,
    data: bytesToHex(payload),
    blockHeight,
    transactionIndex: txIndex,
    timestamp: 0,
  }
}

function claimPayload(handle) {
  return buildHandleClaimPayload(handle).extraDataBytes
}

describe('processPostCatalogTx', () => {
  it('indexes PROFILE_CLAIM into profile_claims and catalog_refs with no display name', async () => {
    await processPostCatalogTx(tx(claimPayload('alice'), 'NQ01 SENDER'))
    const row = await db.profile_claims.get(['alice', 'NQ01 SENDER'])
    expect(row?.display_name ?? null).toBeNull()
    const refs = await db.catalog_refs.where('type').equals('PROFILE_CLAIM').toArray()
    expect(refs).toHaveLength(1)
    const user = await db.users.get('NQ01 SENDER')
    expect(user?.username).toBe('alice')
  })

  it('reconciles username winner when older claim arrives later', async () => {
    await processPostCatalogTx(tx(claimPayload('alice'), 'NQ02 SECOND', POST_CATALOG_ADDRESS, 100, 0))
    let second = await db.users.get('NQ02 SECOND')
    expect(second?.username).toBe('alice')

    await processPostCatalogTx(tx(claimPayload('alice'), 'NQ01 FIRST', POST_CATALOG_ADDRESS, 90, 0))

    const first = await db.users.get('NQ01 FIRST')
    second = await db.users.get('NQ02 SECOND')
    expect(first?.username).toBe('alice')
    expect(second?.username ?? null).toBeNull()
  })

  it('ignores PROFILE_CLAIM not sent to post catalog', async () => {
    await processPostCatalogTx(tx(claimPayload('alice'), 'NQ01 SENDER', 'NQ02 OTHER'))
    const n = await db.profile_claims.count()
    expect(n).toBe(0)
  })
```

Leave the rest of the file (the `POST_INLINE` tests and everything after) exactly as-is — only the imports and the three tests above change.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/indexer/handlers.test.js`
Expected: FAIL — `row?.display_name` is currently `undefined` from `claimPayload` producing no displayName, but `handleProfileClaim` still references `ev.displayName` which is now `undefined` from Task 4's decoder — this specific assertion (`toBeNull()` vs current code's actual stored value) needs Step 3's implementation to align; more importantly `buildHandleClaimPayload` import will resolve fine (package already supports it) but `handlers.js` itself hasn't changed yet so confirm current behavior is inconsistent before the fix. Expected failure mode: no crash, but worth confirming test state before Step 3.

- [ ] **Step 3: Implement**

In `src/indexer/handlers.js`, change `handleProfileClaim` from:

```js
async function handleProfileClaim(ev) {
  const username = normalizeUsername(ev.username)
  if (!username) return

  await putProfileClaim({
    username,
    address: ev.from,
    display_name: ev.displayName,
    block_height: ev.blockHeight,
    tx_index: ev.txIndex,
    tx_hash: ev.txHash,
  })
```

to:

```js
async function handleProfileClaim(ev) {
  const username = normalizeUsername(ev.username)
  if (!username) return

  await putProfileClaim({
    username,
    address: ev.from,
    block_height: ev.blockHeight,
    tx_index: ev.txIndex,
    tx_hash: ev.txHash,
  })
```

(Leave the rest of the function — the `getWinningClaim`/`getLatestClaimByAddress`/`updateUser`/`putUser` winner-reconciliation logic further down — unchanged; `latest?.display_name` there will simply always be `undefined` going forward, which the existing `?? existingWinner?.display_name ?? null` fallback already handles safely.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/indexer/handlers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/handlers.js tests/indexer/handlers.test.js
git commit -m "fix: stop writing on-chain display name into profile_claims"
```

---

### Task 7: NimConnect enrichment service

**Files:**
- Create: `src/services/ecosystemProfile.js`
- Test: `tests/services/ecosystemProfile.test.js`

**Interfaces:**
- Produces: `fetchDisplayIdentity(address: string): Promise<DisplayIdentity>` and `pickDisplayName(identity, localUsername?, address?): string`, mirroring NimBomber's `apps/frontend/src/services/ecosystemProfile.ts` pattern (`DisplayIdentity` shape: `{ address, handle?, displayName?, bio?, links? }`).
- Consumes: `createProfileClient` from `@nimconnect/profile-client`.

- [ ] **Step 1: Write the failing test**

Create `tests/services/ecosystemProfile.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetDisplayIdentity = vi.fn()

vi.mock('@nimconnect/profile-client', () => ({
  createProfileClient: () => ({ getDisplayIdentity: mockGetDisplayIdentity }),
}))

import { fetchDisplayIdentity, pickDisplayName } from '../../src/services/ecosystemProfile.js'

describe('fetchDisplayIdentity', () => {
  beforeEach(() => {
    mockGetDisplayIdentity.mockReset()
  })

  it('delegates to the profile client', async () => {
    mockGetDisplayIdentity.mockResolvedValue({ address: 'NQ01', handle: 'chuck' })
    const result = await fetchDisplayIdentity('NQ01')
    expect(result).toEqual({ address: 'NQ01', handle: 'chuck' })
    expect(mockGetDisplayIdentity).toHaveBeenCalledWith('NQ01')
  })
})

describe('pickDisplayName', () => {
  it('prefers ecosystem displayName', () => {
    expect(pickDisplayName({ displayName: 'Chuck', handle: 'chuck' }, 'chuck', 'NQ01')).toBe('Chuck')
  })

  it('falls back to @handle when no display name', () => {
    expect(pickDisplayName({ handle: 'chuck' }, null, 'NQ01')).toBe('@chuck')
  })

  it('falls back to local username when no ecosystem identity', () => {
    expect(pickDisplayName(null, 'chuck', 'NQ01ABCDEFGH')).toBe('chuck')
  })

  it('falls back to address prefix when nothing else is available', () => {
    expect(pickDisplayName(null, null, 'NQ01 ABCD EFGH')).toBe('NQ01ABCD')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/ecosystemProfile.test.js`
Expected: FAIL — `Cannot find module '../../src/services/ecosystemProfile.js'`.

- [ ] **Step 3: Implement**

Create `src/services/ecosystemProfile.js`:

```js
// Uses the published @nimconnect/profile-client from npm — enrichment only,
// NimFeed's own on-chain claim (username) stays the source of truth for @handle.
import { createProfileClient } from '@nimconnect/profile-client'

const client = createProfileClient({
  baseUrl: import.meta.env.VITE_NIMCONNECT_API_URL || 'https://api-nimconnect.nimiqminiapps.com',
})

export function fetchDisplayIdentity(address) {
  return client.getDisplayIdentity(address)
}

export function pickDisplayName(identity, localUsername, address) {
  if (identity?.displayName) return identity.displayName
  if (identity?.handle) return `@${identity.handle}`
  if (localUsername) return localUsername
  return address ? address.replace(/\s+/g, '').slice(0, 8) : 'Unknown'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/ecosystemProfile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/ecosystemProfile.js tests/services/ecosystemProfile.test.js
git commit -m "feat: add NimConnect ecosystem-identity enrichment service"
```

---

### Task 8: `auth.js` store sources display name from enrichment

**Files:**
- Modify: `src/stores/auth.js`
- Test: `tests/stores/auth.test.js` (create — no existing test file for this store)

**Interfaces:**
- Consumes: `fetchDisplayIdentity(address)` from Task 7.
- Produces: `loadProfile()` unchanged signature; `displayName` ref now sourced from the ecosystem identity (falls back to `null` on fetch failure, same as before on missing local user).

- [ ] **Step 1: Write the failing test**

Create `tests/stores/auth.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  fetchDisplayIdentity: vi.fn(),
}))

vi.mock('../../src/db/queries.js', () => ({ getUser: mocks.getUser }))
vi.mock('../../src/services/ecosystemProfile.js', () => ({
  fetchDisplayIdentity: mocks.fetchDisplayIdentity,
}))

import { useAuthStore } from '../../src/stores/auth.js'

describe('auth store loadProfile', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.getUser.mockReset()
    mocks.fetchDisplayIdentity.mockReset()
  })

  it('sources display name from the ecosystem identity, not the local claim', async () => {
    mocks.getUser.mockResolvedValue({ username: 'chuck', address: 'NQ01' })
    mocks.fetchDisplayIdentity.mockResolvedValue({ address: 'NQ01', displayName: 'Chuck B' })

    const auth = useAuthStore()
    auth.setAddress('NQ01')
    await auth.loadProfile()

    expect(auth.username).toBe('chuck')
    expect(auth.displayName).toBe('Chuck B')
  })

  it('falls back to null display name when the enrichment lookup fails', async () => {
    mocks.getUser.mockResolvedValue({ username: 'chuck', address: 'NQ01' })
    mocks.fetchDisplayIdentity.mockRejectedValue(new Error('network'))

    const auth = useAuthStore()
    auth.setAddress('NQ01')
    await auth.loadProfile()

    expect(auth.username).toBe('chuck')
    expect(auth.displayName).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stores/auth.test.js`
Expected: FAIL — `auth.displayName` is `undefined` (current store reads `user.display_name`, which Task 6 guarantees is now always null/undefined).

- [ ] **Step 3: Implement**

In `src/stores/auth.js`, add the import:

```js
import { getUser } from '../db/queries.js'
import { canonicalNqAddress } from '../protocol/address.js'
import { fetchDisplayIdentity } from '../services/ecosystemProfile.js'
```

Change `loadProfile` from:

```js
  async function loadProfile() {
    if (!address.value) return
    const user = await getUser(canonicalNqAddress(address.value))
    if (user) {
      displayName.value = user.display_name
      username.value = user.username
      hasClaimed.value = !!user.username
    } else {
      displayName.value = null
      username.value = null
      hasClaimed.value = false
    }
  }
```

to:

```js
  async function loadProfile() {
    if (!address.value) return
    const user = await getUser(canonicalNqAddress(address.value))
    username.value = user?.username ?? null
    hasClaimed.value = !!user?.username
    try {
      const identity = await fetchDisplayIdentity(address.value)
      displayName.value = identity?.displayName ?? null
    } catch {
      displayName.value = null
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/stores/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/auth.js tests/stores/auth.test.js
git commit -m "feat: auth store sources display name from NimConnect enrichment"
```

---

### Task 9: `ProfileCard.vue` — drop on-chain display name field, add bio/links enrichment

**Files:**
- Modify: `src/components/profile/ProfileCard.vue`

**Interfaces:**
- Consumes: `fetchDisplayIdentity(address)` from Task 7.
- Produces: `emit('save-profile', { username, onSuccess, onError })` — no `displayName` field. Renders `identity.value?.displayName ?? user?.username` as the heading, and `identity.value?.bio`/`identity.value?.links` where the old (always-null) `user?.bio` binding used to be.

- [ ] **Step 1: Implement**

Change the `<script setup>` block of `src/components/profile/ProfileCard.vue`:

Add imports and a fetched `identity` ref:

```js
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useFollow } from '../../composables/useFollow.js'
import { useAuthStore } from '../../stores/auth.js'
import { useUiStore } from '../../stores/ui.js'
import { EXPLORER_BASE_URL } from '../../protocol/constants.js'
import { getWalletRuntime } from '../../chain/walletRuntime.js'
import { normalizeUsername } from '../../protocol/utils.js'
import { fetchDisplayIdentity } from '../../services/ecosystemProfile.js'
import AddressIdenticon from '../common/AddressIdenticon.vue'
import LinkifiedText from '../common/LinkifiedText.vue'

const props = defineProps({
  user: Object,
  address: String,
  savingProfile: { type: Boolean, default: false },
})
const emit = defineEmits(['save-profile'])

const auth = useAuthStore()
const ui = useUiStore()
const walletRuntime = getWalletRuntime()
const { active, counts, pending, follow, unfollow } = useFollow(computed(() => props.address))

const router = useRouter()
const isSelf = computed(() => auth.address === props.address)

const identity = ref(null)
watch(
  () => props.address,
  async (addr) => {
    identity.value = null
    if (!addr) return
    try {
      identity.value = await fetchDisplayIdentity(addr)
    } catch {
      identity.value = null
    }
  },
  { immediate: true },
)
const nimconnectEditUrl = computed(() =>
  props.address ? `https://nimconnect.nimiqminiapps.com/?address=${encodeURIComponent(props.address)}` : 'https://nimconnect.nimiqminiapps.com',
)
```

Change `startEdit`/`saveEdit` from:

```js
const editing = ref(false)
const editUsername = ref('')
const editDisplayName = ref('')
const editError = ref(null)

function startEdit() {
  editUsername.value = props.user?.username ?? ''
  editDisplayName.value = props.user?.display_name ?? ''
  editError.value = null
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  editError.value = null
}

function saveEdit() {
  editError.value = null
  const uname = normalizeUsername(editUsername.value.trim())
  if (!uname) {
    editError.value = 'Choose a valid username (3–31 lowercase letters, digits, underscore).'
    return
  }
  emit('save-profile', {
    username: uname,
    displayName: editDisplayName.value.trim(),
    onSuccess: () => { editing.value = false },
    onError: (msg) => { editError.value = msg },
  })
}
```

to:

```js
const editing = ref(false)
const editUsername = ref('')
const editError = ref(null)

function startEdit() {
  editUsername.value = props.user?.username ?? ''
  editError.value = null
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  editError.value = null
}

function saveEdit() {
  editError.value = null
  const uname = normalizeUsername(editUsername.value.trim())
  if (!uname) {
    editError.value = 'Choose a valid username (3–31 lowercase letters, digits, underscore).'
    return
  }
  emit('save-profile', {
    username: uname,
    onSuccess: () => { editing.value = false },
    onError: (msg) => { editError.value = msg },
  })
}
```

In the `<template>`, remove the "Display name" input block (the whole `<div>` containing `#profile-display-name`) from the `v-if="editing"` section, and add a note pointing to NimConnect for display name/bio instead, right after the username input's closing `</div>`:

```html
        <p class="text-xs text-[var(--nf-muted)]">
          Display name, bio, and links live on
          <a :href="nimconnectEditUrl" target="_blank" rel="noopener noreferrer" class="nf-focus font-semibold text-[var(--nf-primary)] hover:underline">NimConnect</a>.
        </p>
```

Change the display block (`v-else class="mt-3"`) from:

```html
      <div v-else class="mt-3">
        <h2 class="nq-h3">{{ user?.display_name ?? 'Anonymous' }}</h2>
        <p v-if="user?.username" class="nq-text-s text-[var(--nf-muted)]">@{{ user.username }}</p>
```

to:

```html
      <div v-else class="mt-3">
        <h2 class="nq-h3">{{ identity?.displayName ?? (user?.username ? '@' + user.username : 'Anonymous') }}</h2>
        <p v-if="user?.username && identity?.displayName" class="nq-text-s text-[var(--nf-muted)]">@{{ user.username }}</p>
```

And change the bio block from:

```html
        <p v-if="user?.bio" class="nq-text mt-3 whitespace-pre-wrap break-words">
          <LinkifiedText :text="user.bio" />
        </p>
```

to:

```html
        <p v-if="identity?.bio" class="nq-text mt-3 whitespace-pre-wrap break-words">
          <LinkifiedText :text="identity.bio" />
        </p>
        <div v-if="identity?.links?.website || identity?.links?.github || identity?.links?.x" class="mt-2 flex gap-3 text-xs">
          <a v-if="identity.links.website" :href="identity.links.website" target="_blank" rel="noopener noreferrer" class="nf-focus text-[var(--nf-primary)] hover:underline">Website</a>
          <a v-if="identity.links.github" :href="`https://github.com/${identity.links.github}`" target="_blank" rel="noopener noreferrer" class="nf-focus text-[var(--nf-primary)] hover:underline">GitHub</a>
          <a v-if="identity.links.x" :href="`https://x.com/${identity.links.x}`" target="_blank" rel="noopener noreferrer" class="nf-focus text-[var(--nf-primary)] hover:underline">X</a>
        </div>
```

- [ ] **Step 2: Manual verification**

No existing automated test covers `ProfileCard.vue` directly (confirmed — only `tests/components/userSearch.test.js`, `dialogSurfaces.test.js`, etc. exist, none for `ProfileCard`). Run the app (`npm run dev`) and visually confirm:
- Viewing a profile with no NimConnect profile shows `@username` as the heading and no bio/links, no console errors.
- Viewing a profile with a NimConnect profile (use an address known to have one on `api-nimconnect.nimiqminiapps.com`, or temporarily stub `fetchDisplayIdentity`) shows the display name, bio, and link icons.
- Editing your own profile shows only the username field plus the "lives on NimConnect" note, and saving still works.

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/ProfileCard.vue
git commit -m "feat: ProfileCard shows NimConnect bio/links, drops on-chain display name edit"
```

---

### Task 10: Claim flow UI — `OnboardingFlow.vue` and `ProfileView.vue` drop `displayName`

**Files:**
- Modify: `src/components/auth/OnboardingFlow.vue`
- Modify: `src/components/profile/ProfileView.vue`

**Interfaces:**
- Consumes: `claimProfile(username)` from Task 5 (one argument).

- [ ] **Step 1: Implement — OnboardingFlow.vue**

Change the `<script setup>` block from:

```js
import { ref } from 'vue'
import { usePost } from '../../composables/usePost.js'
import { normalizeUsername } from '../../protocol/utils.js'
import NqDialog from '../common/NqDialog.vue'

const emit = defineEmits(['done', 'cancel'])
const { claimProfile } = usePost()
const username = ref('')
const displayName = ref('')
const step = ref(1)
const error = ref(null)

async function register() {
  error.value = null
  const uname = normalizeUsername(username.value.trim())
  if (!uname) {
    error.value = 'Choose a valid username (3–31 lowercase letters, digits, underscore).'
    return
  }
  step.value = 3
  try {
    await claimProfile(uname, displayName.value.trim() || '')
    emit('done')
  } catch (err) {
    error.value = err.message
    step.value = 2
  }
}
```

to:

```js
import { ref } from 'vue'
import { usePost } from '../../composables/usePost.js'
import { normalizeUsername } from '../../protocol/utils.js'
import NqDialog from '../common/NqDialog.vue'

const emit = defineEmits(['done', 'cancel'])
const { claimProfile } = usePost()
const username = ref('')
const step = ref(1)
const error = ref(null)

async function register() {
  error.value = null
  const uname = normalizeUsername(username.value.trim())
  if (!uname) {
    error.value = 'Choose a valid username (3–31 lowercase letters, digits, underscore).'
    return
  }
  step.value = 3
  try {
    await claimProfile(uname)
    emit('done')
  } catch (err) {
    error.value = err.message
    step.value = 2
  }
}
```

In the `<template>`, remove the "Display name" label + input block (`#onboarding-display-name`), change the dialog `description` from `"One transaction publishes your username and display name on the post catalog."` to `"One transaction claims your @username on the shared registry — add a display name and bio on NimConnect afterward."`.

- [ ] **Step 2: Implement — ProfileView.vue**

Change `handleSaveProfile` from:

```js
async function handleSaveProfile({ username, displayName, onSuccess, onError }) {
  savingProfile.value = true
  try {
    await claimProfile(username, displayName)
    onSuccess()
  } catch (err) {
    onError(err.message)
  } finally {
    savingProfile.value = false
  }
}
```

to:

```js
async function handleSaveProfile({ username, onSuccess, onError }) {
  savingProfile.value = true
  try {
    await claimProfile(username)
    onSuccess()
  } catch (err) {
    onError(err.message)
  } finally {
    savingProfile.value = false
  }
}
```

- [ ] **Step 3: Manual verification**

Run: `npx vitest run` (full suite) to confirm nothing else references the removed `displayName` param.
Expected: PASS.

Run the app and walk through onboarding (claim a test username) end to end; confirm the claim transaction still signs and the profile page updates.

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/OnboardingFlow.vue src/components/profile/ProfileView.vue
git commit -m "feat: onboarding/profile claim flow drops on-chain display name field"
```

---

### Task 11: `UserSearch.vue` stops reading the now-always-null local display name

**Files:**
- Modify: `src/components/search/UserSearch.vue`

**Interfaces:** none (internal cleanup only).

- [ ] **Step 1: Implement**

Search results and the active-people list source `displayName` from `getUser(...).display_name`, which Task 6 guarantees is now always `null`/`undefined` for any claim made after this change ships. Rather than silently rendering nothing forever (the current dead `v-if="result.displayName"` branch), simplify to stop reading it at all — batch enrichment for a list this size is a real gap (flagged separately, not in scope here — YAGNI until this list needs it).

Change the search watcher from:

```js
      const claims = await searchUsernames(val)
      results.value = await Promise.all(
        claims.map(async (claim) => {
          const user = await getUser(claim.address)
          return { ...claim, displayName: user?.display_name ?? null }
        }),
      )
```

to:

```js
      results.value = await searchUsernames(val)
```

Change `loadActivePeople` from:

```js
async function loadActivePeople() {
  try {
    const users = await getMostActiveUsers(10)
    activePeople.value = users.map((user) => ({
      ...user,
      displayName: user.display_name ?? null,
    }))
  } finally {
    activeLoading.value = false
  }
}
```

to:

```js
async function loadActivePeople() {
  try {
    activePeople.value = await getMostActiveUsers(10)
  } finally {
    activeLoading.value = false
  }
}
```

Remove the now-unused `getUser` import (`import { getMostActiveUsers, searchUsernames, getUser } from '../../db/queries.js'` → drop `getUser`).

In the `<template>`, remove the dead `<div v-if="result.displayName" ...>{{ result.displayName }}</div>` line.

- [ ] **Step 2: Run the existing test**

Run: `npx vitest run tests/components/userSearch.test.js`
Expected: PASS — this test only asserts on `getMostActiveUsers`, `'Active people'`, `result.postCount`, and the indexer event listeners (source-string checks), none of which this change touches.

- [ ] **Step 3: Commit**

```bash
git add src/components/search/UserSearch.vue
git commit -m "cleanup: stop reading always-null local display_name in UserSearch"
```

---

## Self-Review Notes

- **Spec coverage:** package raw-binary builder (Task 1-2), NimFeed dependency (Task 3), decoder/encoder unification incl. NFH:/double-hex/HTLC tolerance via package delegation (Task 4), claim-sending call site (Task 5), indexer no longer persisting on-chain display name (Task 6), enrichment service + auth store + ProfileCard + onboarding/edit UI + search cleanup (Tasks 7-11) — all covered. Backend explicitly out of scope (already correct, stated in Architecture).
- **HTLC attribution**: covered transitively — `parseClaimTxData` (used in Task 4) internally calls the same `claimantAddress`/HTLC-owner-resolution logic as the backend; NimFeed's decoder gets this for free without a dedicated task, since it never had its own HTLC handling to remove.
- **Type consistency**: `HandleClaimPayload.extraDataBytes` (Task 1) is the one new symbol introduced; every downstream task (5, 6, decoder test in 4) references it by that exact name.
