# Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four approved feedback features: activity banner on Home, recurring invoices via atomic `markPaid`, fiat approximations on history rows, and a dedicated Insights page.

**Architecture:** All client-side, no backend changes. New pure services (`activity.ts`, `insights.ts`) with Vitest units; store change is one atomic Dexie transaction in `stores/invoices.ts`; UI changes ride existing pages/components. Spec: `docs/superpowers/specs/2026-07-13-feedback-fixes-design.md`.

**Tech Stack:** Vue 3 + `<script setup>`, Pinia, Dexie (IndexedDB, `fake-indexeddb` in tests), Vitest, vue-router (hash history).

## Global Constraints

- No new dependencies.
- No Dexie `version()` bump — new `Invoice` fields are unindexed.
- All chain timestamps must go through `timestampMs()` from `src/services/history.ts` before comparison (values arrive in seconds *or* ms).
- localStorage keys use the `nimconnect:` prefix; writes are best-effort (`try {} catch {}`), matching `src/services/history.ts`.
- Compact-address comparison everywhere: `a.replace(/\s+/g, '').toUpperCase()`.
- Run tests with `npx vitest run <file>`; typecheck+build with `npm run build`.
- Commit messages: imperative, prefix `feat:`/`test:`, end with the Claude co-author trailer.

---

### Task 1: `markPaid` with atomic successor creation (invoices store)

**Files:**
- Modify: `src/types/profile.ts:28-42` (Invoice interface)
- Modify: `src/stores/invoices.ts` (new `addMonthClamped`, `markPaid`; extend `importMany`; export both)
- Test: `src/stores/invoices.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `db.invoices` (Dexie Table), `uuid()`, `notifyDataChanged()`.
- Produces:
  - `Invoice.repeat?: 'weekly' | 'monthly'`, `Invoice.successorInvoiceId?: string`
  - `export function addMonthClamped(ms: number): number`
  - store method `markPaid(id: string): Promise<void>` (returned from `useInvoicesStore`)

- [ ] **Step 1: Add the new Invoice fields**

In `src/types/profile.ts`, extend the `Invoice` interface (after `fiatCurrency?: string`):

```ts
  /** Recreate as a new pending invoice when this one is paid. Unindexed — no Dexie migration needed */
  repeat?: 'weekly' | 'monthly'
  /** Id of the successor created when a repeating invoice was paid — guards against duplicates */
  successorInvoiceId?: string
```

- [ ] **Step 2: Write the failing tests**

Append to `src/stores/invoices.test.ts` (inside the file, as a new top-level `describe`; reuse the existing `A` const and imports, adding `markPaid`-related imports):

```ts
import { addMonthClamped } from './invoices'

describe('addMonthClamped', () => {
  it('advances a mid-month date by one calendar month', () => {
    const d = new Date(addMonthClamped(new Date(2026, 0, 15).getTime()))
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 1, 15])
  })

  it('clamps Jan 31 to the last day of February', () => {
    const d = new Date(addMonthClamped(new Date(2026, 0, 31).getTime()))
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 1, 28])
  })

  it('clamps to Feb 29 in leap years', () => {
    const d = new Date(addMonthClamped(new Date(2028, 0, 31).getTime()))
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2028, 1, 29])
  })
})

describe('recurring invoices', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.invoices.clear()
  })

  it('markPaid without repeat marks paid and creates no successor', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 10, description: 'One-off' })
    await store.markPaid(inv.id)
    expect(store.invoices).toHaveLength(1)
    expect(store.invoices[0].status).toBe('paid')
    expect(store.invoices[0].successorInvoiceId).toBeUndefined()
  })

  it('markPaid on a repeating invoice creates one pending successor, due one interval later', async () => {
    const store = useInvoicesStore()
    await store.load()
    const due = new Date(2026, 6, 1).getTime()
    const inv = await store.create({ address: A, amountNim: 10, description: 'Rent', dueAt: due, repeat: 'monthly' })
    await store.markPaid(inv.id)

    const source = store.invoices.find(i => i.id === inv.id)!
    expect(source.status).toBe('paid')
    expect(source.successorInvoiceId).toBeTypeOf('string')

    const successor = store.invoices.find(i => i.id === source.successorInvoiceId)!
    expect(successor.status).toBe('pending')
    expect(successor.address).toBe(A)
    expect(successor.amountNim).toBe(10)
    expect(successor.repeat).toBe('monthly')
    expect(successor.dueAt).toBe(addMonthClamped(due))
    expect(await db.invoices.get(successor.id)).toBeTruthy()
  })

  it('weekly repeat advances dueAt by 7 days; no dueAt falls back to paidAt + interval', async () => {
    const store = useInvoicesStore()
    await store.load()
    const due = new Date(2026, 6, 1).getTime()
    const weekly = await store.create({ address: A, amountNim: 5, description: 'W', dueAt: due, repeat: 'weekly' })
    const noDue = await store.create({ address: A, amountNim: 5, description: 'N', repeat: 'weekly' })
    await store.markPaid(weekly.id)
    await store.markPaid(noDue.id)

    const wSucc = store.invoices.find(i => i.id === store.invoices.find(x => x.id === weekly.id)!.successorInvoiceId)!
    expect(wSucc.dueAt).toBe(due + 7 * 86_400_000)

    const nSource = store.invoices.find(i => i.id === noDue.id)!
    const nSucc = store.invoices.find(i => i.id === nSource.successorInvoiceId)!
    expect(nSucc.dueAt).toBe(nSource.paidAt! + 7 * 86_400_000)
  })

  it('double and concurrent markPaid create exactly one successor', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 10, description: 'Rent', repeat: 'monthly' })
    await Promise.all([store.markPaid(inv.id), store.markPaid(inv.id)])
    await store.markPaid(inv.id)
    expect(store.invoices).toHaveLength(2)
    expect(await db.invoices.count()).toBe(2)
  })

  it('paid → pending → paid round trip never creates a second successor', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 10, description: 'Rent', repeat: 'monthly' })
    await store.markPaid(inv.id)
    await store.setStatus(inv.id, 'pending')
    expect(store.invoices.find(i => i.id === inv.id)!.successorInvoiceId).toBeTypeOf('string')
    await store.markPaid(inv.id)
    expect(store.invoices).toHaveLength(2)
  })

  it('importMany passes repeat and successorInvoiceId through', async () => {
    const store = useInvoicesStore()
    await store.load()
    await store.importMany([{
      id: 'imp-1', address: A, amountNim: 3, description: 'x', status: 'pending',
      createdAt: Date.now(), repeat: 'monthly', successorInvoiceId: 'imp-2',
    } as Invoice])
    expect(store.invoices[0].repeat).toBe('monthly')
    expect(store.invoices[0].successorInvoiceId).toBe('imp-2')
  })
})
```

Note: `create()` doesn't accept `repeat` yet — extending it is part of the implementation (Step 4).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/stores/invoices.test.ts`
Expected: FAIL — `addMonthClamped` not exported, `markPaid` not a function, `repeat` rejected by `create` input type.

- [ ] **Step 4: Implement**

In `src/stores/invoices.ts`:

Add below `isOverdue` (module level, exported for tests):

```ts
/** One calendar month later, clamped to the target month's last day (Jan 31 → Feb 28/29). */
export function addMonthClamped(ms: number): number {
  const d = new Date(ms)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d.getTime()
}

function nextDueAt(repeat: 'weekly' | 'monthly', from: number): number {
  return repeat === 'weekly' ? from + 7 * 86_400_000 : addMonthClamped(from)
}
```

Extend `create()`'s input type with `repeat?: 'weekly' | 'monthly'` and add to the constructed invoice:

```ts
      ...(input.repeat ? { repeat: input.repeat } : {}),
```

Add `markPaid` next to `setStatus`:

```ts
  /** Atomic paid transition: creates the repeat successor exactly once, even under
   * concurrent calls, a crash mid-transition, or a paid → pending → paid round trip. */
  async function markPaid(id: string) {
    const result = await db.transaction('rw', db.invoices, async () => {
      const source = await db.invoices.get(id)
      if (!source || source.status === 'paid') return null
      const updated: Invoice = { ...source, status: 'paid', paidAt: Date.now() }
      let successor: Invoice | null = null
      if (source.repeat && !source.successorInvoiceId) {
        successor = {
          id: uuid(),
          address: source.address,
          amountNim: source.amountNim,
          description: source.description,
          status: 'pending',
          createdAt: Date.now(),
          repeat: source.repeat,
          // Cadence stays anchored to the schedule: advance from the prior due date,
          // not from when it happened to be paid (may create an already-overdue successor)
          dueAt: nextDueAt(source.repeat, source.dueAt ?? updated.paidAt!),
          ...(source.fiatAmount && source.fiatCurrency
            ? { fiatAmount: source.fiatAmount, fiatCurrency: source.fiatCurrency }
            : {}),
        }
        updated.successorInvoiceId = successor.id
        await db.invoices.add(JSON.parse(JSON.stringify(successor)))
      }
      await db.invoices.put(JSON.parse(JSON.stringify(updated)))
      return { updated, successor }
    })
    if (!result) return
    invoices.value = invoices.value.map(i => (i.id === id ? result.updated : i))
    if (result.successor) invoices.value.push(result.successor)
    notifyDataChanged()
  }
```

In `importMany`, add to the constructed invoice:

```ts
        ...(raw.repeat === 'weekly' || raw.repeat === 'monthly' ? { repeat: raw.repeat } : {}),
        ...(raw.successorInvoiceId ? { successorInvoiceId: String(raw.successorInvoiceId) } : {}),
```

Add `markPaid` to the returned object (after `setStatus`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/stores/invoices.test.ts`
Expected: PASS (all existing + new).

- [ ] **Step 6: Commit**

```bash
git add src/types/profile.ts src/stores/invoices.ts src/stores/invoices.test.ts
git commit -m "feat: recurring invoices — atomic markPaid creates one successor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Recurring UI — repeat select + markPaid call sites

**Files:**
- Modify: `src/components/InvoiceSheet.vue` (repeat select in form; toggle button uses `markPaid` for the paid direction; repeat shown in detail)
- Modify: `src/pages/HomePage.vue:372,393` (both "Mark paid" buttons → `markPaid`)

**Interfaces:**
- Consumes: `invoicesStore.markPaid(id)`, `create({ ..., repeat })` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: InvoiceSheet form + call site**

In `src/components/InvoiceSheet.vue` script, add state next to `dueDate`:

```ts
const repeat = ref<'' | 'weekly' | 'monthly'>('')
```

In `create()`, pass it and reset it (next to `dueDate.value = ''`):

```ts
      ...(repeat.value ? { repeat: repeat.value } : {}),
```
```ts
    repeat.value = ''
```

In the template, after the due-date `<label>`:

```html
          <label class="due-label">
            Repeats
            <select v-model="repeat">
              <option value="">Never</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
```

Add `select` to the existing input styling selector: change `.new-fields input {` to `.new-fields input, .new-fields select {`.

Change the toggle button (line ~160) so the paid direction is atomic:

```html
              <button type="button" class="secondary" @click="inv.status === 'paid' ? invoicesStore.setStatus(inv.id, 'pending') : invoicesStore.markPaid(inv.id)">
                {{ inv.status === 'paid' ? 'Mark pending' : 'Mark paid' }}
              </button>
```

In the detail `<p class="when">`, append after the paidAt template:

```html
<template v-if="inv.repeat"> · Repeats {{ inv.repeat }}</template>
```

- [ ] **Step 2: HomePage call sites**

In `src/pages/HomePage.vue`, replace both occurrences of
`@click="invoicesStore.setStatus(invoice.id, 'paid')"` (lines 372 and 393) with
`@click="invoicesStore.markPaid(invoice.id)"`.

- [ ] **Step 3: Verify**

Run: `npx vitest run && npm run build`
Expected: tests PASS, build clean.
Manual: `npm run dev` → contact → Invoice → create a monthly invoice with a due date → Mark paid → a new pending invoice appears dated one month later.

- [ ] **Step 4: Commit**

```bash
git add src/components/InvoiceSheet.vue src/pages/HomePage.vue
git commit -m "feat: repeat select on invoices; mark-paid buttons use atomic markPaid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Activity service (new-activity detection + scoped last-seen)

**Files:**
- Create: `src/services/activity.ts`
- Test: `src/services/activity.test.ts`

**Interfaces:**
- Consumes: `timestampMs`, `IncomingPayment` from `./history`; `Invoice`, `InboxItem` from `../types/profile`.
- Produces (used by Task 4):
  - `newActivity(input: { payments: IncomingPayment[]; inboxItems: InboxItem[]; invoices: Invoice[]; lastSeenAt: number; now?: number }): { payments: IncomingPayment[]; requests: InboxItem[]; dueInvoices: Invoice[] }`
  - `getLastSeen(addresses: string[]): number | null`
  - `setLastSeen(addresses: string[], at?: number): void`
  - `DUE_SOON_MS` (48h in ms)

- [ ] **Step 1: Write the failing tests**

Create `src/services/activity.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { newActivity, getLastSeen, setLastSeen, DUE_SOON_MS } from './activity'
import type { IncomingPayment } from './history'
import type { Invoice, InboxItem } from '../types/profile'

const T0 = new Date(2026, 6, 10).getTime()

function payment(overrides: Partial<IncomingPayment>): IncomingPayment {
  return { hash: Math.random().toString(36), timestamp: T0, valueNim: 1, sender: 'NQ07 0000', ...overrides }
}

function inboxItem(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: Math.random().toString(36), objectId: 'o', type: 'payment-request', sender: 'NQ07 0000',
    payload: '', sentAt: T0, receivedAt: T0, status: 'actionable', importedAt: T0, reminders: 0,
    ...overrides,
  }
}

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: Math.random().toString(36), address: 'NQ07 0000', amountNim: 1, description: '',
    status: 'pending', createdAt: T0, ...overrides,
  }
}

describe('newActivity', () => {
  it('flags payments and requests newer than lastSeenAt', () => {
    const out = newActivity({
      payments: [payment({ timestamp: T0 + 1000 }), payment({ timestamp: T0 - 1000 })],
      inboxItems: [inboxItem({ receivedAt: T0 + 1000 }), inboxItem({ receivedAt: T0 - 1000 })],
      invoices: [],
      lastSeenAt: T0,
    })
    expect(out.payments).toHaveLength(1)
    expect(out.requests).toHaveLength(1)
  })

  it('normalizes seconds-based chain timestamps before comparing', () => {
    const seconds = Math.floor((T0 + 60_000) / 1000)
    const out = newActivity({
      payments: [payment({ timestamp: seconds })],
      inboxItems: [], invoices: [], lastSeenAt: T0,
    })
    expect(out.payments).toHaveLength(1)
  })

  it('ignores non-actionable inbox items', () => {
    const out = newActivity({
      payments: [],
      inboxItems: [inboxItem({ receivedAt: T0 + 1000, status: 'dismissed' })],
      invoices: [], lastSeenAt: T0,
    })
    expect(out.requests).toHaveLength(0)
  })

  it('flags pending invoices overdue or due within 48h, regardless of lastSeenAt', () => {
    const out = newActivity({
      payments: [], inboxItems: [],
      invoices: [
        invoice({ dueAt: T0 - 1000 }),                       // overdue
        invoice({ dueAt: T0 + DUE_SOON_MS - 1000 }),         // due soon
        invoice({ dueAt: T0 + DUE_SOON_MS + 1000 }),         // far future
        invoice({ dueAt: T0 - 1000, status: 'paid' }),       // paid
        invoice({}),                                          // no due date
      ],
      lastSeenAt: T0 + 999_999_999, now: T0,
    })
    expect(out.dueInvoices).toHaveLength(2)
  })
})

describe('last-seen storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when unset, round-trips a value, and is scoped per address set', () => {
    const a = ['NQ07 0000 0000']
    const b = ['NQ26 8MMT 8317']
    expect(getLastSeen(a)).toBeNull()
    setLastSeen(a, 12345)
    expect(getLastSeen(a)).toBe(12345)
    expect(getLastSeen(b)).toBeNull()
  })

  it('address order and whitespace do not change the key', () => {
    setLastSeen(['NQ07 0000', 'NQ26 8MMT'], 777)
    expect(getLastSeen(['nq268mmt'.toUpperCase(), 'NQ070000'])).toBe(777)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/activity.test.ts`
Expected: FAIL — module `./activity` not found.

- [ ] **Step 3: Implement**

Create `src/services/activity.ts`:

```ts
import { timestampMs, type IncomingPayment } from './history'
import type { Invoice, InboxItem } from '../types/profile'

export const DUE_SOON_MS = 48 * 3_600_000

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
const keyFor = (addresses: string[]) =>
  `nimconnect:last-seen-activity:${addresses.map(compact).sort().join('+')}`

/** Last dismissed-at for this wallet identity; null on first run (caller initializes to now). */
export function getLastSeen(addresses: string[]): number | null {
  const raw = globalThis.localStorage?.getItem(keyFor(addresses))
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function setLastSeen(addresses: string[], at = Date.now()) {
  try {
    globalThis.localStorage?.setItem(keyFor(addresses), String(at))
  } catch { /* best-effort */ }
}

export interface NewActivity {
  payments: IncomingPayment[]
  requests: InboxItem[]
  dueInvoices: Invoice[]
}

/** What changed since the user last dismissed the banner. Due invoices are not
 * timestamp-gated — they reappear until paid. */
export function newActivity(input: {
  payments: IncomingPayment[]
  inboxItems: InboxItem[]
  invoices: Invoice[]
  lastSeenAt: number
  now?: number
}): NewActivity {
  const now = input.now ?? Date.now()
  return {
    payments: input.payments.filter(p => timestampMs(p.timestamp) > input.lastSeenAt),
    requests: input.inboxItems.filter(
      i => i.status === 'actionable' && timestampMs(i.receivedAt) > input.lastSeenAt,
    ),
    dueInvoices: input.invoices.filter(
      i => i.status === 'pending' && !!i.dueAt && i.dueAt < now + DUE_SOON_MS,
    ),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/activity.ts src/services/activity.test.ts
git commit -m "feat: activity service — new-payment/request/due detection, scoped last-seen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Home banner + invoice-sheet deep link

**Files:**
- Modify: `src/pages/HomePage.vue` (banner section, last-seen wiring)
- Modify: `src/components/ProfileView.vue` (open invoice sheet from `?sheet=invoice`)

**Interfaces:**
- Consumes: `newActivity`, `getLastSeen`, `setLastSeen` from Task 3; existing `incoming`, `inboxStore.actionable`, `invoicesStore.pending`, `profileFor`, `contactName`, `resolveMyAddresses`.
- Produces: route convention `/profile/:id?sheet=invoice` (also used by nothing else yet).

- [ ] **Step 1: Wire last-seen + activity into HomePage**

In `src/pages/HomePage.vue` script, add imports:

```ts
import { newActivity, getLastSeen, setLastSeen } from '../services/activity'
```

Add state near `incoming`:

```ts
const myAddresses = ref<string[]>([])
const lastSeenAt = ref<number | null>(null)
const dueDismissed = ref(false)
```

In `loadIncoming()`, capture the resolved addresses and initialize first-run last-seen. Replace the body's first fetch line:

```ts
    myAddresses.value = await resolveMyAddresses(profilesStore.self.address)
    incoming.value = await fetchIncomingPayments(myAddresses.value)
```

and after that line (still in the `try`), add:

```ts
    // First run for this wallet: nothing pre-existing is "new"
    if (lastSeenAt.value == null) {
      const seen = getLastSeen(myAddresses.value)
      if (seen == null) setLastSeen(myAddresses.value)
      lastSeenAt.value = seen ?? Date.now()
    }
```

Add computeds/handler after `detectedPaid`:

```ts
/** Banner data: what changed since the last dismiss. Null until first load resolves. */
const activity = computed(() => {
  if (lastSeenAt.value == null) return null
  const a = newActivity({
    payments: incoming.value,
    inboxItems: inboxStore.actionable,
    invoices: invoicesStore.pending,
    lastSeenAt: lastSeenAt.value,
  })
  return { ...a, dueInvoices: dueDismissed.value ? [] : a.dueInvoices }
})

const bannerSummary = computed(() => {
  if (!activity.value) return null
  const parts: string[] = []
  const p = activity.value.payments.length
  if (p) parts.push(`${p} payment${p === 1 ? '' : 's'} received`)
  const r = activity.value.requests.length
  if (r) parts.push(`${r} new request${r === 1 ? '' : 's'}`)
  const d = activity.value.dueInvoices.length
  if (d) parts.push(`${d} invoice${d === 1 ? '' : 's'} due`)
  return parts.length ? parts.join(' · ') : null
})

function dismissBanner() {
  const now = Date.now()
  setLastSeen(myAddresses.value, now)
  lastSeenAt.value = now
  dueDismissed.value = true // due invoices are not timestamp-gated; hide for this session
}
```

- [ ] **Step 2: Banner template + styles**

In the template, directly after the `<EmptyState v-if="freshUser" …>` block (before the attention section), add:

```html
    <section v-if="bannerSummary && activity" class="card activity-banner" role="status">
      <div class="banner-head">
        <span class="banner-summary">🔔 {{ bannerSummary }}</span>
        <button type="button" class="banner-dismiss" aria-label="Dismiss" @click="dismissBanner">✕</button>
      </div>
      <div class="banner-items">
        <router-link
          v-for="p in activity.payments.slice(0, 3)"
          :key="p.hash"
          :to="profileFor(p.sender) ? `/profile/${profileFor(p.sender)!.id}` : { path: '/add', query: { address: p.sender } }"
          class="banner-item"
        >
          +{{ p.valueNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM from {{ contactName(p.sender) }}
        </router-link>
        <router-link
          v-for="item in activity.requests.slice(0, 3)"
          :key="item.id"
          v-if="profileFor(item.sender)"
          :to="`/profile/${profileFor(item.sender)!.id}`"
          class="banner-item"
        >
          Request from {{ contactName(item.sender) }}
        </router-link>
        <template v-for="inv in activity.dueInvoices.slice(0, 3)" :key="inv.id">
          <router-link
            v-if="profileFor(inv.address)"
            :to="{ path: `/profile/${profileFor(inv.address)!.id}`, query: { sheet: 'invoice' } }"
            class="banner-item due"
          >
            {{ isOverdue(inv) ? 'Overdue' : 'Due soon' }}: {{ inv.description || 'Invoice' }} — {{ contactName(inv.address) }}
          </router-link>
          <span v-else class="banner-item due">
            {{ isOverdue(inv) ? 'Overdue' : 'Due soon' }}: {{ inv.description || 'Invoice' }} — {{ contactName(inv.address) }}
          </span>
        </template>
      </div>
    </section>
```

Note: `v-for` + `v-if` on the same element is a Vue lint error — the requests loop above filters unknown senders; if `vue-tsc` complains, wrap in `<template v-for>` exactly like the dueInvoices loop.

Styles (append to the scoped style block):

```css
.activity-banner { padding: 12px 14px; margin-bottom: 14px; border-left: 4px solid var(--nq-gold); }
.banner-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.banner-summary { font-size: 13px; font-weight: 800; }
.banner-dismiss {
  min-width: 32px; min-height: 32px; border: none; background: none; cursor: pointer;
  color: var(--text-2); font-size: 14px;
}
.banner-items { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.banner-item { font-size: 13px; color: var(--nq-light-blue); text-decoration: none; font-weight: 600; }
.banner-item.due { color: var(--nq-gold-dark); }
```

- [ ] **Step 3: Invoice sheet deep link in ProfileView**

In `src/components/ProfileView.vue`, add to imports:

```ts
import { useRoute } from 'vue-router'
```

Add `const route = useRoute()` next to `const store = …`, and extend `onMounted`:

```ts
onMounted(() => {
  if (props.own) return
  getRates().then(r => (rates.value = r))
  if (store.self) loadHistory()
  if (route.query.sheet === 'invoice') openSheet('invoice')
})
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS, clean build.
Manual: `npm run dev` → Home shows no banner on a fresh profile; create an invoice due today → banner "1 invoice due"; tap it → contact profile opens with invoice sheet; dismiss → banner gone for the session.

- [ ] **Step 5: Commit**

```bash
git add src/pages/HomePage.vue src/components/ProfileView.vue
git commit -m "feat: home activity banner with invoice-sheet deep link

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Fiat on history rows

**Files:**
- Modify: `src/components/ProfileView.vue` (history list in the history ActionSheet, ~line 329)

**Interfaces:**
- Consumes: existing `rates`, `nimToFiat`, `preferredCurrency` already imported in this component.
- Produces: nothing.

- [ ] **Step 1: Add a fiat helper + row display**

In `src/components/ProfileView.vue` script, add below `netBalanceFiat`:

```ts
/** "≈ 1.23 €" at today's rate, or null when NIM-only / rates missing. */
function fiatApprox(nim: number): string | null {
  if (preferredCurrency.value === 'NIM' || !rates.value) return null
  const amount = nimToFiat(nim, preferredCurrency.value, rates.value)
  if (amount == null) return null
  return `≈ ${amount.toLocaleString(undefined, { style: 'currency', currency: preferredCurrency.value })}`
}
```

In the history `<li>` template, inside `<span class="value">` after the NIM amount:

```html
            <span v-if="fiatApprox(h.valueNim)" class="tx-fiat">{{ fiatApprox(h.valueNim) }}</span>
```

Style (append):

```css
.tx-fiat { display: inline-block; margin-left: 6px; font-weight: 400; font-size: 12px; color: var(--text-2); }
```

- [ ] **Step 2: Verify + commit**

Run: `npm run build` — clean.
Manual: set a fiat preferred currency in an amount input, open a contact's History → rows show `≈ …`.

```bash
git add src/components/ProfileView.vue
git commit -m "feat: fiat approximation on payment history rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Insights service

**Files:**
- Create: `src/services/insights.ts`
- Test: `src/services/insights.test.ts`

**Interfaces:**
- Consumes: `fetchTransactionsByAddress`, `expandMyAddresses`, `timestampMs` from `./history`; `Profile` from `../types/profile`.
- Produces (used by Task 7):

```ts
export interface InsightTx {
  hash: string
  timestamp: number // normalized ms
  valueNim: number
  incoming: boolean
  counterparty: string // compact uppercase, no spaces
}
export interface InsightsData {
  txs: InsightTx[]
  /** ms before which history may be incomplete (a 200-tx page filled up); null = full coverage */
  coverageFrom: number | null
  fetchedAt: number
}
export interface ContactTotal {
  name: string | null   // null = unmatched ("Others")
  profileId: string | null
  sentNim: number
  receivedNim: number
}
export interface MonthInsights {
  sentNim: number
  receivedNim: number
  contacts: ContactTotal[]          // sorted by sent+received desc; "Others" entry last when present
  tags: { tag: string; sentNim: number; receivedNim: number }[]  // overlapping; 'Untagged' bucket
}
export function normalizeTxs(raw: RpcLike[], mine: Set<string>, pages?: RpcLike[][]): { txs: InsightTx[]; coverageFrom: number | null }
export async function fetchInsights(myAddresses: string[]): Promise<InsightsData>
export function monthInsights(txs: InsightTx[], profiles: Profile[], year: number, month: number): MonthInsights
```

- [ ] **Step 1: Write the failing tests**

Create `src/services/insights.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeTxs, monthInsights, type InsightTx } from './insights'
import type { Profile } from '../types/profile'

const ME = 'NQ070000000000000000000000000000000000'
const ME2 = 'NQ990000000000000000000000000000000000'
const ALICE = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
const BOB = 'NQ48 8CKH BA24 2VR3 N249 N8MN J5XX 74DB 5XJ8'
const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

const JULY = new Date(2026, 6, 15).getTime()

function rpcTx(overrides: Record<string, unknown>) {
  return { hash: Math.random().toString(36), from: ALICE, to: ME, value: 1e5, timestamp: JULY, fromType: 0, ...overrides }
}

function profile(overrides: Partial<Profile>): Profile {
  return {
    id: Math.random().toString(36), address: ALICE, name: 'Alice', type: 'person',
    isSelf: false, notes: '', tags: [], favorite: false, createdAt: 0, updatedAt: 0,
    ...overrides,
  }
}

describe('normalizeTxs', () => {
  const mine = new Set([compact(ME), compact(ME2)])

  it('dedupes by hash, excludes self-transfers and swap contracts, sets direction and counterparty', () => {
    const dup = rpcTx({})
    const { txs } = normalizeTxs([
      dup, dup,
      rpcTx({ from: ME, to: ME2 }),            // self-transfer
      rpcTx({ fromType: 2 }),                  // swap payout
      rpcTx({ from: ME, to: BOB, value: 3e5 }) // outgoing
    ], mine)
    expect(txs).toHaveLength(2)
    const incoming = txs.find(t => t.incoming)!
    expect(incoming.counterparty).toBe(compact(ALICE))
    const outgoing = txs.find(t => !t.incoming)!
    expect(outgoing.counterparty).toBe(compact(BOB))
    expect(outgoing.valueNim).toBe(3)
  })

  it('normalizes seconds timestamps to ms', () => {
    const { txs } = normalizeTxs([rpcTx({ timestamp: Math.floor(JULY / 1000) })], mine)
    expect(txs[0].timestamp).toBe(Math.floor(JULY / 1000) * 1000)
  })

  it('reports a coverage boundary only when a 200-tx page is full', () => {
    const few = normalizeTxs([rpcTx({})], mine, [[rpcTx({})]])
    expect(few.coverageFrom).toBeNull()
    const fullPage = Array.from({ length: 200 }, (_, i) => rpcTx({ timestamp: JULY - i * 1000 }))
    const capped = normalizeTxs(fullPage, mine, [fullPage])
    expect(capped.coverageFrom).toBe(JULY - 199_000)
  })
})

describe('monthInsights', () => {
  const tx = (over: Partial<InsightTx>): InsightTx => ({
    hash: Math.random().toString(36), timestamp: JULY, valueNim: 1, incoming: true,
    counterparty: compact(ALICE), ...over,
  })

  it('sums sent/received inside the month only', () => {
    const out = monthInsights([
      tx({ valueNim: 5 }),
      tx({ valueNim: 2, incoming: false }),
      tx({ valueNim: 100, timestamp: new Date(2026, 5, 30).getTime() }), // June
      tx({ valueNim: 100, timestamp: new Date(2026, 7, 1).getTime() }),  // August
    ], [], 2026, 6)
    expect(out.receivedNim).toBe(5)
    expect(out.sentNim).toBe(2)
  })

  it('groups by matched contact, lumps unmatched into an Others row (name null)', () => {
    const alice = profile({ address: ALICE, name: 'Alice' })
    const out = monthInsights([
      tx({ valueNim: 5 }),
      tx({ valueNim: 3, counterparty: compact(BOB) }),
    ], [alice], 2026, 6)
    expect(out.contacts).toHaveLength(2)
    expect(out.contacts[0]).toMatchObject({ name: 'Alice', receivedNim: 5 })
    expect(out.contacts[1]).toMatchObject({ name: null, receivedNim: 3 })
  })

  it('counts a multi-tagged contact fully under each tag; untagged under Untagged', () => {
    const alice = profile({ address: ALICE, name: 'Alice', tags: ['friends', 'work'] })
    const bob = profile({ address: BOB, name: 'Bob', tags: [] })
    const out = monthInsights([
      tx({ valueNim: 5 }),
      tx({ valueNim: 3, counterparty: compact(BOB), incoming: false }),
    ], [alice, bob], 2026, 6)
    const byTag = Object.fromEntries(out.tags.map(t => [t.tag, t]))
    expect(byTag.friends.receivedNim).toBe(5)
    expect(byTag.work.receivedNim).toBe(5)
    expect(byTag.Untagged.sentNim).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/insights.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/services/insights.ts`:

```ts
import { expandMyAddresses, fetchTransactionsByAddress, timestampMs } from './history'
import type { Profile } from '../types/profile'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
const CACHE_PREFIX = 'nimconnect:insights-txs:'
const PAGE_MAX = 200

export interface InsightTx {
  hash: string
  /** normalized ms */
  timestamp: number
  valueNim: number
  incoming: boolean
  /** compact uppercase address of the other side */
  counterparty: string
}

export interface InsightsData {
  txs: InsightTx[]
  /** ms before which history may be incomplete (a page hit the 200-tx cap); null = full coverage */
  coverageFrom: number | null
  fetchedAt: number
}

interface RpcLike {
  hash: string
  from: string
  to: string
  value: number
  timestamp: number
  fromType?: number
}

/** Dedupe, drop self-transfers and swap-contract payouts, normalize direction/timestamps.
 * `pages` (per-address result pages) determines the coverage boundary; defaults to one page. */
export function normalizeTxs(
  raw: RpcLike[],
  mine: Set<string>,
  pages: RpcLike[][] = [raw],
): { txs: InsightTx[]; coverageFrom: number | null } {
  let coverageFrom: number | null = null
  for (const page of pages) {
    if (page.length >= PAGE_MAX) {
      const oldest = Math.min(...page.map(t => timestampMs(t.timestamp)))
      coverageFrom = Math.max(coverageFrom ?? 0, oldest)
    }
  }
  const txs: InsightTx[] = []
  for (const tx of new Map(raw.map(t => [t.hash, t])).values()) {
    const from = compact(tx.from)
    const to = compact(tx.to)
    const incoming = mine.has(to) && !mine.has(from)
    const outgoing = mine.has(from) && !mine.has(to)
    if (!incoming && !outgoing) continue // self-transfer or unrelated
    // ponytail: swap payouts report balance snapshots, not amounts — exclude rather than model
    if (incoming && tx.fromType === 2) continue
    txs.push({
      hash: tx.hash,
      timestamp: timestampMs(tx.timestamp),
      valueNim: tx.value / 1e5,
      incoming,
      counterparty: incoming ? from : to,
    })
  }
  return { txs, coverageFrom }
}

/** Both-direction history for all own addresses, cached per wallet identity for offline use. */
export async function fetchInsights(myAddresses: string[]): Promise<InsightsData> {
  const mine = await expandMyAddresses(myAddresses)
  const mineSet = new Set(mine.map(compact))
  const key = CACHE_PREFIX + [...mineSet].sort().join('+')
  try {
    const pages = await Promise.all(mine.map(a => fetchTransactionsByAddress(a, PAGE_MAX)))
    const { txs, coverageFrom } = normalizeTxs(pages.flat(), mineSet, pages)
    const data: InsightsData = { txs, coverageFrom, fetchedAt: Date.now() }
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(data))
    } catch { /* best-effort */ }
    return data
  } catch (e) {
    const raw = globalThis.localStorage?.getItem(key)
    if (raw) return JSON.parse(raw) as InsightsData
    throw e
  }
}

export interface ContactTotal {
  /** null = unmatched addresses lumped together ("Others") */
  name: string | null
  profileId: string | null
  sentNim: number
  receivedNim: number
}

export interface MonthInsights {
  sentNim: number
  receivedNim: number
  /** sorted by volume desc; the unmatched "Others" row (name null) sorts last */
  contacts: ContactTotal[]
  /** overlapping by design: multi-tagged contacts count under each tag */
  tags: { tag: string; sentNim: number; receivedNim: number }[]
}

export function monthInsights(txs: InsightTx[], profiles: Profile[], year: number, month: number): MonthInsights {
  const start = new Date(year, month, 1).getTime()
  const end = new Date(year, month + 1, 1).getTime()
  const byAddress = new Map(profiles.map(p => [compact(p.address), p]))

  let sentNim = 0
  let receivedNim = 0
  const perContact = new Map<string, ContactTotal>() // key: profile id or '' for Others
  const perTag = new Map<string, { tag: string; sentNim: number; receivedNim: number }>()

  for (const tx of txs) {
    if (tx.timestamp < start || tx.timestamp >= end) continue
    if (tx.incoming) receivedNim += tx.valueNim
    else sentNim += tx.valueNim

    const profile = byAddress.get(tx.counterparty)
    const key = profile?.id ?? ''
    const entry = perContact.get(key)
      ?? { name: profile?.name ?? null, profileId: profile?.id ?? null, sentNim: 0, receivedNim: 0 }
    if (tx.incoming) entry.receivedNim += tx.valueNim
    else entry.sentNim += tx.valueNim
    perContact.set(key, entry)

    const tags = profile ? (profile.tags.length ? profile.tags : ['Untagged']) : []
    for (const tag of tags) {
      const t = perTag.get(tag) ?? { tag, sentNim: 0, receivedNim: 0 }
      if (tx.incoming) t.receivedNim += tx.valueNim
      else t.sentNim += tx.valueNim
      perTag.set(tag, t)
    }
  }

  const volume = (c: ContactTotal) => c.sentNim + c.receivedNim
  const contacts = [...perContact.values()].sort((a, b) => {
    if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1
    return volume(b) - volume(a)
  })
  const tags = [...perTag.values()].sort((a, b) => (b.sentNim + b.receivedNim) - (a.sentNim + a.receivedNim))

  return { sentNim, receivedNim, contacts, tags }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/insights.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/insights.ts src/services/insights.test.ts
git commit -m "feat: insights service — cross-contact monthly aggregation with coverage bound

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Insights page + route + nav

**Files:**
- Create: `src/pages/InsightsPage.vue`
- Modify: `src/router.ts` (add route)
- Modify: `src/App.vue:197-213` (nav entry)

**Interfaces:**
- Consumes: `fetchInsights`, `monthInsights`, `InsightsData` from Task 6; `resolveMyAddresses` from `../services/nimiq`; `useProfilesStore`; `getRates`/`nimToFiat`/`preferredCurrency`; `shortAddress` from `../services/links`.
- Produces: route `/insights`.

- [ ] **Step 1: Route + nav**

In `src/router.ts`, add before the catch-all:

```ts
    { path: '/insights', component: () => import('./pages/InsightsPage.vue') },
```

In `src/App.vue`, add a nav item between Split and Profile:

```html
      <router-link to="/insights" class="nav-item" :class="{ active: $route.path === '/insights' }">
        <span class="nav-icon">📊</span><span>Insights</span>
      </router-link>
```

- [ ] **Step 2: Page**

Create `src/pages/InsightsPage.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useProfilesStore } from '../stores/profiles'
import { fetchInsights, monthInsights, type InsightsData } from '../services/insights'
import { resolveMyAddresses } from '../services/nimiq'
import { getRates, nimToFiat, type NimRates } from '../services/rates'
import { preferredCurrency } from '../services/prefs'
import { shortAddress } from '../services/links'
import EmptyState from '../components/EmptyState.vue'

const profilesStore = useProfilesStore()
const data = ref<InsightsData | null>(null)
const error = ref(false)
const rates = ref<NimRates | null>(null)

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth())

onMounted(async () => {
  await profilesStore.load()
  getRates().then(r => (rates.value = r))
  if (!profilesStore.self) return
  try {
    data.value = await fetchInsights(await resolveMyAddresses(profilesStore.self.address))
  } catch {
    error.value = true
  }
})

const stats = computed(() =>
  data.value ? monthInsights(data.value.txs, profilesStore.profiles, year.value, month.value) : null,
)

const monthLabel = computed(() =>
  new Date(year.value, month.value, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
)

const isCurrentMonth = computed(() =>
  year.value === now.getFullYear() && month.value === now.getMonth(),
)

/** Months before the coverage boundary would show silently incomplete data — block them. */
const atCoverageFloor = computed(() => {
  if (!data.value?.coverageFrom) return false
  const prevMonthEnd = new Date(year.value, month.value, 1).getTime()
  return prevMonthEnd <= data.value.coverageFrom
})

const coverageNote = computed(() => {
  if (!data.value?.coverageFrom) return null
  return `History before ${new Date(data.value.coverageFrom).toLocaleDateString()} is not available.`
})

function shift(delta: number) {
  const d = new Date(year.value, month.value + delta, 1)
  year.value = d.getFullYear()
  month.value = d.getMonth()
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

function fiatApprox(nim: number): string | null {
  if (preferredCurrency.value === 'NIM' || !rates.value || !nim) return null
  const amount = nimToFiat(nim, preferredCurrency.value, rates.value)
  if (amount == null) return null
  return `≈ ${amount.toLocaleString(undefined, { style: 'currency', currency: preferredCurrency.value })}`
}

const maxTagVolume = computed(() =>
  Math.max(1, ...(stats.value?.tags.map(t => t.sentNim + t.receivedNim) ?? [])),
)

function contactLabel(c: { name: string | null }): string {
  return c.name ?? 'Others (unknown addresses)'
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Insights</h1>
      <p>Where your NIM goes, by contact and tag.</p>
    </header>

    <p v-if="!profilesStore.self" class="hint">Connect inside Nimiq Pay to see your spending insights.</p>
    <p v-else-if="error" class="hint">Insights are unavailable right now.</p>
    <p v-else-if="!stats" class="hint">Loading…</p>

    <template v-else>
      <div class="month-nav">
        <button type="button" class="month-btn" :disabled="atCoverageFloor" @click="shift(-1)">‹</button>
        <span class="month-label">{{ monthLabel }}</span>
        <button type="button" class="month-btn" :disabled="isCurrentMonth" @click="shift(1)">›</button>
      </div>

      <div class="totals">
        <div class="total-card out">
          <span class="total-value">−{{ fmt(stats.sentNim) }}</span>
          <span class="total-label">NIM sent</span>
          <span v-if="fiatApprox(stats.sentNim)" class="total-fiat">{{ fiatApprox(stats.sentNim) }}</span>
        </div>
        <div class="total-card in">
          <span class="total-value">+{{ fmt(stats.receivedNim) }}</span>
          <span class="total-label">NIM received</span>
          <span v-if="fiatApprox(stats.receivedNim)" class="total-fiat">{{ fiatApprox(stats.receivedNim) }}</span>
        </div>
      </div>

      <EmptyState
        v-if="!stats.contacts.length"
        icon="📊"
        title="No activity this month"
        hint="Payments you send and receive show up here."
      />

      <template v-else>
        <section class="section">
          <h2>Top contacts</h2>
          <ul class="rows">
            <li v-for="c in stats.contacts.slice(0, 5)" :key="c.profileId ?? 'others'" class="row">
              <router-link v-if="c.profileId" :to="`/profile/${c.profileId}`" class="row-name">{{ contactLabel(c) }}</router-link>
              <span v-else class="row-name plain">{{ contactLabel(c) }}</span>
              <span class="row-amounts">
                <span v-if="c.sentNim" class="out">−{{ fmt(c.sentNim) }}</span>
                <span v-if="c.receivedNim" class="in">+{{ fmt(c.receivedNim) }}</span>
              </span>
            </li>
          </ul>
        </section>

        <section v-if="stats.tags.length" class="section">
          <h2>By tag</h2>
          <p class="tag-note">Contacts with several tags count under each — bars overlap.</p>
          <ul class="rows">
            <li v-for="t in stats.tags" :key="t.tag" class="tag-row">
              <span class="row-name plain">{{ t.tag }}</span>
              <span class="row-amounts">
                <span v-if="t.sentNim" class="out">−{{ fmt(t.sentNim) }}</span>
                <span v-if="t.receivedNim" class="in">+{{ fmt(t.receivedNim) }}</span>
              </span>
              <span class="tag-bar"><span class="tag-fill" :style="{ width: `${((t.sentNim + t.receivedNim) / maxTagVolume) * 100}%` }" /></span>
            </li>
          </ul>
        </section>
      </template>

      <p v-if="coverageNote" class="hint coverage">{{ coverageNote }}</p>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 88px; max-width: 100%; }
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 4px; }
.header p { margin: 0 0 14px; color: var(--text-2); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; margin: 24px 0; }
.hint.coverage { font-size: 12px; margin: 16px 0 0; }
.month-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.month-label { font-weight: 800; font-size: 15px; }
.month-btn {
  min-width: 44px; min-height: 44px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill);
  background: var(--card); color: var(--nq-light-blue); font-size: 18px; cursor: pointer;
}
.month-btn:disabled { opacity: 0.4; cursor: default; }
.totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.total-card {
  padding: 14px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--card); box-shadow: var(--shadow);
}
.total-value { display: block; font-size: 22px; font-weight: 700; }
.total-card.out .total-value { color: var(--nq-gold-dark); }
.total-card.in .total-value { color: var(--nq-green); }
.total-label { display: block; margin-top: 4px; color: var(--text-2); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.total-fiat { display: block; margin-top: 2px; font-size: 12px; font-weight: 600; color: var(--text-2); }
.section { margin-top: 18px; }
.section h2 { margin: 0 0 8px; font-size: 13px; font-weight: 700; color: var(--text-2); text-transform: uppercase; }
.tag-note { margin: 0 0 8px; font-size: 12px; color: var(--text-2); }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.row, .tag-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
.row-name { flex: 1; min-width: 0; font-weight: 700; color: var(--nq-light-blue); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-name.plain { color: var(--text); }
.row-amounts { display: flex; gap: 10px; font-weight: 700; font-size: 13px; }
.row-amounts .out { color: var(--nq-gold-dark); }
.row-amounts .in { color: var(--nq-green); }
.tag-bar { flex-basis: 100%; height: 6px; border-radius: 3px; background: var(--text-6); overflow: hidden; }
.tag-fill { display: block; height: 100%; border-radius: 3px; background: var(--nimiq-gold-bg); }
</style>
```

Note: `profilesStore.profiles` is exported by the store (`src/stores/profiles.ts:327`); self-transfers are already excluded at the tx level, so including the self profile is harmless.

- [ ] **Step 3: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS, clean build.
Manual: `npm run dev` → nav shows 📊 Insights → page loads totals for the current month, prev-month navigation stops at the coverage floor when the wallet has >200 txs.

- [ ] **Step 4: Commit**

```bash
git add src/pages/InsightsPage.vue src/router.ts src/App.vue
git commit -m "feat: insights page — monthly totals, top contacts, tag bars

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification

- [ ] **Step 1: Full test suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS, `vue-tsc` clean, vite build succeeds.

- [ ] **Step 2: Drive the app end-to-end**

`npm run dev`, then verify each feature against the spec:
1. Fresh Home shows no banner; after creating an invoice due today the banner appears; tapping the entry opens the contact with the invoice sheet; dismissing hides it for the session.
2. Monthly repeating invoice → Mark paid → successor appears, due one month later (check a month-end date manually via devtools if convenient).
3. Contact → History → rows show `≈ …` fiat when a fiat currency is preferred, hidden when NIM.
4. Insights nav entry → totals, top contacts, tag bars; month navigation works.

- [ ] **Step 3: Fix anything found, re-run, commit fixes individually**
