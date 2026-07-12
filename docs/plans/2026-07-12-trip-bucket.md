# Trip Bucket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shared savings goal ("trip bucket"): organizer creates a bucket with name + NIM goal, shares a tagged pay link/QR, and contributions are auto-detected from incoming payments carrying the tag.

**Architecture:** Buckets are a new Dexie table + Pinia store mirroring invoices. Contributions are a persisted ledger on each bucket (`source: 'chain' | 'manual'`), appended by matching tagged incoming payments (deduped by tx hash) so entries survive the 100-tx history fetch window. One `BucketSheet.vue` (create + detail) and a Home page section. No new route. Spec: `docs/2026-07-12-trip-bucket-design.md`.

**Tech Stack:** Vue 3 + `<script setup>`, Pinia setup stores, Dexie (IndexedDB), Vitest (colocated `*.test.ts`, fake-indexeddb), `@nimiq/utils` request links.

## Global Constraints

- Payment message limit is **64 bytes** (`MESSAGE_MAX_BYTES` in `src/services/nimiq.ts:185`).
- Bucket payment message format: `🪣 <name> #<short-id>` where `<short-id>` = first 8 chars of the bucket uuid with hyphens removed.
- QR codes encode `makeRequestLink()` (native `nimiq:` URI); messenger share URLs use `makePaymentShareLink()` — per the contract comment at `src/services/links.ts:171`.
- Every store mutation that persists data calls `notifyDataChanged()` (cloud backup dirty flag).
- Dexie schema changes are new `this.version(n).stores(...)` migrations — never edit an existing version block (`src/db/db.ts:12`).
- Run all tests with `npm run test`; a single file with `npx vitest run <path>`.

---

### Task 1: Bucket types, Dexie v4 migration, buckets store

**Files:**
- Modify: `src/types/profile.ts` (after the `Invoice` interface, line 42)
- Modify: `src/db/db.ts`
- Create: `src/stores/buckets.ts`
- Test: `src/stores/buckets.test.ts`

**Interfaces:**
- Consumes: `db` from `../db/db`, `uuid()` from `../utils/uuid`, `notifyDataChanged()` from `../services/cloud-backup`, `timestampMs` + `IncomingPayment` from `../services/history`.
- Produces (later tasks rely on these exact names):
  - Types `Bucket`, `BucketContribution` in `src/types/profile.ts`
  - `useBucketsStore()` with: `buckets: Ref<Bucket[]>`, `loaded`, `active`, `completed` (computeds), `load()`, `reload()`, `create(input: { name: string; goalNim: number; fiatGoal?: number; fiatCurrency?: string }): Promise<Bucket>`, `setStatus(id: string, status: 'active' | 'completed')`, `remove(id: string)`, `addManualContribution(id: string, input: { amountNim: number; note?: string; sender?: string })`, `recordChainContributions(payments: IncomingPayment[]): Promise<number>`, `importMany(items: Bucket[]): Promise<number>`
  - Pure exports from `src/stores/buckets.ts`: `bucketTag(b: Pick<Bucket, 'id'>): string`, `bucketMessage(b: Pick<Bucket, 'id' | 'name'>): string`, `matchContributions(bucket: Bucket, payments: IncomingPayment[]): IncomingPayment[]`, `bucketTotalNim(bucket: Bucket): number`

- [ ] **Step 1: Add types to `src/types/profile.ts`**

Insert after the `Invoice` interface (line 42), before `ExportDocument`:

```ts
export type BucketStatus = 'active' | 'completed'

/** One entry in a bucket's contribution ledger — persisted, never recomputed from history. */
export interface BucketContribution {
  id: string
  /** 'chain' = auto-detected tagged payment; 'manual' = organizer adjustment, never deduped */
  source: 'chain' | 'manual'
  amountNim: number
  /** Normalized NQ sender address when known */
  sender?: string
  /** Set for source 'chain' — dedupe key against re-detection */
  txHash?: string
  /** Manual entries: free-text label / contact name */
  note?: string
  at: number
}

/** Shared savings goal. Funds land in the organizer's own wallet; contributions are
 * identified by a tag in the payment message, not by address balance. */
export interface Bucket {
  id: string
  name: string
  goalNim: number
  /** Original fiat entry when the goal was priced in fiat (converted to NIM at creation) */
  fiatGoal?: number
  fiatCurrency?: string
  status: BucketStatus
  createdAt: number
  completedAt?: number
  contributions: BucketContribution[]
}
```

- [ ] **Step 2: Add Dexie v4 migration in `src/db/db.ts`**

Add `Bucket` to the type import, a table declaration, and a **new** version block (do not touch v1–v3):

```ts
import type { Invoice, Profile, InboxItem, KvEntry, Bucket } from '../types/profile'
```

Inside the class, after `kv!: Table<KvEntry, string>`:

```ts
  buckets!: Table<Bucket, string>
```

After the `this.version(3)` block:

```ts
    this.version(4).stores({
      profiles: 'id, &address',
      invoices: 'id, address, status',
      inboxItems: 'id, objectId, sender, status',
      kv: 'key',
      buckets: 'id, status',
    })
```

- [ ] **Step 3: Write the failing tests**

Create `src/stores/buckets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import {
  useBucketsStore, bucketTag, bucketMessage, matchContributions, bucketTotalNim,
} from './buckets'
import type { Bucket } from '../types/profile'
import type { IncomingPayment } from '../services/history'

const SENDER = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

function payment(overrides: Partial<IncomingPayment> = {}): IncomingPayment {
  return {
    hash: `hash-${Math.random()}`,
    timestamp: Math.floor(Date.now() / 1000),
    valueNim: 10,
    sender: SENDER,
    ...overrides,
  }
}

describe('bucket tag and message', () => {
  const bucket = { id: 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff', name: 'Barcelona 2026' }

  it('derives a stable short tag from the id', () => {
    expect(bucketTag(bucket)).toBe('#a1b2c3d4')
  })

  it('builds the payment message with emoji, name and tag', () => {
    expect(bucketMessage(bucket)).toBe('🪣 Barcelona 2026 #a1b2c3d4')
  })

  it('trims long names so the message fits the 64-byte tx limit', () => {
    const long = { ...bucket, name: 'A very long trip name that would overflow the transaction message limit' }
    const msg = bucketMessage(long)
    expect(new TextEncoder().encode(msg).length).toBeLessThanOrEqual(64)
    expect(msg.endsWith('#a1b2c3d4')).toBe(true)
    expect(msg.startsWith('🪣 A very long')).toBe(true)
  })
})

describe('matchContributions', () => {
  const bucket: Bucket = {
    id: 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff',
    name: 'Barcelona',
    goalNim: 100,
    status: 'active',
    createdAt: Date.now(),
    contributions: [],
  }

  it('matches payments whose message contains the tag', () => {
    const hit = payment({ message: '🪣 Barcelona #a1b2c3d4' })
    const miss = payment({ message: 'lunch money' })
    const noMsg = payment()
    expect(matchContributions(bucket, [hit, miss, noMsg])).toEqual([hit])
  })

  it('skips tx hashes already in the ledger and duplicate hashes in one batch', () => {
    const recorded = payment({ hash: 'known', message: '🪣 x #a1b2c3d4' })
    const fresh = payment({ hash: 'fresh', message: '🪣 x #a1b2c3d4' })
    const withLedger: Bucket = {
      ...bucket,
      contributions: [{ id: 'c1', source: 'chain', amountNim: 5, txHash: 'known', at: 1 }],
    }
    expect(matchContributions(withLedger, [recorded, fresh, fresh])).toEqual([fresh])
  })
})

describe('buckets store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.buckets.clear()
  })

  it('creates active buckets and rejects invalid input', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: ' Barcelona ', goalNim: 100 })
    expect(b.name).toBe('Barcelona')
    expect(b.status).toBe('active')
    expect(b.contributions).toEqual([])
    expect(store.active).toHaveLength(1)
    await expect(store.create({ name: 'x', goalNim: 0 })).rejects.toThrow('invalid-goal')
    await expect(store.create({ name: '  ', goalNim: 1 })).rejects.toThrow('invalid-name')
  })

  it('marks complete with completedAt and back to active without it', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: 'Trip', goalNim: 10 })
    await store.setStatus(b.id, 'completed')
    expect(store.completed[0].completedAt).toBeGreaterThan(0)
    await store.setStatus(b.id, 'active')
    expect(store.active[0].completedAt).toBeUndefined()
  })

  it('adds manual contributions and sums the total', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: 'Trip', goalNim: 100 })
    await store.addManualContribution(b.id, { amountNim: 25, note: 'Cash from Ana' })
    await store.addManualContribution(b.id, { amountNim: 10 })
    const updated = store.buckets.find(x => x.id === b.id)!
    expect(updated.contributions).toHaveLength(2)
    expect(updated.contributions[0].source).toBe('manual')
    expect(bucketTotalNim(updated)).toBe(35)
    await expect(store.addManualContribution(b.id, { amountNim: -1 })).rejects.toThrow('invalid-amount')
  })

  it('records tagged chain payments once, only for active buckets', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: 'Trip', goalNim: 100 })
    const tag = bucketTag(b)
    const p = payment({ hash: 'tx1', message: `🪣 Trip ${tag}`, valueNim: 40 })
    expect(await store.recordChainContributions([p])).toBe(1)
    expect(await store.recordChainContributions([p])).toBe(0) // idempotent
    const updated = store.buckets.find(x => x.id === b.id)!
    expect(updated.contributions).toEqual([expect.objectContaining({
      source: 'chain', amountNim: 40, txHash: 'tx1', sender: SENDER,
    })])
    await store.setStatus(b.id, 'completed')
    const p2 = payment({ hash: 'tx2', message: `🪣 Trip ${tag}` })
    expect(await store.recordChainContributions([p2])).toBe(0)
  })

  it('imports buckets, skipping duplicates and invalid entries', async () => {
    const store = useBucketsStore()
    await store.load()
    const existing = await store.create({ name: 'Trip', goalNim: 10 })
    const items = [
      existing, // duplicate id — skipped
      { id: 'new-1', name: 'Rome', goalNim: 50, status: 'active', createdAt: 1, contributions: [] },
      { id: 'bad-1', name: 'Broken', goalNim: 0, status: 'active', createdAt: 1, contributions: [] },
    ] as Bucket[]
    expect(await store.importMany(items)).toBe(1)
    expect(store.buckets).toHaveLength(2)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/stores/buckets.test.ts`
Expected: FAIL — `Cannot find module './buckets'` (or equivalent resolve error).

- [ ] **Step 5: Implement `src/stores/buckets.ts`**

```ts
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '../db/db'
import type { Bucket, BucketContribution } from '../types/profile'
import { uuid } from '../utils/uuid'
import { notifyDataChanged } from '../services/cloud-backup'
import { timestampMs, type IncomingPayment } from '../services/history'

/** Wallet tx message limit — keep in sync with MESSAGE_MAX_BYTES in services/nimiq. */
const MESSAGE_MAX_BYTES = 64
const byteLength = (s: string) => new TextEncoder().encode(s).length

/** Stable short tag embedded in payment messages: '#' + first 8 chars of the uuid. */
export function bucketTag(bucket: Pick<Bucket, 'id'>): string {
  return `#${bucket.id.replace(/-/g, '').slice(0, 8)}`
}

/** Payment message for share link/QR: "🪣 <name> <tag>", name trimmed to the 64-byte limit. */
export function bucketMessage(bucket: Pick<Bucket, 'id' | 'name'>): string {
  const tag = bucketTag(bucket)
  let name = bucket.name.trim()
  while (name && byteLength(`🪣 ${name} ${tag}`) > MESSAGE_MAX_BYTES) {
    name = name.slice(0, -1).trimEnd()
  }
  return name ? `🪣 ${name} ${tag}` : `🪣 ${tag}`
}

/** Incoming payments carrying the bucket tag that aren't in the ledger yet. */
export function matchContributions(bucket: Bucket, payments: IncomingPayment[]): IncomingPayment[] {
  const tag = bucketTag(bucket)
  const known = new Set(bucket.contributions.map(c => c.txHash).filter(Boolean))
  const seen = new Set<string>()
  return payments.filter((p) => {
    if (!p.message?.includes(tag) || known.has(p.hash) || seen.has(p.hash)) return false
    seen.add(p.hash)
    return true
  })
}

export function bucketTotalNim(bucket: Bucket): number {
  return bucket.contributions.reduce((sum, c) => sum + c.amountNim, 0)
}

export const useBucketsStore = defineStore('buckets', () => {
  const buckets = ref<Bucket[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    buckets.value = await db.buckets.toArray()
    loaded.value = true
  }

  async function reload() {
    buckets.value = await db.buckets.toArray()
    loaded.value = true
  }

  const active = computed(() =>
    buckets.value.filter(b => b.status === 'active').sort((a, b) => b.createdAt - a.createdAt),
  )
  const completed = computed(() =>
    buckets.value
      .filter(b => b.status === 'completed')
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)),
  )

  async function persist(updated: Bucket) {
    await db.buckets.put(JSON.parse(JSON.stringify(updated)))
    buckets.value = buckets.value.map(b => (b.id === updated.id ? updated : b))
    notifyDataChanged()
  }

  async function create(input: {
    name: string
    goalNim: number
    fiatGoal?: number
    fiatCurrency?: string
  }): Promise<Bucket> {
    if (!(input.goalNim > 0)) throw new Error('invalid-goal')
    const name = input.name.trim()
    if (!name) throw new Error('invalid-name')
    const bucket: Bucket = {
      id: uuid(),
      name,
      goalNim: input.goalNim,
      status: 'active',
      createdAt: Date.now(),
      contributions: [],
      ...(input.fiatGoal && input.fiatCurrency
        ? { fiatGoal: input.fiatGoal, fiatCurrency: input.fiatCurrency }
        : {}),
    }
    await db.buckets.add(bucket)
    buckets.value.push(bucket)
    notifyDataChanged()
    return bucket
  }

  async function setStatus(id: string, status: Bucket['status']) {
    const existing = buckets.value.find(b => b.id === id)
    if (!existing) return
    await persist({
      ...existing,
      status,
      ...(status === 'completed' ? { completedAt: Date.now() } : { completedAt: undefined }),
    })
  }

  async function remove(id: string) {
    await db.buckets.delete(id)
    buckets.value = buckets.value.filter(b => b.id !== id)
    notifyDataChanged()
  }

  async function addManualContribution(
    id: string,
    input: { amountNim: number; note?: string; sender?: string },
  ) {
    if (!(input.amountNim > 0)) throw new Error('invalid-amount')
    const bucket = buckets.value.find(b => b.id === id)
    if (!bucket) return
    const contribution: BucketContribution = {
      id: uuid(),
      source: 'manual',
      amountNim: input.amountNim,
      at: Date.now(),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(input.sender ? { sender: input.sender } : {}),
    }
    await persist({ ...bucket, contributions: [...bucket.contributions, contribution] })
  }

  /** Append newly seen tagged payments to each active bucket's ledger. Returns count added. */
  async function recordChainContributions(payments: IncomingPayment[]): Promise<number> {
    let added = 0
    for (const bucket of buckets.value.filter(b => b.status === 'active')) {
      const matches = matchContributions(bucket, payments)
      if (!matches.length) continue
      const entries: BucketContribution[] = matches.map(p => ({
        id: uuid(),
        source: 'chain',
        amountNim: p.valueNim,
        sender: p.sender,
        txHash: p.hash,
        at: timestampMs(p.timestamp),
      }))
      await persist({ ...bucket, contributions: [...bucket.contributions, ...entries] })
      added += entries.length
    }
    return added
  }

  /** Merge imported buckets, skipping ids already present. Returns count added. */
  async function importMany(items: Bucket[]): Promise<number> {
    let added = 0
    for (const raw of items) {
      if (!raw || typeof raw !== 'object' || !raw.id || !String(raw.name ?? '').trim() || !(raw.goalNim > 0)) continue
      if (buckets.value.some(b => b.id === raw.id)) continue
      const bucket: Bucket = {
        id: String(raw.id),
        name: String(raw.name).trim(),
        goalNim: Number(raw.goalNim),
        status: raw.status === 'completed' ? 'completed' : 'active',
        createdAt: Number(raw.createdAt) || Date.now(),
        contributions: Array.isArray(raw.contributions)
          ? raw.contributions
              .filter(c => c && c.amountNim > 0)
              .map(c => ({
                id: String(c.id ?? uuid()),
                source: c.source === 'chain' ? 'chain' as const : 'manual' as const,
                amountNim: Number(c.amountNim),
                at: Number(c.at) || Date.now(),
                ...(c.sender ? { sender: String(c.sender) } : {}),
                ...(c.txHash ? { txHash: String(c.txHash) } : {}),
                ...(c.note ? { note: String(c.note) } : {}),
              }))
          : [],
        ...(raw.completedAt ? { completedAt: Number(raw.completedAt) } : {}),
        ...(raw.fiatGoal && raw.fiatCurrency
          ? { fiatGoal: Number(raw.fiatGoal), fiatCurrency: String(raw.fiatCurrency) }
          : {}),
      }
      await db.buckets.add(bucket)
      buckets.value.push(bucket)
      added++
    }
    if (added) notifyDataChanged()
    return added
  }

  return {
    buckets, loaded, active, completed,
    load, reload, create, setStatus, remove,
    addManualContribution, recordChainContributions, importMany,
  }
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/stores/buckets.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Run the full suite and commit**

Run: `npm run test` — expected: PASS, no regressions.

```bash
git add src/types/profile.ts src/db/db.ts src/stores/buckets.ts src/stores/buckets.test.ts
git commit -m "feat: bucket store with tagged contribution ledger and Dexie v4 migration"
```

---

### Task 2: Scan support — `bucket` request type + ScanSheet copy

**Files:**
- Modify: `src/services/links.ts:123` (`ScanRequestType`), `src/services/links.ts:150-154` (`classifyScan` type detection)
- Modify: `src/components/ScanSheet.vue:32-40` (title switch)
- Test: `src/services/links.test.ts` (append)

**Interfaces:**
- Consumes: `bucketMessage()` from Task 1 (test only).
- Produces: `ScanRequestType` union gains `'bucket'`; `classifyScan()` returns `requestType: 'bucket'` for messages starting with `🪣`.

- [ ] **Step 1: Write the failing test**

Append to `src/services/links.test.ts`:

```ts
describe('bucket scan classification', () => {
  it('classifies a bucket payment link by its 🪣 message prefix', () => {
    const link = makeRequestLink('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF', undefined, '🪣 Barcelona #a1b2c3d4')
    const intent = classifyScan(link)
    expect(intent?.requestType).toBe('bucket')
    expect(intent?.hasAmount).toBe(false)
    expect(intent?.message).toBe('🪣 Barcelona #a1b2c3d4')
  })
})
```

Check the file's existing imports include `makeRequestLink` and `classifyScan`; extend the import from `./links` if needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/links.test.ts`
Expected: FAIL — `expected 'request' to be 'bucket'`.

- [ ] **Step 3: Implement**

In `src/services/links.ts`, change line 123:

```ts
export type ScanRequestType = 'split' | 'invoice' | 'request' | 'profile' | 'bucket'
```

In `classifyScan`, change the type-detection block (lines 150–154) to check the bucket prefix first:

```ts
  if (hasAmount || message.trim()) {
    if (message.trim().startsWith('🪣')) requestType = 'bucket'
    else if (/^split/i.test(message)) requestType = 'split'
    else if (/invoice/i.test(message)) requestType = 'invoice'
    else requestType = 'request'
  }
```

In `src/components/ScanSheet.vue`, add a case to the `title` switch (line 34):

```ts
    case 'bucket': return 'Trip bucket'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/links.ts src/services/links.test.ts src/components/ScanSheet.vue
git commit -m "feat: classify scanned bucket payment links"
```

---

### Task 3: Backup, export/import, reset, restore

**Files:**
- Modify: `src/types/profile.ts:44-51` (`ExportDocument`)
- Modify: `src/stores/profiles.ts` (`exportDocument` line 208, `resetAll` line 220, `importDocument` lines 235–312)
- Modify: `src/services/restore.ts:22` (`afterRestore`)
- Test: `src/stores/profiles-io.test.ts` (append)

**Interfaces:**
- Consumes: `useBucketsStore()` (`buckets`, `load`, `reload`, `importMany`) from Task 1.
- Produces: `ExportDocument` with `version: 1 | 2 | 3` and `buckets?: Bucket[]`; export/import/reset/restore round-trip buckets.

- [ ] **Step 1: Write the failing test**

Append to `src/stores/profiles-io.test.ts` (match the file's existing setup — pinia + db clearing in `beforeEach`; add `await db.buckets.clear()` to it):

```ts
describe('bucket export/import round trip', () => {
  it('exports version 3 with buckets and imports them back', async () => {
    const profiles = useProfilesStore()
    const buckets = useBucketsStore()
    await profiles.load()
    await buckets.load()
    await buckets.create({ name: 'Barcelona', goalNim: 100 })

    const doc = await profiles.exportDocument()
    expect(doc.version).toBe(3)
    expect(doc.buckets).toHaveLength(1)

    await profiles.resetAll()
    expect(buckets.buckets).toHaveLength(0)
    expect(await db.buckets.count()).toBe(0)

    await profiles.importDocument(JSON.parse(JSON.stringify(doc)))
    expect(buckets.buckets.map(b => b.name)).toEqual(['Barcelona'])
  })

  it('still accepts v1 and v2 documents without buckets', async () => {
    const profiles = useProfilesStore()
    await profiles.load()
    await expect(profiles.importDocument({
      app: 'NimConnect', version: 2, exportedAt: Date.now(), profiles: [],
    })).resolves.toBeTruthy()
  })
})
```

Add the needed imports at the top of the test file: `useBucketsStore` from `./buckets`, and `db` from `../db/db` if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/profiles-io.test.ts`
Expected: FAIL — `expected 2 to be 3` (export version).

- [ ] **Step 3: Implement**

`src/types/profile.ts` — replace the `ExportDocument` interface:

```ts
export interface ExportDocument {
  app: 'NimConnect'
  /** v1 exports had profiles only; v2 adds invoices; v3 adds buckets */
  version: 1 | 2 | 3
  exportedAt: number
  profiles: Profile[]
  invoices?: Invoice[]
  buckets?: Bucket[]
}
```

`src/stores/profiles.ts` — add the import:

```ts
import { useBucketsStore } from './buckets'
```

`exportDocument()` becomes:

```ts
  async function exportDocument(): Promise<ExportDocument> {
    const invoicesStore = useInvoicesStore()
    const bucketsStore = useBucketsStore()
    await invoicesStore.load()
    await bucketsStore.load()
    return {
      app: 'NimConnect',
      version: 3,
      exportedAt: Date.now(),
      profiles: JSON.parse(JSON.stringify(profiles.value)),
      invoices: JSON.parse(JSON.stringify(invoicesStore.invoices)),
      buckets: JSON.parse(JSON.stringify(bucketsStore.buckets)),
    }
  }
```

In `resetAll()`, after the invoices clearing lines:

```ts
    await db.buckets.clear()
    const bucketsStore = useBucketsStore()
    bucketsStore.buckets = []
```

In `importDocument()`: change the version check to `![1, 2, 3].includes(d.version)`, and after the `d.invoices` block add:

```ts
    if (Array.isArray(d.buckets)) {
      const bucketsStore = useBucketsStore()
      await bucketsStore.reload()
      await bucketsStore.importMany(d.buckets)
    }
```

`src/services/restore.ts` — in `afterRestore()`, add the buckets store alongside invoices/inbox:

```ts
import { useBucketsStore } from '../stores/buckets'
```

and inside the function:

```ts
  const buckets = useBucketsStore()
  await buckets.reload()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/profiles-io.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm run test` — expected: PASS (cloud-backup tests wrap `exportDocument`, so they exercise the v3 payload automatically).

```bash
git add src/types/profile.ts src/stores/profiles.ts src/services/restore.ts src/stores/profiles-io.test.ts
git commit -m "feat: include buckets in export/import, reset, and restore"
```

---

### Task 4: BucketSheet component

**Files:**
- Create: `src/components/BucketSheet.vue`

**Interfaces:**
- Consumes: `useBucketsStore`, `bucketMessage`, `bucketTotalNim` (Task 1); `makeRequestLink`, `makePaymentShareLink`, `shortAddress` from `../services/links`; `receiveAddress` from `../services/nimiq`; `shareOrCopy`, `canShare` from `../services/share`; `ActionSheet`, `QrCode`, `CurrencyAmountInput`, `Identicon` components; `useProfilesStore` for self address + contributor names.
- Produces: `<BucketSheet :open="bool" :bucket="Bucket | null" @close />` — `bucket === null` renders the create form; otherwise the detail view. Used by Task 5.

- [ ] **Step 1: Create `src/components/BucketSheet.vue`**

Follow `InvoiceSheet.vue`'s structure and styles (same class names and button styles). Complete component:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Bucket } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { useBucketsStore, bucketMessage, bucketTotalNim } from '../stores/buckets'
import { makeRequestLink, makePaymentShareLink, shortAddress } from '../services/links'
import { receiveAddress } from '../services/nimiq'
import { shareOrCopy, canShare } from '../services/share'
import ActionSheet from './ActionSheet.vue'
import QrCode from './QrCode.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'
import Identicon from './Identicon.vue'

const props = defineProps<{ open: boolean; bucket: Bucket | null }>()
const emit = defineEmits<{ close: [] }>()

const store = useProfilesStore()
const bucketsStore = useBucketsStore()

// Create form state
const name = ref('')
const goal = ref<number | null>(null)
const fiat = ref<{ amount: number; currency: string } | null>(null)
const goalInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const creating = ref(false)

// Detail state
const copied = ref(false)
const manualAmount = ref<number | null>(null)
const manualNote = ref('')
const manualInput = ref<InstanceType<typeof CurrencyAmountInput>>()

const title = computed(() => (props.bucket ? props.bucket.name : 'New trip bucket'))
const totalNim = computed(() => (props.bucket ? bucketTotalNim(props.bucket) : 0))
const progress = computed(() =>
  props.bucket ? Math.min(100, (totalNim.value / props.bucket.goalNim) * 100) : 0,
)
const contributions = computed(() =>
  props.bucket ? [...props.bucket.contributions].sort((a, b) => b.at - a.at) : [],
)

const myAddress = computed(() =>
  store.self ? (receiveAddress(store.self.address) ?? store.self.address) : null,
)
const qrLink = computed(() =>
  props.bucket && myAddress.value
    ? makeRequestLink(myAddress.value, undefined, bucketMessage(props.bucket))
    : null,
)

function contributorLabel(c: Bucket['contributions'][number]): string {
  if (c.note) return c.note
  if (c.sender) return store.getByAddress(c.sender)?.name ?? shortAddress(c.sender)
  return 'Manual entry'
}

async function create() {
  if (!goal.value || !name.value.trim()) return
  creating.value = true
  try {
    await bucketsStore.create({
      name: name.value,
      goalNim: goal.value,
      fiatGoal: fiat.value?.amount,
      fiatCurrency: fiat.value?.currency,
    })
    name.value = ''
    goal.value = null
    fiat.value = null
    goalInput.value?.reset()
    emit('close')
  } finally {
    creating.value = false
  }
}

async function share() {
  if (!props.bucket || !myAddress.value) return
  const link = makePaymentShareLink(myAddress.value, undefined, bucketMessage(props.bucket))
  const result = await shareOrCopy(link, props.bucket.name)
  if (result === 'copied') {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
}

async function addManual() {
  if (!props.bucket || !manualAmount.value) return
  await bucketsStore.addManualContribution(props.bucket.id, {
    amountNim: manualAmount.value,
    note: manualNote.value,
  })
  manualAmount.value = null
  manualNote.value = ''
  manualInput.value?.reset()
}

async function removeBucket() {
  if (!props.bucket) return
  await bucketsStore.remove(props.bucket.id)
  emit('close')
}

function close() {
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" :title="title" @close="close">
    <!-- Create mode -->
    <form v-if="!bucket" class="new-bucket" @submit.prevent="create">
      <div class="new-fields">
        <input v-model="name" maxlength="48" placeholder="Trip name, e.g. Barcelona 2026" />
        <CurrencyAmountInput
          ref="goalInput"
          placeholder="Goal amount"
          @update:model-value="goal = $event"
          @fiat="fiat = $event"
        />
      </div>
      <button type="submit" class="primary" :disabled="!goal || !name.trim() || creating">
        Create bucket
      </button>
      <p class="hint">
        Friends pay through your share link — contributions carrying the bucket tag are
        detected automatically.
      </p>
    </form>

    <!-- Detail mode -->
    <template v-else>
      <div class="progress-wrap">
        <div class="progress-numbers">
          <strong>{{ totalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</strong>
          <span> / {{ bucket.goalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM</span>
          <span v-if="bucket.fiatGoal" class="fiat-goal">(goal {{ bucket.fiatGoal }} {{ bucket.fiatCurrency }})</span>
        </div>
        <div class="progress-bar" role="progressbar" :aria-valuenow="Math.round(progress)" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill" :style="{ width: `${progress}%` }" />
        </div>
      </div>

      <p v-if="!store.self" class="hint">Connect inside Nimiq Pay first — contributions are paid to your address.</p>
      <template v-else-if="bucket.status === 'active'">
        <QrCode v-if="qrLink" :text="qrLink" :size="180" />
        <p class="pay-hint">Contributor: tap Scan in the bottom bar and scan this QR — don't edit the message.</p>
      </template>

      <div class="detail-actions">
        <button v-if="bucket.status === 'active' && store.self" type="button" class="secondary" @click="share">
          {{ copied ? 'Copied!' : canShare() ? 'Share link' : 'Copy link' }}
        </button>
        <button type="button" class="secondary" @click="bucketsStore.setStatus(bucket.id, bucket.status === 'active' ? 'completed' : 'active')">
          {{ bucket.status === 'active' ? 'Mark complete' : 'Reopen' }}
        </button>
        <button type="button" class="secondary danger" @click="removeBucket">Delete</button>
      </div>

      <form v-if="bucket.status === 'active'" class="manual-add" @submit.prevent="addManual">
        <p class="manual-label">Add a contribution manually (cash, or the payer edited the message):</p>
        <div class="new-fields">
          <CurrencyAmountInput
            ref="manualInput"
            placeholder="Amount"
            @update:model-value="manualAmount = $event"
          />
          <input v-model="manualNote" maxlength="48" placeholder="From whom? (optional)" />
        </div>
        <button type="submit" class="secondary" :disabled="!manualAmount">Add contribution</button>
      </form>

      <p v-if="contributions.length === 0" class="hint">No contributions yet — share the link to get started.</p>
      <div v-else class="list">
        <div v-for="c in contributions" :key="c.id" class="contribution">
          <Identicon v-if="c.sender" :address="c.sender" :size="32" />
          <span v-else class="manual-dot">✎</span>
          <span class="who">{{ contributorLabel(c) }}<span class="when"> · {{ new Date(c.at).toLocaleDateString() }}</span></span>
          <span class="amount">+{{ c.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM</span>
        </div>
      </div>
    </template>
  </ActionSheet>
</template>

<style scoped>
.new-bucket, .manual-add { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.manual-add { margin-top: 16px; }
.manual-label { margin: 0; font-size: 12px; font-weight: 700; color: var(--text-2); }
.new-fields { display: flex; flex-direction: column; gap: 8px; }
.new-fields input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.primary {
  height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
.progress-wrap { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.progress-numbers { font-size: 18px; }
.progress-numbers span { color: var(--text-2); }
.fiat-goal { font-size: 13px; }
.progress-bar { height: 10px; border-radius: 5px; background: var(--text-6); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 5px; background: var(--nimiq-gold-bg); transition: width 0.3s ease; }
.pay-hint { margin: 8px 0 0; font-size: 12px; color: var(--text-2); text-align: center; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
.secondary {
  min-height: 44px; padding: 0 16px; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
.secondary:disabled { opacity: 0.5; }
.secondary.danger { color: var(--nq-red); }
.list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.contribution {
  display: flex; align-items: center; gap: 10px;
  min-height: 44px; padding: 6px 12px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg);
}
.manual-dot {
  width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--text-6); color: var(--text-2);
}
.who { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { color: var(--text-2); font-weight: 400; font-size: 12px; }
.amount { font-weight: 700; color: var(--nq-green); }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
</style>
```

Note: the sheet's QR/detail area only renders when `bucket` is passed; the parent (Task 5) passes a reactive bucket from the store so contribution updates re-render live. `bucket.status === 'active' && store.self` gating mirrors InvoiceSheet's "connect first" hint.

- [ ] **Step 2: Type-check**

Run: `npx vue-tsc --noEmit -p tsconfig.app.json`
Expected: no errors. (If the project builds with `npm run build`, that also runs the type check — either is fine.)

- [ ] **Step 3: Commit**

```bash
git add src/components/BucketSheet.vue
git commit -m "feat: bucket sheet — create, progress, share QR/link, manual add"
```

---

### Task 5: Home page section + chain-detection wiring

**Files:**
- Modify: `src/pages/HomePage.vue`

**Interfaces:**
- Consumes: `useBucketsStore`, `bucketTotalNim` (Task 1), `BucketSheet` (Task 4).
- Produces: user-facing feature — buckets listed on Home with progress, "New" button, sheet on tap; every incoming-payments refresh records tagged contributions.

- [ ] **Step 1: Wire the store and sheet into `src/pages/HomePage.vue`**

Add imports:

```ts
import { useBucketsStore, bucketTotalNim } from '../stores/buckets'
import BucketSheet from '../components/BucketSheet.vue'
import type { Bucket } from '../types/profile'
```

Add setup state (near the other stores/refs):

```ts
const bucketsStore = useBucketsStore()
const bucketSheetOpen = ref(false)
const selectedBucketId = ref<string | null>(null)
const selectedBucket = computed<Bucket | null>(() =>
  bucketsStore.buckets.find(b => b.id === selectedBucketId.value) ?? null,
)

function openBucket(id: string | null) {
  selectedBucketId.value = id
  bucketSheetOpen.value = true
}

function bucketProgress(b: Bucket): number {
  return Math.min(100, (bucketTotalNim(b) / b.goalNim) * 100)
}
```

In `refreshPageData()`, add `bucketsStore.reload()` to the `Promise.all` array. Add `bucketsStore.load()` to `onMounted`:

```ts
onMounted(() => {
  bucketsStore.load()
  getRates().then(r => (rates.value = r))
})
```

At the end of the `try` block in `loadIncoming()`, after `loadSenderAliases()`:

```ts
    await bucketsStore.recordChainContributions(incoming.value)
```

- [ ] **Step 2: Add the template section**

Insert after the "Open invoices" `</section>` (after line 359) — hidden for fresh users unless they have buckets:

```html
    <section v-if="!freshUser || bucketsStore.buckets.length" class="activity-section">
      <div class="section-head">
        <h2>Trip buckets</h2>
        <button type="button" class="refresh" @click="openBucket(null)">＋ New</button>
      </div>
      <p v-if="!bucketsStore.buckets.length" class="subtle">
        Save up together — create a bucket and share the link with friends.
      </p>
      <div v-else class="invoice-list">
        <button
          v-for="b in [...bucketsStore.active, ...bucketsStore.completed]"
          :key="b.id"
          type="button"
          class="card bucket-card"
          :class="{ 'bucket-done': b.status === 'completed' }"
          @click="openBucket(b.id)"
        >
          <div class="bucket-head">
            <span class="bucket-name">🪣 {{ b.name }}</span>
            <span class="bucket-amount">
              {{ bucketTotalNim(b).toLocaleString(undefined, { maximumFractionDigits: 2 }) }}
              / {{ b.goalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
              <template v-if="b.status === 'completed'"> ✓</template>
            </span>
          </div>
          <div class="bucket-bar">
            <div class="bucket-fill" :style="{ width: `${bucketProgress(b)}%` }" />
          </div>
        </button>
      </div>
    </section>
```

And mount the sheet once, next to the closing `</div>` of `.page`:

```html
    <BucketSheet :open="bucketSheetOpen" :bucket="selectedBucket" @close="bucketSheetOpen = false" />
```

Add styles to the scoped block:

```css
.bucket-card {
  width: 100%; padding: 14px; cursor: pointer; text-align: left;
  border: 1px solid var(--border); font: inherit; color: var(--text);
  display: flex; flex-direction: column; gap: 10px;
}
.bucket-done { opacity: 0.7; }
.bucket-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.bucket-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bucket-amount { flex: 0 0 auto; font-weight: 700; font-size: 13px; color: var(--nq-gold-dark); }
.bucket-bar { height: 8px; border-radius: 4px; background: var(--text-6); overflow: hidden; }
.bucket-fill { height: 100%; border-radius: 4px; background: var(--nimiq-gold-bg); transition: width 0.3s ease; }
```

- [ ] **Step 3: Verify — tests, types, build**

Run: `npm run test` — expected: PASS.
Run: `npm run build` — expected: builds clean (includes vue-tsc type check).

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`, open http://localhost:5173:
1. Home shows "Trip buckets" with "＋ New"; create "Barcelona 2026" / 100 NIM.
2. Bucket card appears with 0/100 progress; tap it — sheet shows QR + share link + manual add.
3. Add a manual contribution of 25 — progress bar moves to 25%, entry listed.
4. Mark complete → card dims with ✓; reopen works; delete removes it.
5. Settings → export JSON — document contains `"version": 3` and the bucket.

- [ ] **Step 5: Commit**

```bash
git add src/pages/HomePage.vue
git commit -m "feat: trip buckets on home — progress cards and chain contribution detection"
```

---

## Self-Review Notes

- Spec coverage: data model + ledger (Task 1), tag/QR/share split + scan (Tasks 1–2), backup/export/reset/restore hops (Task 3), sheet + home section + polling wiring (Tasks 4–5). Deadlines/refunds/goal-editing intentionally absent (spec: out of scope).
- `MESSAGE_MAX_BYTES` is duplicated in `buckets.ts` (with a sync comment) instead of importing `services/nimiq.ts`, keeping the store free of the wallet-SDK module in tests.
- `recordChainContributions` only scans active buckets — a completed bucket stops accruing; reopening resumes on the next poll.
