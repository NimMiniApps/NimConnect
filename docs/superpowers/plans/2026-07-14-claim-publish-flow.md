# Claim + Publish Flow Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-app flow to claim an on-chain @handle and publish a public profile with per-field opt-in (spec §3 of `docs/superpowers/specs/2026-07-14-public-profiles-and-pay-links-design.md`). Requires the registry backend (plan `2026-07-14-handle-registry-backend.md`, already executed).

**Architecture:** Claiming = `sendNim(REGISTRY_ADDRESS, dust, 'NCC:v1:claim:<handle>')` via the existing Pay SDK wrapper, then POSTing the tx hash to the backend fast path. Publishing = client-serialized profile JSON signed with `signChallenge()` (the same scheme the inbox uses in production against `verifySignedMessage`), PUT to `/api/profile/{address}`. One new backend endpoint (reverse lookup address→handle) so any device can discover its own handle. UI: two sheets following the `TipSheet.vue` pattern, mounted from `MyProfilePage`.

**Tech Stack:** Vue 3 `<script setup>` + TS, `@noble/hashes` (already a dependency, used by `inbox.ts`), vitest; one small Go handler.

## Global Constraints

- Vitest env is `node`; test only pure logic in services, components are build-verified (repo convention — no component-test infra).
- Canonical signed messages MUST byte-match `backend/profiles.go`: `profilePutMessage` / `profileDeleteMessage`. Read that file first and copy the exact formats.
- Signature scheme: `signChallenge(message)` from `src/services/nimiq.ts` → `{ publicKey, signature }` hex strings — exactly what `verifySignedMessage` expects (proven by the inbox).
- `sendNim(recipient, amountNim, message)` (nimiq.ts) sends a basic tx with the message as hex-encoded UTF-8 tx data — exactly what `parseClaimData` in the backend decodes. Message ≤ `MESSAGE_MAX_BYTES` (64).
- Frontend API calls go through `apiUrl(path)` / `hasApiBase()` from `src/services/api.ts`.
- Handle rules must mirror the backend: `^[a-z0-9_]{3,26}$`.
- The feature is config-gated: `VITE_REGISTRY_ADDRESS` env (must equal the backend's `REGISTRY_ADDRESS`); UI hides entirely when unset.
- Run npm commands at repo root; Go commands in `backend/`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Backend reverse lookup — address → handle

**Files:**
- Modify: `backend/handles_registry.go` (add method at end)
- Modify: `backend/handles_handlers.go` (add handler at end)
- Modify: `backend/main.go` (one route inside the `registryAddress != ""` block)
- Test: `backend/handles_registry_test.go`, `backend/handles_handlers_test.go` (append)

**Interfaces:**
- Consumes: existing `HandleRegistry`, `HandleClaim`, `writeCached`.
- Produces: `(*HandleRegistry).ResolveAddress(address string) (HandleClaim, bool)`; HTTP `GET /api/handles/by-address/{address}` → 200 `HandleClaim` JSON (ETag/Cache-Control like resolve) | 404 | 400. Task 2's `handleForAddress()` calls it.

- [ ] **Step 1: Write the failing tests**

Append to `backend/handles_registry_test.go`:

```go
func TestResolveAddress(t *testing.T) {
	r := newTestRegistry(t)
	r.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "claim", "chuck", 5, 0)})
	claim, ok := r.ResolveAddress("NQ11OWNER") // spacing-insensitive
	if !ok || claim.Handle != "chuck" {
		t.Fatalf("want chuck, got %+v ok=%v", claim, ok)
	}
	if _, ok := r.ResolveAddress("NQ99 NOBODY"); ok {
		t.Fatal("unknown address must not resolve")
	}
}
```

Append to `backend/handles_handlers_test.go` (register the route in `handlesTestMux` alongside the others: `mux.HandleFunc("GET /api/handles/by-address/{address}", handleByAddressHandler(registry))`):

```go
func TestHandleByAddress(t *testing.T) {
	mux := handlesTestMux(t, seededRegistry(t), NewProfileStore(t.TempDir()), nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/handles/by-address/NQ11OWNER", nil))
	if rec.Code != 200 {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var claim HandleClaim
	json.Unmarshal(rec.Body.Bytes(), &claim)
	if claim.Handle != "chuck" {
		t.Fatalf("unexpected claim: %+v", claim)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/handles/by-address/NQ11000000000000000000000000000000AB", nil))
	if rec.Code != 404 && rec.Code != 400 {
		t.Fatalf("unknown address: want 404 (or 400 for invalid), got %d", rec.Code)
	}
}
```

(Note: `seededRegistry` uses sender `NQ11 OWNER`, which is not IBAN-valid; the handler must therefore validate the PATH address only loosely — see implementation — or the test seeds must use a checksummed address. Use `compactAddress` matching without `isValidNimiqAddress` on this endpoint: the address is a lookup key, not asserted identity.)

- [ ] **Step 2: Run to verify failure**

Run: `go test ./... -run 'TestResolveAddress|TestHandleByAddress' -v`
Expected: compile FAILURE — `ResolveAddress` / `handleByAddressHandler` undefined.

- [ ] **Step 3: Implement**

Append to `backend/handles_registry.go`:

```go
// ResolveAddress finds the handle owned by an address.
// ponytail: O(n) scan; index it if the registry ever holds >~50k handles.
func (r *HandleRegistry) ResolveAddress(address string) (HandleClaim, bool) {
	compact := compactAddress(address)
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, claim := range r.handles {
		if compactAddress(claim.Address) == compact {
			return claim, true
		}
	}
	return HandleClaim{}, false
}
```

Append to `backend/handles_handlers.go`:

```go
func handleByAddressHandler(registry *HandleRegistry) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claim, ok := registry.ResolveAddress(r.PathValue("address"))
		if !ok {
			writeJSONError(w, http.StatusNotFound, "no handle")
			return
		}
		writeCached(w, r, claim.TxHash, claim)
	}
}
```

In `backend/main.go`, inside the `registryAddress != ""` block, add:

```go
		mux.HandleFunc("GET /api/handles/by-address/{address}", handleByAddressHandler(registry))
```

- [ ] **Step 4: Verify**

Run: `go vet ./... && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add handles_registry.go handles_handlers.go main.go handles_registry_test.go handles_handlers_test.go
git commit -m "feat(backend): reverse handle lookup by address

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Frontend handles service

**Files:**
- Create: `src/services/handles.ts`
- Test: `src/services/handles.test.ts`

**Interfaces:**
- Consumes: `sendNim`, `signChallenge` (nimiq.ts), `apiUrl`, `hasApiBase` (api.ts), `sha256`/`bytesToHex` (@noble, same imports as inbox.ts), `type Profile` (types/profile.ts).
- Produces (Tasks 3–5 and plan 4 consume):
  - `REGISTRY_ADDRESS: string`, `CLAIM_AMOUNT_NIM = 0.00001`, `handlesEnabled(): boolean`
  - `isValidHandle(h: string): boolean`, `makeClaimPayload(verb: 'claim' | 'release', handle: string): string`
  - `interface HandleClaim { handle: string; address: string; tx_hash: string; block_height: number; tx_index: number }`
  - `interface PublicProfile { display_name?: string; bio?: string; website?: string; github?: string; x?: string; tags?: string[] }`
  - `interface ShareSelection { name: boolean; bio: boolean; website: boolean; github: boolean; x: boolean; tags: boolean }`
  - `profileToPublicPayload(profile: Profile, share: ShareSelection): string` (serialized JSON, only opted-in fields)
  - `buildProfilePutMessage(address: string, updatedAt: number, payloadHash: string): string`, `buildProfileDeleteMessage(address: string, updatedAt: number): string`, `profilePayloadHash(payload: string): string`
  - async API: `checkHandle(h): Promise<{available: boolean; reason?: string}>`, `resolveHandle(h): Promise<HandleClaim | null>`, `handleForAddress(address): Promise<HandleClaim | null>`, `fetchPublicProfile(address): Promise<{updatedAt: number; profile: PublicProfile} | null>`, `claimHandle(handle): Promise<'indexed' | 'pending'>`, `publishProfile(profile: Profile, share: ShareSelection): Promise<void>`, `unpublishProfile(address: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/services/handles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isValidHandle,
  makeClaimPayload,
  buildProfilePutMessage,
  buildProfileDeleteMessage,
  profilePayloadHash,
  profileToPublicPayload,
} from './handles'
import type { Profile } from '../types/profile'

const profile: Profile = {
  id: '1', address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
  name: 'Chuck', type: 'person', isSelf: true, notes: 'PRIVATE',
  tags: ['friend', 'dev'], favorite: false, createdAt: 1, updatedAt: 1,
  bio: 'Nimiq builder', website: 'https://chuck.example', github: 'chuck', x: 'chuck_x',
}

describe('handles', () => {
  it('validates handles like the backend', () => {
    expect(isValidHandle('chuck')).toBe(true)
    expect(isValidHandle('a_1')).toBe(true)
    expect(isValidHandle('Chuck')).toBe(false)
    expect(isValidHandle('ab')).toBe(false)
    expect(isValidHandle('x'.repeat(27))).toBe(false)
  })

  it('builds claim payloads within Nimiq Pay text limit', () => {
    expect(makeClaimPayload('claim', 'chuck')).toBe('NCC:v1:claim:chuck')
    expect(makeClaimPayload('release', 'x'.repeat(26)).length).toBeLessThanOrEqual(64)
  })

  it('builds canonical messages byte-matching the backend', () => {
    expect(buildProfilePutMessage(profile.address, 1000, 'abc')).toBe(
      'nimconnect:profile:v1'
      + '\naddress=NQ070000000000000000000000000000000000'
      + '\nupdatedAt=1000'
      + '\npayloadHash=abc',
    )
    expect(buildProfileDeleteMessage(profile.address, 1000)).toBe(
      'nimconnect:profile-delete:v1'
      + '\naddress=NQ070000000000000000000000000000000000'
      + '\nupdatedAt=1000',
    )
  })

  it('hashes payloads as sha256 hex (matches Go sha256Hex)', () => {
    // echo -n 'hello' | sha256sum
    expect(profilePayloadHash('hello'))
      .toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('only includes opted-in fields — never notes', () => {
    const all = JSON.parse(profileToPublicPayload(profile, {
      name: true, bio: true, website: true, github: true, x: true, tags: true,
    }))
    expect(all).toEqual({
      display_name: 'Chuck', bio: 'Nimiq builder', website: 'https://chuck.example',
      github: 'chuck', x: 'chuck_x', tags: ['friend', 'dev'],
    })

    const minimal = JSON.parse(profileToPublicPayload(profile, {
      name: true, bio: false, website: false, github: false, x: false, tags: false,
    }))
    expect(minimal).toEqual({ display_name: 'Chuck' })
    expect(profileToPublicPayload(profile, {
      name: true, bio: true, website: true, github: true, x: true, tags: true,
    })).not.toContain('PRIVATE')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- --run src/services/handles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/services/handles.ts`:

```ts
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { apiUrl, hasApiBase } from './api'
import { sendNim, signChallenge } from './nimiq'
import type { Profile } from '../types/profile'

/** Must match the backend's REGISTRY_ADDRESS; empty disables the feature. */
export const REGISTRY_ADDRESS: string = import.meta.env.VITE_REGISTRY_ADDRESS ?? ''
/** Dust value carried by claim/release transactions. */
export const CLAIM_AMOUNT_NIM = 0.00001

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

export function handlesEnabled(): boolean {
  return hasApiBase() && !!REGISTRY_ADDRESS
}

// Rules mirror backend/handles.go.
export function isValidHandle(h: string): boolean {
  return /^[a-z0-9_]{3,26}$/.test(h)
}

export function makeClaimPayload(verb: 'claim' | 'release', handle: string): string {
  return `NCC:v1:${verb}:${handle}`
}

export interface HandleClaim {
  handle: string
  address: string
  tx_hash: string
  block_height: number
  tx_index: number
}

export interface PublicProfile {
  display_name?: string
  bio?: string
  website?: string
  github?: string
  x?: string
  tags?: string[]
}

export interface ShareSelection {
  name: boolean
  bio: boolean
  website: boolean
  github: boolean
  x: boolean
  tags: boolean
}

/** Serialize ONLY the opted-in fields. Private data (notes, …) never leaves the device. */
export function profileToPublicPayload(profile: Profile, share: ShareSelection): string {
  const payload: PublicProfile = {}
  if (share.name && profile.name) payload.display_name = profile.name
  if (share.bio && profile.bio) payload.bio = profile.bio
  if (share.website && profile.website) payload.website = profile.website
  if (share.github && profile.github) payload.github = profile.github
  if (share.x && profile.x) payload.x = profile.x
  if (share.tags && profile.tags.length) payload.tags = [...profile.tags]
  return JSON.stringify(payload)
}

// Canonical messages — byte-match backend/profiles.go.
export function buildProfilePutMessage(address: string, updatedAt: number, payloadHash: string): string {
  return 'nimconnect:profile:v1'
    + `\naddress=${compact(address)}`
    + `\nupdatedAt=${updatedAt}`
    + `\npayloadHash=${payloadHash}`
}

export function buildProfileDeleteMessage(address: string, updatedAt: number): string {
  return 'nimconnect:profile-delete:v1'
    + `\naddress=${compact(address)}`
    + `\nupdatedAt=${updatedAt}`
}

export function profilePayloadHash(payload: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(payload)))
}

export async function checkHandle(handle: string): Promise<{ available: boolean; reason?: string }> {
  const res = await fetch(apiUrl(`/api/handles/check?h=${encodeURIComponent(handle)}`))
  if (!res.ok) throw new Error('check failed')
  return res.json()
}

export async function resolveHandle(handle: string): Promise<HandleClaim | null> {
  const res = await fetch(apiUrl(`/api/resolve/${encodeURIComponent(handle)}`))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('resolve failed')
  return res.json()
}

export async function handleForAddress(address: string): Promise<HandleClaim | null> {
  const res = await fetch(apiUrl(`/api/handles/by-address/${compact(address)}`))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('lookup failed')
  return res.json()
}

export async function fetchPublicProfile(
  address: string,
): Promise<{ updatedAt: number; profile: PublicProfile } | null> {
  const res = await fetch(apiUrl(`/api/profile/${compact(address)}`))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('profile fetch failed')
  const body = await res.json()
  return { updatedAt: body.updated_at, profile: body.profile ?? {} }
}

/** Send the on-chain claim tx, then fast-path it to the indexer. */
export async function claimHandle(handle: string): Promise<'indexed' | 'pending'> {
  if (!isValidHandle(handle)) throw new Error('Invalid handle')
  if (!REGISTRY_ADDRESS) throw new Error('Handle registry not configured')
  const txHash = await sendNim(REGISTRY_ADDRESS, CLAIM_AMOUNT_NIM, makeClaimPayload('claim', handle))
  const res = await fetch(apiUrl('/api/handles/claims'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_hash: txHash }),
  })
  if (!res.ok) return 'pending' // tx is on chain; the periodic sweep will pick it up
  const body = await res.json()
  return body.status === 'indexed' ? 'indexed' : 'pending'
}

export async function publishProfile(profile: Profile, share: ShareSelection): Promise<void> {
  const payload = profileToPublicPayload(profile, share)
  const updatedAt = Date.now()
  const { publicKey, signature } = await signChallenge(
    buildProfilePutMessage(profile.address, updatedAt, profilePayloadHash(payload)),
  )
  const res = await fetch(apiUrl(`/api/profile/${compact(profile.address)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: profile.address,
      updated_at: updatedAt,
      profile: payload,
      public_key: publicKey,
      signature,
    }),
  })
  if (!res.ok) throw new Error(`Publish failed (${res.status})`)
}

export async function unpublishProfile(address: string): Promise<void> {
  const updatedAt = Date.now()
  const { publicKey, signature } = await signChallenge(buildProfileDeleteMessage(address, updatedAt))
  const res = await fetch(apiUrl(`/api/profile/${compact(address)}`), {
    method: 'DELETE',
    headers: {
      'X-Profile-Updated-At': String(updatedAt),
      'X-Profile-Public-Key': publicKey,
      'X-Profile-Signature': signature,
    },
  })
  if (!res.ok && res.status !== 404) throw new Error(`Unpublish failed (${res.status})`)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/handles.ts src/services/handles.test.ts
git commit -m "feat: handles service — claim tx, signed publish/unpublish, lookups

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ClaimHandleSheet component

**Files:**
- Create: `src/components/ClaimHandleSheet.vue`

**Interfaces:**
- Consumes: `ActionSheet.vue` (props `open: boolean`, `title: string`, emit `close`, default slot), `insideNimiqPay` (nimiq.ts), handles service (Task 2).
- Produces: component with props `{ open: boolean }`, emits `close: []` and `claimed: [handle: string]`. Task 5 mounts it.

- [ ] **Step 1: Create the component**

Create `src/components/ClaimHandleSheet.vue` (follows the `TipSheet.vue` pattern — inside-Pay gate, primary button, ok/err styles):

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import ActionSheet from './ActionSheet.vue'
import { insideNimiqPay } from '../services/nimiq'
import { isValidHandle, checkHandle, claimHandle } from '../services/handles'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; claimed: [handle: string] }>()

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'unknown'

const handle = ref('')
const availability = ref<Availability>('idle')
const claiming = ref(false)
const result = ref<'indexed' | 'pending' | null>(null)
const error = ref<string | null>(null)
let debounce: ReturnType<typeof setTimeout> | undefined

watch(handle, value => {
  clearTimeout(debounce)
  error.value = null
  const h = value.trim().toLowerCase()
  if (!h) {
    availability.value = 'idle'
    return
  }
  if (!isValidHandle(h)) {
    availability.value = 'invalid'
    return
  }
  availability.value = 'checking'
  debounce = setTimeout(async () => {
    try {
      const check = await checkHandle(h)
      availability.value = check.available
        ? 'available'
        : (check.reason as Availability) || 'taken'
    } catch {
      availability.value = 'unknown' // advisory only — claiming still allowed
    }
  }, 400)
})

const HINTS: Record<Availability, string> = {
  idle: '3–26 characters: a–z, 0–9, _',
  checking: 'Checking…',
  available: 'Looks available ✓ (the chain has the final say)',
  taken: 'Already claimed',
  reserved: 'Reserved name',
  invalid: '3–26 characters: a–z, 0–9, _',
  unknown: 'Could not check availability — you can still try to claim',
}

async function doClaim() {
  const h = handle.value.trim().toLowerCase()
  if (!isValidHandle(h) || claiming.value) return
  claiming.value = true
  error.value = null
  try {
    result.value = await claimHandle(h)
    emit('claimed', h)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    claiming.value = false
  }
}

function close() {
  handle.value = ''
  availability.value = 'idle'
  result.value = null
  error.value = null
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" title="Claim your @handle" @close="close">
    <template v-if="insideNimiqPay">
      <template v-if="result">
        <p class="ok">
          🎉 Claim for <strong>@{{ handle.trim().toLowerCase() }}</strong> is on the chain.
          <template v-if="result === 'pending'">
            It'll be confirmed within a couple of minutes — earliest claim wins.
          </template>
        </p>
        <button class="primary" @click="close">Done</button>
      </template>
      <template v-else>
        <p class="intro">
          Your @handle is claimed with a tiny on-chain transaction and belongs to
          your wallet address — permanently, first come first served.
        </p>
        <label class="handle-label">
          Handle
          <div class="handle-input">
            <span aria-hidden="true">@</span>
            <input
              v-model="handle"
              maxlength="26"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              placeholder="chuck"
            />
          </div>
        </label>
        <p class="hint" :class="{ good: availability === 'available', bad: availability === 'taken' || availability === 'reserved' }">
          {{ HINTS[availability] }}
        </p>
        <p v-if="error" class="err">{{ error }}</p>
        <button
          class="primary"
          :disabled="claiming || availability === 'taken' || availability === 'reserved' || !isValidHandle(handle.trim().toLowerCase())"
          @click="doClaim"
        >
          {{ claiming ? 'Waiting for confirmation…' : 'Claim with a dust transaction' }}
        </button>
      </template>
    </template>
    <p v-else class="hint">Open NimConnect inside Nimiq Pay to claim a handle.</p>
  </ActionSheet>
</template>

<style scoped>
.intro { margin: 0 0 12px; font-size: 14px; color: var(--text-2); line-height: 1.5; }
.handle-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); }
.handle-input {
  display: flex; align-items: center; gap: 4px; padding: 0 12px; min-height: 48px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); font-size: 17px; font-weight: 700; color: var(--text);
}
.handle-input input {
  flex: 1; min-width: 0; border: none; background: none; font: inherit; color: inherit; outline: none;
}
.hint { margin: 8px 0 0; font-size: 13px; color: var(--text-2); }
.hint.good { color: var(--nq-green); }
.hint.bad { color: var(--nq-red); }
.ok { color: var(--nq-green); font-weight: 700; line-height: 1.5; }
.err { color: var(--nq-red); font-size: 14px; }
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); margin-top: 12px;
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: success (component not mounted yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/ClaimHandleSheet.vue
git commit -m "feat: claim-handle sheet — availability check + on-chain dust claim

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: PublishProfileSheet component

**Files:**
- Create: `src/components/PublishProfileSheet.vue`

**Interfaces:**
- Consumes: `ActionSheet.vue`, `insideNimiqPay`, handles service (`publishProfile`, `unpublishProfile`, `type PublicProfile`, `type ShareSelection`), `type Profile`.
- Produces: props `{ open: boolean; profile: Profile; published: PublicProfile | null }`, emits `close: []`, `changed: []` (after successful publish/unpublish; parent refetches). Task 5 mounts it.

- [ ] **Step 1: Create the component**

Create `src/components/PublishProfileSheet.vue`:

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ActionSheet from './ActionSheet.vue'
import { insideNimiqPay } from '../services/nimiq'
import type { Profile } from '../types/profile'
import {
  publishProfile,
  unpublishProfile,
  type PublicProfile,
  type ShareSelection,
} from '../services/handles'

const props = defineProps<{ open: boolean; profile: Profile; published: PublicProfile | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const share = ref<ShareSelection>({
  name: true, bio: false, website: false, github: false, x: false, tags: false,
})
const busy = ref(false)
const error = ref<string | null>(null)
const done = ref<'published' | 'unpublished' | null>(null)

// Pre-check the fields that are already published when (re)opening.
watch(() => props.open, open => {
  if (!open) return
  done.value = null
  error.value = null
  const p = props.published
  share.value = {
    name: true,
    bio: !!p?.bio,
    website: !!p?.website,
    github: !!p?.github,
    x: !!p?.x,
    tags: !!p?.tags?.length,
  }
})

interface FieldRow {
  key: keyof ShareSelection
  label: string
  value: string
}

const fields = computed<FieldRow[]>(() => {
  const rows: FieldRow[] = [{ key: 'name', label: 'Name', value: props.profile.name }]
  if (props.profile.bio) rows.push({ key: 'bio', label: 'Bio', value: props.profile.bio })
  if (props.profile.website) rows.push({ key: 'website', label: 'Website', value: props.profile.website })
  if (props.profile.github) rows.push({ key: 'github', label: 'GitHub', value: props.profile.github })
  if (props.profile.x) rows.push({ key: 'x', label: 'X / Twitter', value: props.profile.x })
  if (props.profile.tags.length) rows.push({ key: 'tags', label: 'Tags', value: props.profile.tags.join(', ') })
  return rows
})

async function doPublish() {
  busy.value = true
  error.value = null
  try {
    await publishProfile(props.profile, share.value)
    done.value = 'published'
    emit('changed')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function doUnpublish() {
  busy.value = true
  error.value = null
  try {
    await unpublishProfile(props.profile.address)
    done.value = 'unpublished'
    emit('changed')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ActionSheet :open="open" title="Public profile" @close="emit('close')">
    <template v-if="insideNimiqPay">
      <template v-if="done">
        <p class="ok">
          {{ done === 'published' ? '✓ Public profile updated.' : '✓ Public profile removed.' }}
        </p>
        <button class="primary" @click="emit('close')">Done</button>
      </template>
      <template v-else>
        <p class="intro">
          Choose what appears on your public page. Only checked fields leave this
          device — everything else stays private. You can unpublish anytime.
        </p>
        <label v-for="field in fields" :key="field.key" class="field">
          <input v-model="share[field.key]" type="checkbox" :disabled="field.key === 'name'" />
          <span class="field-text">
            <strong>{{ field.label }}</strong>
            <small>{{ field.value }}</small>
          </span>
        </label>
        <p v-if="error" class="err">{{ error }}</p>
        <button class="primary" :disabled="busy" @click="doPublish">
          {{ busy ? 'Waiting for signature…' : published ? 'Update public profile' : 'Publish' }}
        </button>
        <button v-if="published" class="danger-link" :disabled="busy" @click="doUnpublish">
          Unpublish — remove my public profile
        </button>
      </template>
    </template>
    <p v-else class="hint">Open NimConnect inside Nimiq Pay to manage your public profile.</p>
  </ActionSheet>
</template>

<style scoped>
.intro { margin: 0 0 12px; font-size: 14px; color: var(--text-2); line-height: 1.5; }
.field {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 0;
  border-bottom: 1px solid var(--border); cursor: pointer;
}
.field input { width: 20px; height: 20px; margin-top: 2px; accent-color: var(--nq-gold); }
.field-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.field-text strong { font-size: 14px; color: var(--text); }
.field-text small {
  font-size: 13px; color: var(--text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ok { color: var(--nq-green); font-weight: 700; }
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); margin-top: 16px;
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
.danger-link {
  width: 100%; padding: 12px; margin-top: 4px; border: none; background: none; cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--nq-red);
  text-decoration: underline; text-underline-offset: 3px;
}
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/PublishProfileSheet.vue
git commit -m "feat: publish-profile sheet — per-field opt-in, signed publish/unpublish

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: MyProfilePage integration

**Files:**
- Modify: `src/pages/MyProfilePage.vue`

**Interfaces:**
- Consumes: Tasks 2–4 (`handlesEnabled`, `handleForAddress`, `fetchPublicProfile`, `HandleClaim`, `PublicProfile`, both sheets).
- Produces: final UI. A "@handle & public profile" card under the own-profile view: shows the claimed handle, opens the claim sheet when unclaimed, the publish sheet when claimed.

- [ ] **Step 1: Add the handle card and sheets**

In `src/pages/MyProfilePage.vue`:

1. Extend the script imports:

```ts
import ClaimHandleSheet from '../components/ClaimHandleSheet.vue'
import PublishProfileSheet from '../components/PublishProfileSheet.vue'
import {
  handlesEnabled,
  handleForAddress,
  fetchPublicProfile,
  type HandleClaim,
  type PublicProfile,
} from '../services/handles'
```

2. Add state + loader in the script (after the existing `retry` function):

```ts
const claimOpen = ref(false)
const publishOpen = ref(false)
const myHandle = ref<HandleClaim | null>(null)
const published = ref<PublicProfile | null>(null)

async function loadHandleState() {
  if (!handlesEnabled() || !store.self) return
  try {
    myHandle.value = await handleForAddress(store.self.address)
    published.value = myHandle.value
      ? (await fetchPublicProfile(store.self.address))?.profile ?? null
      : null
  } catch {
    // Registry unreachable — card just shows the claim/manage entry, actions will surface errors.
  }
}

function onClaimed() {
  void loadHandleState()
}
```

3. Call it once the profile is ready — extend the existing `onMounted`:

```ts
onMounted(async () => {
  try {
    await bootstrapWallet()
  } finally {
    ready.value = true
  }
  void loadHandleState()
})
```

4. In the template, insert directly AFTER the `<ProfileView … />` element (inside the same `v-else-if="store.self"` branch — wrap both in a `<template v-else-if="store.self">` if needed):

```vue
      <section v-if="handlesEnabled()" class="handle-card">
        <template v-if="myHandle">
          <p class="handle-name">@{{ myHandle.handle }}</p>
          <p class="handle-hint">
            {{ published ? 'Public profile is live.' : 'Handle claimed — publish a public profile.' }}
          </p>
          <button type="button" class="handle-action" @click="publishOpen = true">
            {{ published ? 'Manage public profile' : 'Publish public profile' }}
          </button>
        </template>
        <template v-else>
          <p class="handle-hint">
            Claim <strong>@yourname</strong> on the Nimiq chain so anyone can find and pay you by name.
          </p>
          <button type="button" class="handle-action" @click="claimOpen = true">
            Claim your @handle
          </button>
        </template>
      </section>
```

5. Mount the sheets at the end of the template's root `div`:

```vue
    <ClaimHandleSheet :open="claimOpen" @close="claimOpen = false" @claimed="onClaimed" />
    <PublishProfileSheet
      v-if="store.self"
      :open="publishOpen"
      :profile="store.self"
      :published="published"
      @close="publishOpen = false"
      @changed="loadHandleState"
    />
```

6. Add styles:

```css
.handle-card {
  margin-top: 16px; padding: 16px; border-radius: 16px;
  background: var(--card); border: 1px solid var(--border);
}
.handle-name { margin: 0 0 4px; font-size: 20px; font-weight: 800; color: var(--nq-gold-dark); }
.handle-hint { margin: 0 0 12px; font-size: 14px; color: var(--text-2); line-height: 1.5; }
.handle-action {
  width: 100%; height: 44px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 15px; color: var(--nimiq-white); background: var(--nimiq-gold-bg);
}
```

- [ ] **Step 2: Build + tests**

Run: `npm run build && npm run test -- --run`
Expected: PASS. Without `VITE_REGISTRY_ADDRESS` set, the card must not render (`handlesEnabled()` false) — the page looks unchanged.

- [ ] **Step 3: Manual verification**

1. Start the backend with a registry address: `cd backend && REGISTRY_ADDRESS='NQ07 0000 0000 0000 0000 0000 0000 0000 0000' HANDLES_FILE=/tmp/h.json PROFILES_DIR=/tmp/p go run .`
2. Frontend: `VITE_REGISTRY_ADDRESS='NQ07 0000 0000 0000 0000 0000 0000 0000 0000' npm run dev`, enable browser mode, set up a profile.
3. Profile tab → the handle card shows "Claim your @handle". Open it: type `ab` → invalid hint; type `nimiq` → reserved; type `somethingfree` → "Looks available ✓".
4. Claiming and publishing need Nimiq Pay (wallet signatures) — outside it the sheets show the open-in-Pay hint. Full E2E happens on a phone against the deployed stack.

- [ ] **Step 4: Commit**

```bash
git add src/pages/MyProfilePage.vue
git commit -m "feat: @handle card on My Profile — claim and publish entry points

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
