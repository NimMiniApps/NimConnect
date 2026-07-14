# Public Payment-Request Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Payment-request share links open a public page anyone can pay from — amount, message, QR, address — with no app and no backend (spec §5 of `docs/superpowers/specs/2026-07-14-public-profiles-and-pay-links-design.md`).

**Architecture:** Share links now point at NimConnect's own origin (`…/#/pay?r=<nimiq-uri>`) instead of `nimpay.app`. When the SPA is opened outside Nimiq Pay with a parseable pay payload, App.vue renders a new `PublicPayLanding` component instead of the generic install landing. All request data travels in the URL; zero server state.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, vue-router (hash history), vitest (node env), existing `QrCode`/`Identicon` components, `@nimiq/utils` request-link encoding.

## Global Constraints

- Vitest runs with `environment: 'node'` — `window` is undefined, so `appOrigin()` returns `https://nimconnect.nimiqminiapps.com` in tests (see `src/services/links.ts:19-27`).
- No component-test infrastructure exists in this repo; testable logic lives in `src/services/*.ts`, components are verified by `npm run build` + manual run. Follow that convention — do NOT add @vue/test-utils or jsdom.
- Match existing code style: `<script setup lang="ts">`, scoped styles using CSS vars (`--text`, `--text-2`, `--card`, `--border`, `--nimiq-gold-bg`, `--nimiq-radius-pill`, `--nimiq-shadow`).
- Run all commands from the repo root: `/home/maestro/Documents/projects/NimConnect`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Retarget share links to the NimConnect origin; add Nimiq Pay deep-link helper

`makePaymentShareLink()` currently returns `https://nimpay.app/miniapps/open/…#/pay?r=…` (requires Nimiq Pay). Point it at `appOrigin()` instead, and expose the old nimpay.app URL as `makeNimiqPayDeepLink()` for the public page's "Pay with Nimiq Pay" button. All five existing callers of `makePaymentShareLink` (SplitBillSheet, InvoiceSheet, BucketSheet, HomePage, ProfileView) need no changes — the signature is identical.

**Files:**
- Modify: `src/services/links.ts:172-179`
- Test: `src/services/links.test.ts:19-35`

**Interfaces:**
- Consumes: `appOrigin()`, `makeRequestLink()`, `NIMPAY_OPEN_URL` (all already in/imported by `links.ts`).
- Produces: `makePaymentShareLink(address: string, amountNim?: number, message?: string): string` (unchanged signature, new origin) and `makeNimiqPayDeepLink(address: string, amountNim?: number, message?: string): string` — Task 2 imports the latter.

- [ ] **Step 1: Update the share-link test and add the deep-link test**

In `src/services/links.test.ts`, replace the first test (lines 19–28, `'creates HTTPS payment share links for messengers'`) with:

```ts
  it('creates payment share links on the NimConnect origin', () => {
    const link = makePaymentShareLink(A, 5, 'Split: dinner')
    expect(link).toMatch(/^https:\/\/nimconnect\.nimiqminiapps\.com\/?#\/pay\?r=/)
    const parsed = parsePaymentRequest(link)
    expect(parsed?.recipient).toBe(A)
    expect(parsed?.amountNim).toBe(5)
    expect(parsed?.message).toBe('Split: dinner')
  })

  it('creates Nimiq Pay deep links for the public pay page', () => {
    const link = makeNimiqPayDeepLink(A, 5, 'Split: dinner')
    expect(link).toMatch(/^https:\/\/nimpay\.app\/miniapps\/open\//)
    const parsed = parsePaymentRequest(link)
    expect(parsed?.recipient).toBe(A)
    expect(parsed?.amountNim).toBe(5)
  })
```

Add `makeNimiqPayDeepLink` to the import list from `./links` at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --run src/services/links.test.ts`
Expected: FAIL — `makeNimiqPayDeepLink` is not exported, and the origin assertion fails (link still starts with `https://nimpay.app`).

- [ ] **Step 3: Implement in links.ts**

Replace `src/services/links.ts:172-179` (the doc comment + `makePaymentShareLink`) with:

```ts
/**
 * HTTPS link for messengers (WhatsApp, Telegram, …): opens NimConnect's public
 * pay page — amount, message, QR, address — payable by anyone, no app needed.
 * QR codes should keep using makeRequestLink() directly.
 */
export function makePaymentShareLink(address: string, amountNim?: number, message?: string): string {
  const nimiq = makeRequestLink(address, amountNim, message)
  return `${appOrigin()}#/pay?r=${encodeURIComponent(nimiq)}`
}

/** Deep link that opens the request inside Nimiq Pay (used by the public pay page). */
export function makeNimiqPayDeepLink(address: string, amountNim?: number, message?: string): string {
  const nimiq = makeRequestLink(address, amountNim, message)
  return `${NIMPAY_OPEN_URL}#/pay?r=${encodeURIComponent(nimiq)}`
}
```

(`appOrigin` is defined in this same file; `NIMPAY_OPEN_URL` is already imported at the top.)

- [ ] **Step 4: Run the full test suite**

Run: `npm run test -- --run`
Expected: PASS — including the existing `'parses payment share links from pasted URLs'` test, since `parsePaymentShareLink` matches `#/pay?r=` on any origin.

- [ ] **Step 5: Commit**

```bash
git add src/services/links.ts src/services/links.test.ts
git commit -m "feat: payment share links target NimConnect's own origin

Non-users now land on our page instead of nimpay.app. The nimpay.app
deep link moves to makeNimiqPayDeepLink() for the public pay page.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PublicPayLanding component

Presentational component rendering a payment request for a logged-out visitor: identicon, requester label, amount, message, QR of the raw `nimiq:` URI (scannable by any Nimiq wallet), full address with copy button, "Pay with Nimiq Pay" deep link, app-store links, and a small "continue in browser" escape hatch. No unit test (no component-test infra — see Global Constraints); verified by build in this task and manually in Task 3.

**Files:**
- Create: `src/components/PublicPayLanding.vue`

**Interfaces:**
- Consumes: `makeRequestLink`, `makeNimiqPayDeepLink` (Task 1), `shortAddress`, type `ParsedPaymentRequest` from `../services/links`; `NIMPAY_APP_STORE_URL`, `NIMPAY_PLAY_STORE_URL` from `../config/host-app`; `QrCode.vue` (`text: string`, `size?: number`), `Identicon.vue` (`address: string`, `size?: number`).
- Produces: component with prop `payment: ParsedPaymentRequest` and emit `continue: []` — Task 3 mounts it in App.vue.

- [ ] **Step 1: Create the component**

Create `src/components/PublicPayLanding.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import QrCode from './QrCode.vue'
import Identicon from './Identicon.vue'
import {
  makeRequestLink,
  makeNimiqPayDeepLink,
  shortAddress,
  type ParsedPaymentRequest,
} from '../services/links'
import { NIMPAY_APP_STORE_URL, NIMPAY_PLAY_STORE_URL } from '../config/host-app'

const props = defineProps<{ payment: ParsedPaymentRequest }>()
const emit = defineEmits<{ continue: [] }>()

const nimiqUri = computed(() =>
  makeRequestLink(props.payment.recipient, props.payment.amountNim, props.payment.message))
const payDeepLink = computed(() =>
  makeNimiqPayDeepLink(props.payment.recipient, props.payment.amountNim, props.payment.message))
const amountText = computed(() =>
  props.payment.amountNim != null
    ? `${props.payment.amountNim.toLocaleString(undefined, { maximumFractionDigits: 5 })} NIM`
    : null)

const copied = ref(false)
async function copyAddress() {
  try {
    await navigator.clipboard.writeText(props.payment.recipient)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard unavailable (http / permissions) — the address text is selectable.
  }
}
</script>

<template>
  <div class="landing">
    <header class="who">
      <Identicon :address="payment.recipient" :size="64" />
      <p class="asking">
        <strong>{{ payment.label || shortAddress(payment.recipient) }}</strong>
        requests a payment
      </p>
    </header>

    <main class="request">
      <p v-if="amountText" class="amount">{{ amountText }}</p>
      <p v-if="payment.message" class="message">{{ payment.message }}</p>

      <QrCode :text="nimiqUri" :size="220" />
      <p class="scan-hint">Scan with any Nimiq wallet to pay</p>

      <button type="button" class="address" @click="copyAddress">
        <span class="address-text">{{ payment.recipient }}</span>
        <span class="copy-label">{{ copied ? 'Copied ✓' : 'Copy address' }}</span>
      </button>
    </main>

    <section class="actions" aria-label="Pay with Nimiq Pay">
      <a :href="payDeepLink" class="pay-btn">Pay with Nimiq Pay</a>
      <p class="store-label">Don't have Nimiq Pay yet?</p>
      <div class="stores">
        <a :href="NIMPAY_PLAY_STORE_URL" class="store-btn" target="_blank" rel="noopener noreferrer">Google Play</a>
        <a :href="NIMPAY_APP_STORE_URL" class="store-btn" target="_blank" rel="noopener noreferrer">App Store</a>
      </div>
    </section>

    <footer class="brand">
      <p>Sent with <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
      <button type="button" class="browser-link" @click="emit('continue')">
        Open NimConnect in the browser
      </button>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.who {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.asking { margin: 0; font-size: 16px; color: var(--text-2); }
.asking strong { color: var(--text); font-weight: 800; }
.request {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 16px;
  border-radius: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.amount { margin: 0; font-size: 34px; font-weight: 800; color: var(--text); }
.message { margin: 0; font-size: 15px; color: var(--text-2); text-align: center; }
.scan-hint { margin: 0; font-size: 13px; color: var(--text-2); }
.address {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: none;
  font: inherit;
  cursor: pointer;
  color: var(--text);
}
.address-text { font-size: 13px; font-family: monospace; word-break: break-all; user-select: all; }
.copy-label { font-size: 12px; font-weight: 700; color: var(--nq-light-blue); }
.actions { display: flex; flex-direction: column; gap: 12px; }
.pay-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 24px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 17px;
  font-weight: 800;
  text-decoration: none;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
  box-shadow: var(--nimiq-shadow);
}
.store-label { margin: 0; text-align: center; font-size: 13px; font-weight: 700; color: var(--text-2); }
.stores { display: flex; gap: 10px; }
.store-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border-radius: var(--nimiq-radius-small);
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  font-weight: 800;
  text-decoration: none;
}
.brand { margin-top: auto; text-align: center; }
.brand p { margin: 0 0 4px; font-size: 13px; color: var(--text-2); }
.brand strong { color: var(--nq-gold-dark); }
.browser-link {
  padding: 8px;
  border: none;
  background: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--nq-light-blue);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript or template errors. (Component isn't mounted anywhere yet — that's Task 3.)

- [ ] **Step 3: Commit**

```bash
git add src/components/PublicPayLanding.vue
git commit -m "feat: public pay landing — request view for non-users

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire PublicPayLanding into App.vue

When the app is opened outside Nimiq Pay without browser-mode opt-in AND the route is `/pay` with a parseable payload, show `PublicPayLanding` instead of `OpenInNimiqPayLanding`. The existing guard in `handleIncomingPaymentLink` (`src/App.vue:164`) already returns early in this state without consuming the URL, so the payload stays available; "continue in browser" flips `browserMode`, which triggers the existing watcher that opens the in-app pay sheet.

**Files:**
- Modify: `src/App.vue` (script: imports at lines 2 and 9–11 area, new computed after line 31; template: lines 180–183)

**Interfaces:**
- Consumes: `PublicPayLanding` (Task 2: prop `payment: ParsedPaymentRequest`, emit `continue`), `parsePaymentRequest` (already imported in App.vue).
- Produces: final user-facing behavior; nothing downstream.

- [ ] **Step 1: Add the computed and import**

In `src/App.vue`:

1. Change line 2 to add `computed`:
```ts
import { ref, computed, onMounted, watch, nextTick } from 'vue'
```
2. Add below the `OpenInNimiqPayLanding` import (line 11):
```ts
import PublicPayLanding from './components/PublicPayLanding.vue'
```
3. Add after `const browserMode = ref(hasBrowserModeOptIn())` (line 31):
```ts
// Parseable /pay payload while outside Nimiq Pay → public request page.
const publicPayRequest = computed<ParsedPaymentRequest | null>(() => {
  if (router.currentRoute.value.path !== '/pay') return null
  const raw = router.currentRoute.value.query.r
  return typeof raw === 'string'
    ? parsePaymentRequest(decodeURIComponent(raw))
    : parsePaymentRequest(window.location.href)
})
```

- [ ] **Step 2: Branch the landing in the template**

Replace `src/App.vue:180-183`:

```vue
  <OpenInNimiqPayLanding
    v-if="!insideNimiqPay && !browserMode"
    @continue="onContinueInBrowser"
  />
```

with:

```vue
  <PublicPayLanding
    v-if="!insideNimiqPay && !browserMode && publicPayRequest"
    :payment="publicPayRequest"
    @continue="onContinueInBrowser"
  />
  <OpenInNimiqPayLanding
    v-else-if="!insideNimiqPay && !browserMode"
    @continue="onContinueInBrowser"
  />
```

(The main app `<div v-else class="app">` that follows keeps working: it renders when `insideNimiqPay || browserMode`, same as before.)

- [ ] **Step 3: Build and run the test suite**

Run: `npm run build && npm run test -- --run`
Expected: both PASS.

- [ ] **Step 4: Manual verification**

1. Start the dev server: `npm run dev` (frontend only is enough — no backend involved).
2. In a private/incognito window (no `nimconnect:browser-mode` in localStorage), open:
   `http://localhost:5173/#/pay?r=nimiq%3ANQ07%200000%200000%200000%200000%200000%200000%200000%200000%3Famount%3D5%26message%3DSplit%253A%2520dinner`
3. Expected: the public request page — identicon, "NQ07 0000…0000 requests a payment", "5 NIM", "Split: dinner", QR code, full address (click → "Copied ✓"), gold "Pay with Nimiq Pay" button, store links.
4. Open plain `http://localhost:5173/` in the same private window: expected the ORIGINAL install landing (regression check).
5. On the request page, click "Open NimConnect in the browser": expected the app loads and the pay sheet opens pre-filled (existing `handleIncomingPaymentLink` path).

- [ ] **Step 5: Commit**

```bash
git add src/App.vue
git commit -m "feat: show public request page for /pay links opened outside Nimiq Pay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
