# Desktop Identity Portal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a desktop-only identity portal (Home, Lookup, My Identity, About) backed by Nimiq Hub for connect/claim/publish, without exposing Mini App payment/relationship surfaces on desktop.

**Architecture:** Detect desktop with existing `isDesktopBrowser()`. Outside Nimiq Pay, render a new `DesktopShell` with a small nav and route allowlist (`/`, `/lookup`, `/me`, `/about`, plus existing `/u/:handle`). Add `@nimiq/hub-api` behind `src/services/hub.ts` for `chooseAddress`, claim `checkout` (raw binary `extraData`, value `0`), and `signMessage`. Reuse `handles.ts` resolve/publish helpers and `Identicon.vue`; keep Pay's `window.nimiq` path untouched for the Mini App.

**Tech Stack:** Vue 3 SFCs, Vue Router (hash), Vitest + `@vue/test-utils`, `@nimiq/hub-api`, existing `@nimconnect/profile-client` `buildHandleClaimPayload`, CSS variables in `src/assets/main.css`.

**Design:** `docs/plans/2026-07-17-desktop-identity-portal-design.md` (Resolved MVP section is authoritative — no avatar upload, no directory/browser, no payments on desktop).

---

### Task 1: Nimiq Hub client wrapper

**Files:**
- Modify: `package.json` (add `@nimiq/hub-api`)
- Create: `src/services/hub.ts`
- Create: `src/services/hub.test.ts`

**Step 1: Install dependency**

```bash
npm install @nimiq/hub-api@^1.14.0
```

**Step 2: Write the failing tests**

```ts
// src/services/hub.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chooseAddress = vi.fn()
const checkout = vi.fn()
const signMessage = vi.fn()

vi.mock('@nimiq/hub-api', () => ({
  default: vi.fn().mockImplementation(() => ({ chooseAddress, checkout, signMessage })),
}))

describe('hub service', () => {
  beforeEach(() => {
    vi.resetModules()
    chooseAddress.mockReset()
    checkout.mockReset()
    signMessage.mockReset()
  })

  it('chooseHubAddress returns the selected address', async () => {
    chooseAddress.mockResolvedValue({ address: 'NQ01 TEST', label: 'Main' })
    const { chooseHubAddress } = await import('./hub')
    await expect(chooseHubAddress()).resolves.toBe('NQ01 TEST')
    expect(chooseAddress).toHaveBeenCalledWith({ appName: 'NimConnect' })
  })

  it('hubSignMessage returns hex publicKey and signature', async () => {
    signMessage.mockResolvedValue({
      signer: 'NQ01 TEST',
      signerPublicKey: new Uint8Array([1, 2]),
      signature: new Uint8Array([3, 4]),
    })
    const { hubSignMessage } = await import('./hub')
    await expect(hubSignMessage('hello', 'NQ01 TEST')).resolves.toEqual({
      publicKey: '0102',
      signature: '0304',
    })
  })

  it('hubCheckoutClaim sends raw binary extraData and value 0', async () => {
    checkout.mockResolvedValue({ hash: 'abcd' })
    const { hubCheckoutClaim } = await import('./hub')
    const extraData = new Uint8Array([0x4e, 0x46, 0x01, 0x01, 0x61])
    await expect(
      hubCheckoutClaim({
        recipient: 'NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y',
        extraData,
        sender: 'NQ01 TEST',
      }),
    ).resolves.toEqual({ txHash: 'abcd' })
    expect(checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: 'NimConnect',
        recipient: 'NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y',
        value: 0,
        extraData,
        sender: 'NQ01 TEST',
      }),
    )
  })
})
```

**Step 3: Run test to verify it fails**

Run: `npm test -- src/services/hub.test.ts`

Expected: FAIL — `./hub` module missing.

**Step 4: Implement `src/services/hub.ts`**

```ts
import HubApi from '@nimiq/hub-api'
import { buildHandleClaimPayload } from '@nimconnect/profile-client'

const APP_NAME = 'NimConnect'
const HUB_URL = import.meta.env.VITE_NIMIQ_HUB_URL ?? 'https://hub.nimiq.com'

let hub: HubApi | null = null

function getHub(): HubApi {
  if (!hub) hub = new HubApi(HUB_URL)
  return hub
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Account discovery — one address at a time. Not a login by itself. */
export async function chooseHubAddress(): Promise<string> {
  const info = await getHub().chooseAddress({ appName: APP_NAME })
  return info.address
}

export async function hubSignMessage(
  message: string,
  signer: string,
): Promise<{ publicKey: string; signature: string }> {
  const result = await getHub().signMessage({ appName: APP_NAME, message, signer })
  return {
    publicKey: toHex(result.signerPublicKey),
    signature: toHex(result.signature),
  }
}

export async function hubCheckoutClaim(opts: {
  recipient: string
  extraData: Uint8Array
  sender?: string
}): Promise<{ txHash: string }> {
  const signed = await getHub().checkout({
    appName: APP_NAME,
    recipient: opts.recipient,
    value: 0,
    extraData: opts.extraData,
    ...(opts.sender ? { sender: opts.sender } : {}),
  })
  return { txHash: signed.hash }
}

/** Convenience: build raw claim payload + Hub checkout. */
export async function claimHandleWithHub(
  handle: string,
  sender?: string,
): Promise<{ txHash: string }> {
  const { recipient, extraDataBytes } = buildHandleClaimPayload(handle)
  return hubCheckoutClaim({ recipient, extraData: extraDataBytes, sender })
}
```

Export `claimHandleWithHub` only if `@nimconnect/profile-client` is already importable from the app (workspace package). If the app does not yet depend on it, either add `"@nimconnect/profile-client": "workspace:*"` / `"*"` to root `package.json`, **or** inline the same byte build already in `makeClaimPayload` / `buildHandleClaimPayload` by constructing `extraDataBytes` in `handles.ts` (Task 2) and keep `hub.ts` free of that import. Prefer depending on the workspace package if install is trivial; otherwise keep payload building in `handles.ts`.

**Step 5: Run tests**

Run: `npm test -- src/services/hub.test.ts`

Expected: PASS.

**Step 6: Commit**

```bash
git add package.json package-lock.json src/services/hub.ts src/services/hub.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): add Nimiq Hub client for address, claim, and signMessage

EOF
)"
```

---

### Task 2: Desktop session + Hub claim/publish in handles

**Files:**
- Create: `src/services/desktop-session.ts`
- Create: `src/services/desktop-session.test.ts`
- Modify: `src/services/handles.ts`
- Modify: `src/services/handles.test.ts` (add cases for Hub claim / signer-injected publish)

**Step 1: Write failing session tests**

```ts
// src/services/desktop-session.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDesktopHubAddress,
  getDesktopHubAddress,
  setDesktopHubAddress,
} from './desktop-session'

describe('desktop-session', () => {
  beforeEach(() => {
    clearDesktopHubAddress()
  })

  it('stores and clears a single connected Hub address', () => {
    expect(getDesktopHubAddress()).toBeNull()
    setDesktopHubAddress('NQ01 TEST ADDRESS HERE XXXX')
    expect(getDesktopHubAddress()).toBe('NQ01 TEST ADDRESS HERE XXXX')
    clearDesktopHubAddress()
    expect(getDesktopHubAddress()).toBeNull()
  })
})
```

**Step 2: Implement session**

```ts
// src/services/desktop-session.ts
const KEY = 'nimconnect:desktop-hub-address'

export function getDesktopHubAddress(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) || null
  } catch {
    return null
  }
}

export function setDesktopHubAddress(address: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, address)
  } catch { /* best-effort */ }
}

export function clearDesktopHubAddress(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch { /* best-effort */ }
}
```

**Step 3: Extend handles for Hub claim + injectable signer**

In `src/services/handles.ts`:

1. Import `claimHandleWithHub` / `hubCheckoutClaim` from `./hub` (or build bytes locally + call `hubCheckoutClaim`).
2. Add `claimHandleViaHub`:

```ts
export async function claimHandleViaHub(
  handle: string,
  address: string,
): Promise<{ status: 'indexed' | 'pending'; txHash: string; claim?: HandleClaim }> {
  if (!isValidHandle(handle)) throw new Error('Invalid handle')
  if (!REGISTRY_ADDRESS) throw new Error('Handle registry not configured')
  const { txHash } = await claimHandleWithHub(handle, address)
  const res = await fetch(apiUrl('/api/handles/claims'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_hash: txHash }),
  })
  if (!res.ok) return { status: 'pending', txHash }
  const body = await res.json()
  const claim = body.claim as HandleClaim | undefined
  if (claim) saveMyHandle([address], claim)
  return {
    status: body.status === 'indexed' ? 'indexed' : 'pending',
    txHash,
    claim,
  }
}
```

3. Change `publishProfile` / `unpublishProfile` to accept an optional signer (default remains Pay `signChallenge`):

```ts
export type ChallengeSigner = (
  message: string,
) => Promise<{ publicKey: string; signature: string }>

export async function publishProfile(
  profile: Profile,
  share: ShareSelection,
  sign: ChallengeSigner = signChallenge,
): Promise<void> {
  // same body as today, but call `sign(...)` instead of `signChallenge(...)`
}

export async function unpublishProfile(
  address: string,
  sign: ChallengeSigner = signChallenge,
): Promise<void> { /* same */ }
```

Thread the optional `sign` through `syncPublicProfile` as well so desktop can pass `(msg) => hubSignMessage(msg, address)`.

**Do not** change the Pay claim path (`claimHandle` + `makeClaimPayload` + `CLAIM_AMOUNT_NIM`).

**Step 4: Tests**

- Session tests pass.
- Add a unit test that `publishProfile` invokes the injected signer (mock `fetch` + signer) rather than requiring Pay.
- Mock `./hub` when testing `claimHandleViaHub` so no real popup runs.

Run: `npm test -- src/services/desktop-session.test.ts src/services/handles.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/desktop-session.ts src/services/desktop-session.test.ts src/services/handles.ts src/services/handles.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): persist Hub address and claim/publish via Hub signer

EOF
)"
```

---

### Task 3: Desktop route allowlist + App shell gate

**Files:**
- Create: `src/config/desktop-portal.ts`
- Create: `src/config/desktop-portal.test.ts`
- Modify: `src/router.ts` — add `/lookup`, `/about`
- Modify: `src/App.vue` — desktop portal branch before handoff
- Modify: tests that assert desktop → handoff only (e.g. `src/components/PublicLandings.test.ts` / App tests if any) so allowlisted routes use the portal shell

**Step 1: Allowlist helper + tests**

```ts
// src/config/desktop-portal.ts
/** Routes served by the desktop identity shell (hash paths, no leading #). */
export const DESKTOP_PORTAL_ROUTES = ['/', '/lookup', '/me', '/about'] as const

export function isDesktopPortalPath(path: string): boolean {
  if (path.startsWith('/u/')) return true
  return (DESKTOP_PORTAL_ROUTES as readonly string[]).includes(path)
}
```

**Step 2: Router**

Add:

```ts
{ path: '/lookup', component: () => import('./pages/desktop/DesktopLookupPage.vue') },
{ path: '/about', component: () => import('./pages/desktop/DesktopAboutPage.vue') },
```

For `/` and `/me`, either:
- Point at thin portal wrappers created in Tasks 4–5, **or**
- Keep Mini App components for now and swap in later tasks.

Preferred: add wrappers in this task that still render existing pages until desktop pages exist, then replace in later tasks — **or** create stub desktop pages that say "TODO" only if tests require the import to resolve. Prefer real stub SFCs:

```vue
<!-- DesktopLookupPage.vue / DesktopAboutPage.vue / DesktopHomePage.vue stubs -->
<template><div data-desktop-stub>…</div></template>
```

Replace stubs in Tasks 4–6.

**Step 3: App.vue gate**

After public pay / shared profile / `/u/` branches, before `OpenInNimiqPayLanding`:

```vue
<DesktopShell
  v-else-if="desktopBrowser && !insideNimiqPay && !browserMode && isDesktopPortalPath(routePath)"
/>
```

Where `DesktopShell` includes `<router-view />` + top nav (Task 3b can be a minimal shell: nav placeholders + router-view).

Watch route: if `desktopBrowser && !insideNimiqPay && !browserMode && !isDesktopPortalPath(path) && path !== '/pay' && path !== '/add'`, `router.replace('/')`.

Keep `OpenInNimiqPayLanding` for **mobile** outside Pay (unchanged). Desktop no longer lands on the handoff for `/`.

**Step 4: Minimal `DesktopShell.vue`**

```vue
<!-- src/components/desktop/DesktopShell.vue -->
<template>
  <div class="desktop-shell" data-desktop-shell>
    <header class="desktop-shell__nav">
      <router-link to="/">NimConnect</router-link>
      <nav>
        <router-link to="/">Home</router-link>
        <router-link to="/lookup">Lookup</router-link>
        <router-link to="/me">My Identity</router-link>
        <router-link to="/about">About</router-link>
      </nav>
    </header>
    <main class="desktop-shell__main">
      <router-view />
    </main>
  </div>
</template>
```

Style with existing CSS variables; wide, calm layout (not the bottom-nav Mini App). Brand "NimConnect" must be visible in the shell header.

**Step 5: Tests**

- Unit: `isDesktopPortalPath` covers `/`, `/lookup`, `/me`, `/about`, `/u/x`, rejects `/contacts`.
- Component/source test: desktop App branch references `DesktopShell` / `data-desktop-shell` and does not force handoff for `/`.

Run: `npm test -- src/config/desktop-portal.test.ts` (and any App/landing tests touched).

**Step 6: Commit**

```bash
git add src/config/desktop-portal.ts src/config/desktop-portal.test.ts src/router.ts src/App.vue src/components/desktop/DesktopShell.vue src/pages/desktop/*.vue
git commit -m "$(cat <<'EOF'
feat(desktop): add identity portal shell and route allowlist

EOF
)"
```

---

### Task 4: Desktop Home page

**Files:**
- Create/Replace: `src/pages/desktop/DesktopHomePage.vue`
- Create: `src/pages/desktop/DesktopHomePage.test.ts`
- Wire `/` on desktop to this page (wrapper or router swap from Task 3)

**Copy (from design, adjusted for Resolved MVP framing):**

- Hero brand: **NimConnect**
- Headline: Claim your Nimiq identity.
- Subtext: Create a permanent @handle, public profile and payment page that works across the Nimiq ecosystem.
- Primary CTA: **Authorize identity** (navigates to `/me` — Hub connect happens there; do **not** label it as passive "Connect Wallet")
- Secondary CTA: **Open in Nimiq Pay** → `NIMPAY_OPEN_URL`
- Benefits list: Permanent @handle · Public payment page · Developer profile · Works across Mini Apps · Privacy-first

Reuse `PublicSurface` patterns / existing `.nq-button` styles. No cards-in-hero clutter. Identicon optional on home (not required).

**Tests:** source/mount asserts headline, primary CTA `to="/me"` or click target, secondary href `NIMPAY_OPEN_URL`, benefits present.

**Commit:**

```bash
git commit -m "$(cat <<'EOF'
feat(desktop): add identity marketing home page

EOF
)"
```

---

### Task 5: Desktop Lookup + About pages

**Files:**
- Replace: `src/pages/desktop/DesktopLookupPage.vue`
- Create: `src/pages/desktop/DesktopLookupPage.test.ts`
- Replace: `src/pages/desktop/DesktopAboutPage.vue`
- Create: `src/pages/desktop/DesktopAboutPage.test.ts`

**Lookup:** Extract the same flow as `OpenInNimiqPayLanding.submitLookup` — `parsePublicLookupQuery` → `resolveHandle` / `handleForAddress` → `router.push(/u/${handle})`. Exact match only; error copy: "No public @handle found" / "Enter an @handle or Nimiq address". No directory, no name search.

**About:** Short page stating NimConnect is the identity portal for the Nimiq ecosystem; desktop is for identity; everyday payments stay in Nimiq Pay; link to open Pay. Keep it one section.

**Handoff:** Leave lookup strip on `OpenInNimiqPayLanding` for now (mobile/desktop edge cases) **or** remove desktop-only lookup from handoff since desktop `/` no longer uses handoff — prefer removing only if tests in `PublicLandings.test.ts` are updated accordingly. Mobile handoff stays without requiring `/lookup`.

**Commit:**

```bash
git commit -m "$(cat <<'EOF'
feat(desktop): add exact lookup and about pages

EOF
)"
```

---

### Task 6: Desktop My Identity page

**Files:**
- Create: `src/pages/desktop/DesktopIdentityPage.vue`
- Create: `src/pages/desktop/DesktopIdentityPage.test.ts`
- Wire `/me` on desktop via wrapper (same pattern as Home)

**Behavior (MVP):**

1. **Disconnected:** CTA "Authorize identity" → `chooseHubAddress()` → `setDesktopHubAddress` → `handleForAddress(address)` / `findMyHandle([address])`.
   - If claim exists: load profile for editing (recovery — do **not** create a second identity).
   - If none: show claim form.
2. **Connected:** Always show the connected address + Identicon; affordance to disconnect (`clearDesktopHubAddress`) or switch account (`chooseHubAddress` again).
3. **Claim:** handle input + availability check (`checkHandle`) → `claimHandleViaHub(handle, address)` with Hub confirmation framing ("Authorize your identity" / confirm account — not a payment pitch).
4. **Edit fields:** display name, bio, website, GitHub, X, tags — same six public fields as Mini App. Per-field visibility toggles using `ShareSelection` / `defaultShareSelection` / `shareSelectionForProfile`.
5. **Live preview:** side panel (or below on narrow desktop widths) that reflects visibility immediately. "View live" opens `/u/:handle` when claimed.
6. **Save / publish:** `publishProfile` / `syncPublicProfile` with `(msg) => hubSignMessage(msg, address)`.
7. **Share:** copy `makePublicHandleLink(handle)` + optional QR via existing `QrCode.vue`.
8. **Avatar:** `Identicon` only — no upload UI.
9. **No** contacts, activity, buckets, invoices, payment history.

Reuse field UX ideas from `ProfileFormPage.vue` / `MyProfilePage.vue` but keep this page desktop-only and lean — do not import Mini App sheets that pull relationship features.

On unsupported Hub / user cancel: plain error — "Install or open a Nimiq Hub compatible wallet" (no silent Pay fallback).

**Tests (mount with stubs):**

- Disconnected state shows authorize CTA.
- With mocked session address + no claim → claim form.
- With mocked claim + profile → fields + preview; toggling visibility updates preview bindings.
- Publish calls injected/hub signer path (mock modules).

**Commit:**

```bash
git commit -m "$(cat <<'EOF'
feat(desktop): add My Identity claim, edit, preview, and publish

EOF
)"
```

---

### Task 7: Portal home/me wrappers + regression polish

**Files:**
- Create: `src/pages/PortalHomePage.vue`, `src/pages/PortalMePage.vue` (if not done earlier)
- Modify: `src/router.ts` to use them for `/` and `/me`
- Modify: `src/components/OpenInNimiqPayLanding.vue` / tests — desktop browser no longer depends on handoff for primary entry
- Modify: any broken tests from desktop gate change

**Wrapper pattern:**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { insideNimiqPay } from '../services/nimiq'
import { isDesktopBrowser } from '../utils/device'
import HomePage from './HomePage.vue'
import DesktopHomePage from './desktop/DesktopHomePage.vue'

const useDesktop = computed(() => isDesktopBrowser() && !insideNimiqPay.value)
</script>
<template>
  <DesktopHomePage v-if="useDesktop" />
  <HomePage v-else />
</template>
```

Same for `/me` → `DesktopIdentityPage` / `MyProfilePage`.

**Manual sanity checklist (document in commit body or PR later):**

1. Desktop `/` shows marketing home + shell nav.
2. `/lookup` resolves a known handle to `/u/...`.
3. `/me` Hub chooseAddress → recovery or claim → publish → preview matches live page.
4. `/contacts` redirects to `/`.
5. Inside Nimiq Pay (or mobile), Mini App shell unchanged.

Run full: `npm test`

Expected: PASS (fix any regressions from handoff/desktop assumptions).

**Commit:**

```bash
git commit -m "$(cat <<'EOF'
feat(desktop): route portal pages and keep Mini App shell intact

EOF
)"
```

---

### Task 8: Final verification

**Step 1:** `npm test`

**Step 2:** `npm run build` — ensure `vue-tsc` + Vite accept `@nimiq/hub-api` types.

**Step 3:** If Hub types complain about default export, add a small `src/types/nimiq-hub-api.d.ts` shim.

**Step 4:** Commit any type shims / lockfile fixes.

---

## Out of scope (do not implement)

- Avatar upload
- Public profile directory / search by display name or tags
- Desktop payments, requests, invoices, contacts, buckets, activity
- WalletConnect or non-Hub providers
- Silently falling back to Nimiq Pay on desktop for claim/publish

## Reference cheat sheet

| Need | Use |
|------|-----|
| Desktop detect | `src/utils/device.ts` → `isDesktopBrowser()` |
| Exact lookup | `parsePublicLookupQuery`, `resolveHandle`, `handleForAddress` |
| Raw claim bytes | `buildHandleClaimPayload` → `extraDataBytes` |
| Pay claim (unchanged) | `claimHandle` + `makeClaimPayload` |
| Publish messages | `buildProfilePutMessage` / `buildProfileDeleteMessage` |
| Identicon | `src/components/Identicon.vue` |
| Public page | `src/pages/PublicProfilePage.vue` |
| Hub docs | chooseAddress, checkout (`extraData`, `value: 0`), signMessage |
