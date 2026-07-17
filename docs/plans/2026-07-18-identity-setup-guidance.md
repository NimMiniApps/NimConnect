# Identity Setup Guidance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a light-touch Home identity-setup card (handle → share → first contact) plus a people-first Split empty state, without changing nav or redesigning the UI.

**Architecture:** Pure `identity-setup` service derives checklist/next-step from real profile data and persists only `publicProfileShared`, 24h snooze, and a tiny celebration phase (`claimed` → `shared`). Home renders `IdentitySetupCard`; claim success enters celebration; Split sheet shows an empty state when there are zero contacts.

**Tech Stack:** Vue 3, Pinia/Dexie profiles store, Vitest, existing `handles` / `links` / `share` / `delight` services.

**Design:** @docs/plans/2026-07-18-identity-setup-guidance-design.md

---

### Task 1: Identity-setup pure logic + tests

**Files:**
- Create: `src/services/identity-setup.ts`
- Create: `src/services/identity-setup.test.ts`

**Step 1: Write the failing tests**

```ts
// src/services/identity-setup.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearIdentitySetupState,
  identitySetupVisible,
  markPublicProfileShared,
  markHandleClaimedCelebration,
  markCelebrationShared,
  snoozeIdentitySetup,
  isSnoozed,
  cancelSnooze,
  resolveIdentitySetup,
  type IdentitySetupInput,
} from './identity-setup'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

const base = (over: Partial<IdentitySetupInput> = {}): IdentitySetupInput => ({
  handlesEnabled: true,
  handle: null,
  contactCount: 0,
  now: 1_000_000,
  ...over,
})

describe('identity-setup', () => {
  beforeEach(() => {
    stubLocalStorage()
    clearIdentitySetupState()
  })

  it('prioritizes claim handle when missing', () => {
    const r = resolveIdentitySetup(base())
    expect(r.complete).toBe(false)
    expect(r.nextStep).toBe('claim-handle')
    expect(r.steps.map(s => s.id)).toEqual(['claim-handle', 'first-contact', 'share-profile'])
    expect(r.steps[0]!.done).toBe(false)
  })

  it('starts at first contact when handles disabled', () => {
    const r = resolveIdentitySetup(base({ handlesEnabled: false }))
    expect(r.steps.map(s => s.id)).toEqual(['first-contact', 'share-profile'])
    expect(r.nextStep).toBe('first-contact')
  })

  it('after handle, next is first contact then share', () => {
    expect(resolveIdentitySetup(base({ handle: 'chuck' })).nextStep).toBe('first-contact')
    expect(resolveIdentitySetup(base({ handle: 'chuck', contactCount: 1 })).nextStep).toBe('share-profile')
  })

  it('never shows when already complete', () => {
    markPublicProfileShared()
    const r = resolveIdentitySetup(base({ handle: 'chuck', contactCount: 2 }))
    expect(r.complete).toBe(true)
    expect(identitySetupVisible(r)).toBe(false)
  })

  it('snoozes for 24h and cancels when progress happens', () => {
    const t0 = 1_000_000
    snoozeIdentitySetup(t0)
    expect(isSnoozed(t0 + 1000)).toBe(true)
    expect(isSnoozed(t0 + 24 * 60 * 60 * 1000 + 1)).toBe(false)
    snoozeIdentitySetup(t0)
    cancelSnooze()
    expect(isSnoozed(t0 + 1000)).toBe(false)
  })

  it('celebration phase claimed → shared', () => {
    markHandleClaimedCelebration('chuck')
    let r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBe('claimed')
    markCelebrationShared()
    markPublicProfileShared()
    r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBeNull()
    expect(r.nextStep).toBe('first-contact')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/services/identity-setup.test.ts`

Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

```ts
// src/services/identity-setup.ts
const PREFIX = 'nimconnect:identity-setup:'
const KEY_SHARED = `${PREFIX}public-shared`
const KEY_SNOOZE_UNTIL = `${PREFIX}snooze-until`
const KEY_CELEBRATION = `${PREFIX}celebration` // 'claimed' | 'shared' | absent
const KEY_CELEBRATION_HANDLE = `${PREFIX}celebration-handle`
export const SNOOZE_MS = 24 * 60 * 60 * 1000

export type IdentitySetupStepId = 'claim-handle' | 'first-contact' | 'share-profile'
export type CelebrationPhase = 'claimed' | 'shared'

export interface IdentitySetupInput {
  handlesEnabled: boolean
  handle: string | null
  contactCount: number
  now?: number
}

export interface IdentitySetupStep {
  id: IdentitySetupStepId
  label: string
  done: boolean
}

export interface IdentitySetupResult {
  steps: IdentitySetupStep[]
  nextStep: IdentitySetupStepId | null
  complete: boolean
  celebration: CelebrationPhase | null
  celebrationHandle: string | null
}

function lsGet(k: string): string | null {
  try { return globalThis.localStorage?.getItem(k) ?? null } catch { return null }
}
function lsSet(k: string, v: string): void {
  try { globalThis.localStorage?.setItem(k, v) } catch { /* best-effort */ }
}
function lsRemove(k: string): void {
  try { globalThis.localStorage?.removeItem(k) } catch { /* best-effort */ }
}

export function clearIdentitySetupState(): void {
  lsRemove(KEY_SHARED)
  lsRemove(KEY_SNOOZE_UNTIL)
  lsRemove(KEY_CELEBRATION)
  lsRemove(KEY_CELEBRATION_HANDLE)
}

export function markPublicProfileShared(): void {
  lsSet(KEY_SHARED, '1')
  cancelSnooze()
  if (lsGet(KEY_CELEBRATION) === 'claimed') lsSet(KEY_CELEBRATION, 'shared')
}

export function publicProfileShared(): boolean {
  return lsGet(KEY_SHARED) === '1'
}

export function markHandleClaimedCelebration(handle: string): void {
  lsSet(KEY_CELEBRATION, 'claimed')
  lsSet(KEY_CELEBRATION_HANDLE, handle.trim().toLowerCase())
  cancelSnooze()
}

export function markCelebrationShared(): void {
  if (lsGet(KEY_CELEBRATION) === 'claimed') lsSet(KEY_CELEBRATION, 'shared')
}

export function snoozeIdentitySetup(now = Date.now()): void {
  lsSet(KEY_SNOOZE_UNTIL, String(now + SNOOZE_MS))
}

export function cancelSnooze(): void {
  lsRemove(KEY_SNOOZE_UNTIL)
}

export function isSnoozed(now = Date.now()): boolean {
  const raw = lsGet(KEY_SNOOZE_UNTIL)
  if (!raw) return false
  const until = Number(raw)
  return Number.isFinite(until) && now < until
}

export function resolveIdentitySetup(input: IdentitySetupInput): IdentitySetupResult {
  const now = input.now ?? Date.now()
  const handle = input.handle?.trim().toLowerCase() || null
  const hasHandle = !!handle
  const hasContact = input.contactCount > 0
  const shared = publicProfileShared()

  const steps: IdentitySetupStep[] = []
  if (input.handlesEnabled) {
    steps.push({ id: 'claim-handle', label: 'Claim your @handle', done: hasHandle })
  }
  steps.push({ id: 'first-contact', label: 'Connect with your first contact', done: hasContact })
  steps.push({ id: 'share-profile', label: 'Share your public profile', done: shared })

  const nextStep = steps.find(s => !s.done)?.id ?? null
  const complete = nextStep == null

  let celebration: CelebrationPhase | null = null
  const phase = lsGet(KEY_CELEBRATION)
  if (phase === 'claimed' && hasHandle) celebration = 'claimed'
  else if (phase === 'shared') {
    // transient; clear once we've left celebration for normal next step
    lsRemove(KEY_CELEBRATION)
    celebration = null
  }

  // Completing derived steps cancels snooze
  if (hasHandle || hasContact || shared) {
    // only cancel when something progressed vs empty start — callers also cancel on explicit marks
  }

  return {
    steps,
    nextStep,
    complete,
    celebration,
    celebrationHandle: celebration === 'claimed' ? (lsGet(KEY_CELEBRATION_HANDLE) || handle) : null,
  }
}

export function identitySetupVisible(result: IdentitySetupResult, now = Date.now()): boolean {
  if (result.complete) return false
  if (result.celebration === 'claimed') return true
  if (isSnoozed(now)) return false
  return true
}
```

Also: when `resolveIdentitySetup` detects newly completed derived steps after snooze, call `cancelSnooze()` if `hasHandle || hasContact || shared` and a snooze was active — simplest rule from design: **completing any checklist item cancels snooze**. Implement by calling `cancelSnooze()` at the start of resolve when `hasHandle || hasContact || shared` and snoozed — actually that would prevent snooze entirely for users who already have a handle but not contacts. Design says: cancel when they *complete* an item (progress event), not whenever they already have progress.

Better approach:
- `cancelSnooze()` only from `markPublicProfileShared`, `markHandleClaimedCelebration`, and a new `noteIdentitySetupProgress()` called from Home when `contactCount` transitions 0→1 or handle appears.
- For tests: call `cancelSnooze()` explicitly in those mark functions; add `onIdentitySetupProgress()` that cancels snooze for use when Home detects contact/handle progress.

Update the snooze test accordingly — `cancelSnooze()` direct call is enough for unit test; Home will wire progress.

Refine `resolveIdentitySetup` celebration `shared` clearing: after share, celebration becomes null and nextStep is first-contact if needed. `markPublicProfileShared` already sets celebration to `shared`; next resolve can clear `shared` phase immediately so UI shows normal next step with “✓ Public profile shared” feedback driven by a short-lived UI flag in the component (or keep phase `shared` for one view). Keep it simple in service: after `markPublicProfileShared`, celebration reads as null and component shows toast line from a local `justShared` ref.

Simplify celebration API for implementer:
- `markHandleClaimedCelebration(handle)` → phase `claimed`
- `markPublicProfileShared()` → sets shared flag, clears celebration phase
- Component shows “✓ Public profile shared” via local state on share click

Adjust tests: remove `markCelebrationShared` if unused; celebration only `claimed` or null.

**Step 4: Run tests — expect PASS**

Run: `npm test -- src/services/identity-setup.test.ts`

**Step 5: Commit**

```bash
git add src/services/identity-setup.ts src/services/identity-setup.test.ts
git commit -m "feat: add identity-setup progress service"
```

---

### Task 2: IdentitySetupCard component

**Files:**
- Create: `src/components/IdentitySetupCard.vue`
- Create: `src/components/IdentitySetupCard.test.ts` (source/contract tests OK, matching HomePage style)

**Step 1: Failing test** — assert title strings, primary CTA labels for claim / contact / share / celebration, public URL shown when celebrating, dismiss calls snooze.

**Step 2: Implement card**

Props:
- `result: IdentitySetupResult`
- `publicUrl?: string`

Emits:
- `claim` | `add-contact` | `share` | `learn-more` | `dismiss`

UI:
- Title: celebration → `You're now @{handle}` ; else `Build your Nimiq identity`
- Checklist with ✓ / □
- Primary button from `nextStep` / celebration share
- Secondary: Learn more (claim) or Add contact (celebration) or Share (when next is contact and handle exists)
- Subtle dismiss control → emit dismiss
- Reuse existing panel classes (`home-panel` patterns from HomePage) — no new visual system

**Step 3: Tests pass · Commit**

```bash
git commit -m "feat: add IdentitySetupCard for Home guidance"
```

---

### Task 3: Wire card into HomePage + empty-state CTAs

**Files:**
- Modify: `src/pages/HomePage.vue`
- Modify: `src/pages/HomePage.test.ts`

**Behavior:**
1. Compute `handle` from profiles self + `handlesEnabled()` / existing handle lookup (reuse patterns from MyProfilePage — prefer `store.self?.handle` if set, else lightweight resolve already used elsewhere; keep Home simple: use `profilesStore.self?.handle ?? null` and refresh if Home already loads handle state; if not loaded today, add the same `handleForAddress` / saved handle read MyProfile uses — inspect `saveMyHandle` / `loadMyHandle` in handles service).
2. `resolveIdentitySetup({ handlesEnabled, handle, contactCount })`
3. Show `IdentitySetupCard` under header when `identitySetupVisible(result)`
4. Handlers: navigate `/me` with claim sheet query if needed, `/add`, share via `shareOrCopy(makePublicHandleLink(handle))` then `markPublicProfileShared()` + cancel snooze
5. Dismiss → `snoozeIdentitySetup()`
6. When `contactCount` goes 0→1 while mounted → `cancelSnooze()`
7. Fresh `EmptyState` CTAs per design (claim primary if no handle; else add contact primary + share secondary)

**Tests:** update `HomePage.test.ts` for empty-state copy/CTA markers and card presence markers in source.

**Commit:** `feat: show identity-setup card and smarter Home empty CTAs`

---

### Task 4: Enter celebration on handle claim

**Files:**
- Modify: `src/pages/MyProfilePage.vue` (`onClaimed`)
- Optionally: router push to `/` after claim so Home card is visible — only if it doesn’t break current “stay on profile” UX. Prefer: `markHandleClaimedCelebration(handle)` in `onClaimed`, and if user is on `/me`, show a small inline success already exists; also set celebration so when they visit Home the card celebrates. Optional `router.push('/')` after claim — **do it** so the growth loop is obvious (design: prefer focusing Home). Confirm with quick manual check; if profile publish flow needs to stay, push Home after `tryPublishPublicProfile`.

**Commit:** `feat: celebrate handle claim on identity-setup card`

---

### Task 5: Split empty state when no contacts

**Files:**
- Modify: `src/components/SplitBillSheet.vue`
- Modify: `src/components/SplitBillSheet.test.ts`

**Behavior:** When `open && store.sortedContacts.filter(person).length === 0`, render empty state instead of form:

```text
Split bills with people, not wallet addresses.

Add your first contact to start splitting expenses.

[ Add your first contact ]  → router.push('/add') then close sheet
```

No handle tip. When contacts exist, existing UI unchanged.

**Commit:** `feat: people-first empty state for Split with no contacts`

---

### Task 6: Learn-more copy + polish

**Files:**
- Prefer inline expandable hint in `IdentitySetupCard` (no new route): short paragraph on why `@handle` matters (public identity friends can open/pay).
- Run full suite: `npm test`
- Manual smoke: fresh user → claim CTA → celebrate → share → add contact → card gone; snooze; Split with 0 contacts.

**Commit:** `test: cover identity-setup Home and Split guidance`

---

## Execution notes

- Do not rename or gut `services/onboarding.ts` — name/backup sheets stay.
- Do not change bottom nav.
- Prefer deriving handle from existing handle cache helpers in `services/handles.ts` (`saveMyHandle` / load equivalents) so Home doesn’t need a full MyProfile publish stack.
- Keep CSS scoped and consistent with `home-panel` / existing buttons (`.primary-action`, `.nq-button` if already used on Home).

---

## Out of scope

- Nav icon redesign, dashboard reordering for power users, feature flags, wizards, permanent dismiss-before-complete.
