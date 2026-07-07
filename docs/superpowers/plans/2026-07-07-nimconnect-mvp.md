# NimConnect MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the NimConnect MVP — a polished Nimiq Pay Mini App that manages wallet Profiles with live Send / Request / History actions — per `docs/superpowers/specs/2026-07-07-nimconnect-design.md`.

**Architecture:** Lean Vue-idiomatic layering: one Pinia `profiles` store is the app's API (write-through to Dexie/IndexedDB — no liveQuery/rxjs, single-tab app), small service modules for real IO (`nimiq.ts`, `links.ts`, `history.ts`), a reusable `ProfileView` that renders any profile including your own.

**Tech Stack:** Vue 3 + TypeScript + Vite, Pinia, vue-router, Dexie, `@nimiq/mini-app-sdk`, `@nimiq/utils` (validation + request links), `@nimiq/identicons`, `qrcode`, `qr-scanner`, Vitest + fake-indexeddb.

## Global Constraints

- Entity is called **Profile** everywhere in code (`Profile` type, `profiles` store, `ProfileView`); the home tab UI label is "Contacts", the own-profile tab is "Profile".
- Amounts: NIM in UI, **lunas** (1 NIM = 1e5 lunas) at every SDK/link boundary.
- Addresses are always stored normalized via `ValidationUtils.normalizeAddress` (uppercase, `NQ.. XXXX XXXX ...` with spaces); duplicate addresses rejected.
- No generic `meta` blob on Profile; future fields come via Dexie migrations.
- App must run in a plain browser (dev/judging): SDK-dependent actions degrade to a friendly "Open in Nimiq Pay" state, never crash.
- Everything except Send/History works offline.
- Mobile-first, touch targets ≥ 44px, light/dark aware, Nimiq design language (blue `#1F2348`, gold `#E9B213`, Mulish).
- Unit tests (Vitest) only for load-bearing logic: store CRUD/duplicates, search, import/export, links, history parsing. UI verified manually via dev server.
- Commit after every task; messages in conventional-commit style.

---

### Task 1: Project scaffold, dependencies, theme tokens

**Files:**
- Create: Vite scaffold (`package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.ts`, `src/App.vue`)
- Create: `src/assets/main.css`
- Create: `src/shims.d.ts`
- Delete: scaffold demo files (`src/components/HelloWorld.vue`, `src/style.css`, `src/assets/vue.svg`, `public/vite.svg`)

**Interfaces:**
- Produces: running Vite app, `npm run test` (Vitest, node env + fake-indexeddb), CSS custom properties consumed by all later UI tasks, module shim for `@nimiq/identicons`.

- [ ] **Step 1: Scaffold and install**

```bash
cd /home/maestro/Documents/projects/NimConnect
npm create vite@latest . -- --template vue-ts
npm install
npm install pinia vue-router dexie @nimiq/mini-app-sdk @nimiq/utils @nimiq/identicons qrcode qr-scanner @fontsource/mulish
npm install -D vitest fake-indexeddb @types/qrcode
```

- [ ] **Step 2: Configure Vitest**

Replace `vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
})
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Theme tokens**

Create `src/assets/main.css`:

```css
@import '@fontsource/mulish/400.css';
@import '@fontsource/mulish/600.css';
@import '@fontsource/mulish/700.css';

:root {
  --nq-blue: #1f2348;
  --nq-gold: #e9b213;
  --nq-gold-dark: #ec991c;
  --nq-light-blue: #0582ca;
  --nq-green: #21bca5;
  --nq-red: #d94432;

  --bg: #f4f4f5;
  --card: #ffffff;
  --text: #1f2348;
  --text-2: rgba(31, 35, 72, 0.6);
  --border: rgba(31, 35, 72, 0.1);
  --radius: 16px;
  --shadow: 0 2px 12px rgba(31, 35, 72, 0.07);
  --nav-h: 64px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14162e;
    --card: #1f2348;
    --text: #f4f4f5;
    --text-2: rgba(244, 244, 245, 0.6);
    --border: rgba(244, 244, 245, 0.12);
    --shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Mulish', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; }

.card {
  background: var(--card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
```

- [ ] **Step 4: Minimal `src/main.ts` and `src/App.vue`**

`src/main.ts`:

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/main.css'

createApp(App).use(createPinia()).mount('#app')
```

`src/App.vue` (placeholder until Task 8):

```vue
<template>
  <main style="padding: 24px">NimConnect</main>
</template>
```

Create `src/shims.d.ts`:

```ts
declare module '@nimiq/identicons/dist/identicons.bundle.min.js' {
  const Identicons: {
    toDataUrl(text: string): Promise<string>
    placeholderToDataUrl(color?: string, strokeWidth?: number): string
  }
  export default Identicons
}
```

Delete scaffold demo files listed above; set `index.html` `<title>NimConnect</title>`.

- [ ] **Step 5: Verify**

Run: `npm run build && npm run test`
Expected: build succeeds; Vitest reports "no test files found" (exit 0 with `--passWithNoTests`; add that flag to the test script: `"test": "vitest run --passWithNoTests"`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite + Vue 3 + TS app with Nimiq theme tokens"
```

---

### Task 2: Profile types and Dexie database

**Files:**
- Create: `src/types/profile.ts`
- Create: `src/db/db.ts`
- Test: `src/db/db.test.ts`

**Interfaces:**
- Produces: `Profile`, `ProfileType`, `ExportDocument` types; `db.profiles` Dexie `Table<Profile, string>` with unique `&address` index.

- [ ] **Step 1: Write the failing test**

`src/db/db.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import type { Profile } from '../types/profile'

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: crypto.randomUUID(),
    address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    name: 'Alice',
    type: 'person',
    isSelf: false,
    notes: '',
    tags: [],
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  }
}

describe('db', () => {
  beforeEach(async () => {
    await db.profiles.clear()
  })

  it('stores and retrieves a profile', async () => {
    const p = makeProfile()
    await db.profiles.add(p)
    expect(await db.profiles.get(p.id)).toEqual(p)
  })

  it('rejects duplicate addresses via unique index', async () => {
    await db.profiles.add(makeProfile())
    await expect(db.profiles.add(makeProfile())).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/db.test.ts`
Expected: FAIL — cannot resolve `./db` / `../types/profile`.

- [ ] **Step 3: Implement**

`src/types/profile.ts`:

```ts
export type ProfileType = 'person' | 'business' | 'merchant' | 'other'

export interface Profile {
  id: string
  /** Normalized NQ address, unique */
  address: string
  name: string
  type: ProfileType
  /** Exactly one record is the user's own profile */
  isSelf: boolean
  notes: string
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  /** Set by Send/Request/History; powers the Recent section */
  lastInteractionAt?: number
}

export interface ExportDocument {
  app: 'NimConnect'
  version: 1
  exportedAt: number
  profiles: Profile[]
}
```

`src/db/db.ts`:

```ts
import Dexie, { type Table } from 'dexie'
import type { Profile } from '../types/profile'

class NimConnectDB extends Dexie {
  profiles!: Table<Profile, string>

  constructor() {
    super('nimconnect')
    // Future fields = new this.version(n).stores(...) migrations, never a meta blob.
    this.version(1).stores({
      profiles: 'id, &address',
    })
  }
}

export const db = new NimConnectDB()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/db.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/types/profile.ts src/db/db.ts src/db/db.test.ts
git commit -m "feat: Profile model and Dexie schema v1"
```

---

### Task 3: Profiles store — CRUD, validation, duplicates

**Files:**
- Create: `src/stores/profiles.ts`
- Test: `src/stores/profiles.test.ts`

**Interfaces:**
- Consumes: `db.profiles`, `Profile` (Task 2), `ValidationUtils` from `@nimiq/utils/validation-utils`.
- Produces (used by all pages):
  - `useProfilesStore()` with: `profiles: Ref<Profile[]>`, `load(): Promise<void>`,
    `add(input: NewProfile): Promise<Profile>`, `update(id: string, patch: Partial<Profile>): Promise<void>`,
    `remove(id: string): Promise<void>`, `toggleFavorite(id: string): Promise<void>`,
    `touchInteraction(id: string): Promise<void>`, `ensureSelf(address: string): Promise<Profile>`,
    `getById(id: string): Profile | undefined`
  - `NewProfile = { address: string; name: string; notes?: string; tags?: string[]; favorite?: boolean; type?: ProfileType }`
  - `add` throws `Error('invalid-address')` / `Error('duplicate-address')`.

- [ ] **Step 1: Write the failing test**

`src/stores/profiles.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from './profiles'

const ADDR_A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const ADDR_B = 'NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN'

describe('profiles store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  it('adds a profile with normalized address and defaults', async () => {
    const store = useProfilesStore()
    await store.load()
    const p = await store.add({ address: 'nq07 0000 0000 0000 0000 0000 0000 0000 0000', name: 'Alice' })
    expect(p.address).toBe(ADDR_A)
    expect(p.type).toBe('person')
    expect(p.isSelf).toBe(false)
    expect(store.profiles).toHaveLength(1)
    expect(await db.profiles.get(p.id)).toBeTruthy()
  })

  it('rejects invalid addresses', async () => {
    const store = useProfilesStore()
    await store.load()
    await expect(store.add({ address: 'NQ00 not valid', name: 'X' })).rejects.toThrow('invalid-address')
  })

  it('rejects duplicate addresses', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: ADDR_A, name: 'Alice' })
    await expect(store.add({ address: ADDR_A.toLowerCase(), name: 'Alice 2' })).rejects.toThrow('duplicate-address')
  })

  it('updates, toggles favorite, touches interaction, removes', async () => {
    const store = useProfilesStore()
    await store.load()
    const p = await store.add({ address: ADDR_A, name: 'Alice' })
    await store.update(p.id, { name: 'Alicia', notes: 'rent' })
    expect(store.getById(p.id)!.name).toBe('Alicia')
    expect(store.getById(p.id)!.updatedAt).toBeGreaterThanOrEqual(p.updatedAt)

    await store.toggleFavorite(p.id)
    expect(store.getById(p.id)!.favorite).toBe(true)

    await store.touchInteraction(p.id)
    expect(store.getById(p.id)!.lastInteractionAt).toBeTypeOf('number')

    await store.remove(p.id)
    expect(store.profiles).toHaveLength(0)
    expect(await db.profiles.get(p.id)).toBeUndefined()
  })

  it('ensureSelf creates one self profile and is idempotent', async () => {
    const store = useProfilesStore()
    await store.load()
    const self1 = await store.ensureSelf(ADDR_B)
    const self2 = await store.ensureSelf(ADDR_B)
    expect(self1.id).toBe(self2.id)
    expect(self1.isSelf).toBe(true)
    expect(store.profiles.filter(p => p.isSelf)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/profiles.test.ts`
Expected: FAIL — cannot resolve `./profiles`.

- [ ] **Step 3: Implement**

`src/stores/profiles.ts`:

```ts
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { db } from '../db/db'
import type { Profile, ProfileType } from '../types/profile'

export interface NewProfile {
  address: string
  name: string
  notes?: string
  tags?: string[]
  favorite?: boolean
  type?: ProfileType
}

export const useProfilesStore = defineStore('profiles', () => {
  const profiles = ref<Profile[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    profiles.value = await db.profiles.toArray()
    loaded.value = true
  }

  function getById(id: string): Profile | undefined {
    return profiles.value.find(p => p.id === id)
  }

  function normalize(address: string): string {
    if (!ValidationUtils.isValidAddress(address)) throw new Error('invalid-address')
    return ValidationUtils.normalizeAddress(address)
  }

  async function add(input: NewProfile): Promise<Profile> {
    const address = normalize(input.address)
    if (profiles.value.some(p => p.address === address)) throw new Error('duplicate-address')
    const now = Date.now()
    const profile: Profile = {
      id: crypto.randomUUID(),
      address,
      name: input.name.trim(),
      type: input.type ?? 'person',
      isSelf: false,
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      favorite: input.favorite ?? false,
      createdAt: now,
      updatedAt: now,
    }
    await db.profiles.add(profile)
    profiles.value.push(profile)
    return profile
  }

  async function update(id: string, patch: Partial<Profile>) {
    const existing = getById(id)
    if (!existing) return
    if (patch.address && patch.address !== existing.address) {
      const address = normalize(patch.address)
      if (profiles.value.some(p => p.address === address && p.id !== id)) throw new Error('duplicate-address')
      patch = { ...patch, address }
    }
    const updated: Profile = { ...existing, ...patch, id, updatedAt: Date.now() }
    await db.profiles.put(updated)
    profiles.value = profiles.value.map(p => (p.id === id ? updated : p))
  }

  async function remove(id: string) {
    await db.profiles.delete(id)
    profiles.value = profiles.value.filter(p => p.id !== id)
  }

  async function toggleFavorite(id: string) {
    const p = getById(id)
    if (p) await update(id, { favorite: !p.favorite })
  }

  async function touchInteraction(id: string) {
    await update(id, { lastInteractionAt: Date.now() })
  }

  async function ensureSelf(address: string): Promise<Profile> {
    const existing = profiles.value.find(p => p.isSelf)
    if (existing) return existing
    const normalized = normalize(address)
    const byAddress = profiles.value.find(p => p.address === normalized)
    if (byAddress) {
      await update(byAddress.id, { isSelf: true } as Partial<Profile>)
      return getById(byAddress.id)!
    }
    const now = Date.now()
    const self: Profile = {
      id: crypto.randomUUID(),
      address: normalized,
      name: 'Me',
      type: 'person',
      isSelf: true,
      notes: '',
      tags: [],
      favorite: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.profiles.add(self)
    profiles.value.push(self)
    return self
  }

  const self = computed(() => profiles.value.find(p => p.isSelf) ?? null)
  const contacts = computed(() => profiles.value.filter(p => !p.isSelf))

  return {
    profiles, loaded, self, contacts,
    load, getById, add, update, remove, toggleFavorite, touchInteraction, ensureSelf,
  }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/profiles.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/stores/profiles.ts src/stores/profiles.test.ts
git commit -m "feat: profiles store with validated CRUD and self profile"
```

---

### Task 4: Store views — Recent / Favorites / All, tags, smart search

**Files:**
- Modify: `src/stores/profiles.ts`
- Test: `src/stores/profiles-views.test.ts`

**Interfaces:**
- Produces (computed/functions on the same store):
  - `recent: ComputedRef<Profile[]>` — non-self with `lastInteractionAt`, desc, max 5
  - `favorites: ComputedRef<Profile[]>` — non-self favorites, A–Z
  - `sortedContacts: ComputedRef<Profile[]>` — all non-self, A–Z by name
  - `allTags: ComputedRef<string[]>` — unique, sorted
  - `search(query: string): Profile[]` — non-self; matches name/address/notes/tags, case-insensitive; address also matches with spaces stripped; empty query → `sortedContacts`.

- [ ] **Step 1: Write the failing test**

`src/stores/profiles-views.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from './profiles'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const B = 'NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN'

describe('profiles store views', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  async function seed() {
    const store = useProfilesStore()
    await store.load()
    const alice = await store.add({ address: A, name: 'Alice', tags: ['family'], notes: 'pays rent' })
    const bob = await store.add({ address: B, name: 'Bob Café', tags: ['merchant', 'coffee'], favorite: true })
    return { store, alice, bob }
  }

  it('sorts contacts alphabetically and favorites first list', async () => {
    const { store } = await seed()
    expect(store.sortedContacts.map(p => p.name)).toEqual(['Alice', 'Bob Café'])
    expect(store.favorites.map(p => p.name)).toEqual(['Bob Café'])
  })

  it('recent lists interacted profiles, most recent first, max 5', async () => {
    const { store, alice, bob } = await seed()
    expect(store.recent).toHaveLength(0)
    await store.update(alice.id, { lastInteractionAt: 1000 })
    await store.update(bob.id, { lastInteractionAt: 2000 })
    expect(store.recent.map(p => p.name)).toEqual(['Bob Café', 'Alice'])
  })

  it('collects unique sorted tags', async () => {
    const { store } = await seed()
    expect(store.allTags).toEqual(['coffee', 'family', 'merchant'])
  })

  it('searches across name, address, notes, tags', async () => {
    const { store } = await seed()
    expect(store.search('coffee').map(p => p.name)).toEqual(['Bob Café'])
    expect(store.search('RENT').map(p => p.name)).toEqual(['Alice'])
    expect(store.search('nq57m1km').map(p => p.name)).toEqual(['Bob Café'])
    expect(store.search('family').map(p => p.name)).toEqual(['Alice'])
    expect(store.search('')).toHaveLength(2)
    expect(store.search('zzz')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/profiles-views.test.ts`
Expected: FAIL — `sortedContacts` etc. undefined.

- [ ] **Step 3: Implement**

Add to `src/stores/profiles.ts` (before the `return`), and add the new names to the returned object:

```ts
const byName = (a: Profile, b: Profile) => a.name.localeCompare(b.name)

const sortedContacts = computed(() => [...contacts.value].sort(byName))
const favorites = computed(() => contacts.value.filter(p => p.favorite).sort(byName))
const recent = computed(() =>
  contacts.value
    .filter(p => p.lastInteractionAt)
    .sort((a, b) => b.lastInteractionAt! - a.lastInteractionAt!)
    .slice(0, 5),
)
const allTags = computed(() =>
  [...new Set(contacts.value.flatMap(p => p.tags))].sort(),
)

function search(query: string): Profile[] {
  const q = query.trim().toLowerCase()
  if (!q) return sortedContacts.value
  const qCompact = q.replace(/\s+/g, '')
  return sortedContacts.value.filter(p =>
    p.name.toLowerCase().includes(q)
    || p.address.toLowerCase().replace(/\s+/g, '').includes(qCompact)
    || p.notes.toLowerCase().includes(q)
    || p.tags.some(t => t.toLowerCase().includes(q)),
  )
}
```

Update the store's `return` to also include: `sortedContacts, favorites, recent, allTags, search`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores`
Expected: all store tests pass (9 total).

- [ ] **Step 5: Commit**

```bash
git add src/stores/profiles.ts src/stores/profiles-views.test.ts
git commit -m "feat: recent/favorites/sorted views, tags, smart search"
```

---

### Task 5: Import / Export

**Files:**
- Modify: `src/stores/profiles.ts`
- Test: `src/stores/profiles-io.test.ts`

**Interfaces:**
- Produces (on the same store):
  - `exportDocument(): ExportDocument` — all profiles including self
  - `importDocument(doc: unknown): Promise<{ added: number; skipped: number }>` — validates envelope (`app === 'NimConnect'`, `version === 1`, `profiles` array), per profile validates address, skips duplicates by address, always imports with `isSelf: false` and a fresh id, throws `Error('invalid-export')` on bad envelope.

- [ ] **Step 1: Write the failing test**

`src/stores/profiles-io.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from './profiles'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const B = 'NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN'

describe('import/export', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  it('round-trips through export → import', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice', tags: ['family'], notes: 'n', favorite: true })
    const doc = store.exportDocument()
    expect(doc.app).toBe('NimConnect')
    expect(doc.version).toBe(1)
    expect(doc.profiles).toHaveLength(1)

    await db.profiles.clear()
    setActivePinia(createPinia())
    const store2 = useProfilesStore()
    await store2.load()
    const result = await store2.importDocument(JSON.parse(JSON.stringify(doc)))
    expect(result).toEqual({ added: 1, skipped: 0 })
    expect(store2.profiles[0].name).toBe('Alice')
    expect(store2.profiles[0].favorite).toBe(true)
  })

  it('skips duplicates and strips isSelf on import', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice' })
    const doc = {
      app: 'NimConnect', version: 1, exportedAt: Date.now(),
      profiles: [
        { id: 'x', address: A, name: 'Dup', type: 'person', isSelf: true, notes: '', tags: [], favorite: false, createdAt: 1, updatedAt: 1 },
        { id: 'y', address: B, name: 'Bob', type: 'person', isSelf: true, notes: '', tags: [], favorite: false, createdAt: 1, updatedAt: 1 },
      ],
    }
    const result = await store.importDocument(doc)
    expect(result).toEqual({ added: 1, skipped: 1 })
    expect(store.getByAddress(B)!.isSelf).toBe(false)
  })

  it('rejects malformed documents', async () => {
    const store = useProfilesStore()
    await store.load()
    await expect(store.importDocument({ nope: true })).rejects.toThrow('invalid-export')
    await expect(store.importDocument('[]')).rejects.toThrow('invalid-export')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/profiles-io.test.ts`
Expected: FAIL — `exportDocument` undefined.

- [ ] **Step 3: Implement**

Add to `src/stores/profiles.ts` (import `ExportDocument` type from `../types/profile`):

```ts
function getByAddress(address: string): Profile | undefined {
  return profiles.value.find(p => p.address === address)
}

function exportDocument(): ExportDocument {
  return {
    app: 'NimConnect',
    version: 1,
    exportedAt: Date.now(),
    profiles: JSON.parse(JSON.stringify(profiles.value)),
  }
}

async function importDocument(doc: unknown): Promise<{ added: number; skipped: number }> {
  const d = doc as ExportDocument
  if (!d || typeof d !== 'object' || d.app !== 'NimConnect' || d.version !== 1 || !Array.isArray(d.profiles)) {
    throw new Error('invalid-export')
  }
  let added = 0
  let skipped = 0
  for (const raw of d.profiles) {
    try {
      await add({
        address: raw.address,
        name: String(raw.name ?? ''),
        notes: String(raw.notes ?? ''),
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
        favorite: !!raw.favorite,
        type: raw.type,
      })
      added++
    } catch {
      skipped++
    }
  }
  return { added, skipped }
}
```

Add `getByAddress, exportDocument, importDocument` to the store's `return`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores`
Expected: all pass (12 total).

- [ ] **Step 5: Commit**

```bash
git add src/stores/profiles.ts src/stores/profiles-io.test.ts
git commit -m "feat: versioned JSON import/export with duplicate skipping"
```

---

### Task 6: Nimiq services — SDK wrapper and request links

**Files:**
- Create: `src/services/nimiq.ts`
- Create: `src/services/links.ts`
- Test: `src/services/links.test.ts`

**Interfaces:**
- Consumes: `@nimiq/mini-app-sdk` (`init`), `@nimiq/utils/request-link-encoding`.
- Produces:
  - `getProvider(): Promise<NimiqProvider | null>` — null when not inside Nimiq Pay (3s timeout, cached)
  - `getMyAddress(): Promise<string | null>`
  - `sendNim(recipient: string, amountNim: number): Promise<string>` — resolves tx hex, throws `Error(message)` on wallet error/decline
  - `nimToLunas(nim: number): number`
  - `makeRequestLink(address: string, amountNim?: number): string` — `nimiq:` URI
  - `shortAddress(address: string): string` — `NQ07 0000…0000` display helper (lives in `links.ts` for reuse; pure string)

- [ ] **Step 1: Write the failing test**

`src/services/links.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeRequestLink, shortAddress, nimToLunas } from './links'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

describe('links', () => {
  it('creates a nimiq: request link without amount', () => {
    const link = makeRequestLink(A)
    expect(link.startsWith('nimiq:')).toBe(true)
    expect(link.toUpperCase()).toContain('NQ07')
  })

  it('creates a request link carrying the amount', () => {
    const withAmount = makeRequestLink(A, 1.5)
    expect(withAmount).toContain('amount=1.5')
  })

  it('converts NIM to lunas', () => {
    expect(nimToLunas(1)).toBe(100000)
    expect(nimToLunas(0.00001)).toBe(1)
    expect(nimToLunas(1.234567)).toBe(123457)
  })

  it('shortens addresses for display', () => {
    expect(shortAddress(A)).toBe('NQ07 0000…0000')
    expect(shortAddress('')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/links.test.ts`
Expected: FAIL — cannot resolve `./links`.

- [ ] **Step 3: Implement**

`src/services/links.ts`:

```ts
import { createNimiqRequestLink, NimiqRequestLinkType } from '@nimiq/utils/request-link-encoding'

export function nimToLunas(nim: number): number {
  return Math.round(nim * 1e5)
}

export function makeRequestLink(address: string, amountNim?: number): string {
  return createNimiqRequestLink(address, {
    type: NimiqRequestLinkType.URI,
    ...(amountNim ? { amount: nimToLunas(amountNim) } : {}),
  })
}

export function shortAddress(address: string): string {
  const parts = address.split(' ')
  if (parts.length < 9) return address
  return `${parts[0]} ${parts[1]}…${parts[8]}`
}
```

If the amount assertion fails because the library encodes lunas differently, check the produced link once with `console.log(makeRequestLink(A, 1.5))` and pin the test to the actual official encoding — the library is the source of truth for the format, the test guards against regressions only.

`src/services/nimiq.ts`:

```ts
import { init, type NimiqProvider } from '@nimiq/mini-app-sdk'
import { nimToLunas } from './links'

let providerPromise: Promise<NimiqProvider | null> | null = null

/** Resolves the provider once; null when running outside Nimiq Pay. */
export function getProvider(): Promise<NimiqProvider | null> {
  providerPromise ??= init({ timeout: 3000 }).catch(() => null)
  return providerPromise
}

function isErrorResponse(r: unknown): r is { error: { type: string; message: string } } {
  return typeof r === 'object' && r !== null && 'error' in r
}

export async function getMyAddress(): Promise<string | null> {
  const provider = await getProvider()
  if (!provider) return null
  const accounts = await provider.listAccounts()
  if (isErrorResponse(accounts) || !accounts.length) return null
  return accounts[0]
}

export async function sendNim(recipient: string, amountNim: number): Promise<string> {
  const provider = await getProvider()
  if (!provider) throw new Error('Not running inside Nimiq Pay')
  const result = await provider.sendBasicTransaction({ recipient, value: nimToLunas(amountNim) })
  if (isErrorResponse(result)) throw new Error(result.error.message)
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/links.test.ts`
Expected: 4 passed. Also run `npx vue-tsc --noEmit` — `nimiq.ts` must typecheck (if `NimiqProvider` isn't exported from the package root, import it as `import type { NimiqProvider } from '@nimiq/mini-app-sdk'` — it is re-exported per the package types).

- [ ] **Step 5: Commit**

```bash
git add src/services/links.ts src/services/links.test.ts src/services/nimiq.ts
git commit -m "feat: Nimiq SDK wrapper with browser fallback and request links"
```

---

### Task 7: History service

**Files:**
- Create: `src/services/history.ts`
- Test: `src/services/history.test.ts`

**Interfaces:**
- Consumes: global `fetch`, `localStorage` (guarded — absent in node tests).
- Produces:
  - `interface HistoryItem { hash: string; timestamp: number; valueNim: number; incoming: boolean }`
  - `fetchHistory(myAddress: string, otherAddress: string): Promise<HistoryItem[]>` — newest first, only txs between the two addresses; caches last result per pair in `localStorage` and returns cache on network failure; throws only when no data at all is available.

- [ ] **Step 1: Write the failing test**

`src/services/history.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchHistory } from './history'

const ME = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const OTHER = 'NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN'
const THIRD = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

function rpcResult(txs: unknown[]) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: { data: txs } }) }
}

function tx(from: string, to: string, value: number, timestamp: number, hash = 'h') {
  return { hash, from, to, value, timestamp }
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchHistory', () => {
  it('filters to txs between the two addresses and maps direction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      tx(ME, OTHER, 100000, 2000, 'a'),
      tx(OTHER, ME, 50000, 3000, 'b'),
      tx(THIRD, OTHER, 700, 4000, 'c'),
    ])))
    const items = await fetchHistory(ME, OTHER)
    expect(items).toEqual([
      { hash: 'b', timestamp: 3000, valueNim: 0.5, incoming: true },
      { hash: 'a', timestamp: 2000, valueNim: 1, incoming: false },
    ])
  })

  it('throws when the network fails and no cache exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchHistory(ME, OTHER)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/history.test.ts`
Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 3: Implement**

`src/services/history.ts`:

```ts
// ponytail: public community RPC; swap RPC_URL if the provider RPC or an
// official endpoint becomes available in the mini-app SDK.
const RPC_URL = 'https://rpc.nimiqwatch.com'

export interface HistoryItem {
  hash: string
  timestamp: number
  valueNim: number
  incoming: boolean
}

interface RpcTx { hash: string; from: string; to: string; value: number; timestamp: number }

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

function cacheKey(me: string, other: string) {
  return `nimconnect:history:${compact(me)}:${compact(other)}`
}

function readCache(key: string): HistoryItem[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as HistoryItem[]) : null
  } catch {
    return null
  }
}

export async function fetchHistory(myAddress: string, otherAddress: string): Promise<HistoryItem[]> {
  const key = cacheKey(myAddress, otherAddress)
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransactionsByAddress',
        params: [otherAddress, 200],
      }),
    })
    if (!res.ok) throw new Error(`rpc ${res.status}`)
    const body = await res.json()
    const txs: RpcTx[] = body.result?.data ?? body.result ?? []
    const me = compact(myAddress)
    const other = compact(otherAddress)
    const items = txs
      .filter(t => {
        const from = compact(t.from)
        const to = compact(t.to)
        return (from === me && to === other) || (from === other && to === me)
      })
      .map(t => ({
        hash: t.hash,
        timestamp: t.timestamp,
        valueNim: t.value / 1e5,
        incoming: compact(t.to) === me,
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(items))
    } catch { /* cache is best-effort */ }
    return items
  } catch (e) {
    const cached = readCache(key)
    if (cached) return cached
    throw e
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/history.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/history.ts src/services/history.test.ts
git commit -m "feat: per-contact transaction history with offline cache"
```

---

### Task 8: App shell — router, bottom nav, page stubs

**Files:**
- Create: `src/router.ts`
- Create: `src/pages/ContactsPage.vue`, `src/pages/ProfileDetailsPage.vue`, `src/pages/ProfileFormPage.vue`, `src/pages/MyProfilePage.vue`, `src/pages/SettingsPage.vue` (stubs; filled in Tasks 9–12)
- Modify: `src/main.ts`, `src/App.vue`

**Interfaces:**
- Produces routes: `/` (Contacts), `/profile/:id`, `/add`, `/edit/:id`, `/me`, `/settings`. Bottom nav with two tabs: Contacts (`/`) and Profile (`/me`).

- [ ] **Step 1: Router**

`src/router.ts`:

```ts
import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./pages/ContactsPage.vue') },
    { path: '/profile/:id', component: () => import('./pages/ProfileDetailsPage.vue') },
    { path: '/add', component: () => import('./pages/ProfileFormPage.vue') },
    { path: '/edit/:id', component: () => import('./pages/ProfileFormPage.vue') },
    { path: '/me', component: () => import('./pages/MyProfilePage.vue') },
    { path: '/settings', component: () => import('./pages/SettingsPage.vue') },
  ],
})
```

(Hash history: mini apps are served from a static origin; no server rewrites needed.)

- [ ] **Step 2: Page stubs**

Each page as a minimal SFC, e.g. `src/pages/ContactsPage.vue`:

```vue
<template>
  <div style="padding: 16px">Contacts</div>
</template>
```

Same pattern for the other four pages with their names as text.

- [ ] **Step 3: Shell**

`src/main.ts`:

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './assets/main.css'

createApp(App).use(createPinia()).use(router).mount('#app')
```

`src/App.vue`:

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useProfilesStore } from './stores/profiles'
import { getMyAddress } from './services/nimiq'

const store = useProfilesStore()
onMounted(async () => {
  await store.load()
  const address = await getMyAddress()
  if (address) await store.ensureSelf(address)
})
</script>

<template>
  <div class="app">
    <router-view v-slot="{ Component }">
      <transition name="page" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>

    <nav class="bottom-nav">
      <router-link to="/" class="nav-item" :class="{ active: $route.path === '/' }">
        <span class="nav-icon">👥</span><span>Contacts</span>
      </router-link>
      <router-link to="/me" class="nav-item" :class="{ active: $route.path === '/me' }">
        <span class="nav-icon">🪪</span><span>Profile</span>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.app {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding-bottom: calc(var(--nav-h) + env(safe-area-inset-bottom));
}
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 560px;
  height: calc(var(--nav-h) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  display: flex;
  background: var(--card);
  border-top: 1px solid var(--border);
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  text-decoration: none;
  min-height: 44px;
}
.nav-item.active { color: var(--nq-gold-dark); }
.nav-icon { font-size: 20px; line-height: 1; }
.page-enter-active, .page-leave-active { transition: opacity 0.15s ease; }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
```

- [ ] **Step 4: Verify manually**

Run: `npm run dev` — open the URL; both tabs navigate between stub pages, nav highlights the active tab, no console errors (outside Nimiq Pay, `getMyAddress` resolves null after the 3s timeout — silent).
Run: `npm run build && npx vue-tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: app shell with router and bottom navigation"
```

---

### Task 9: Identicon, ProfileRow, ContactsPage

**Files:**
- Create: `src/components/Identicon.vue`, `src/components/ProfileRow.vue`, `src/components/SearchBar.vue`, `src/components/EmptyState.vue`
- Modify: `src/pages/ContactsPage.vue`

**Interfaces:**
- Consumes: store views from Task 4, `shortAddress` from `src/services/links.ts`.
- Produces:
  - `Identicon` props: `{ address: string; size?: number }` (default 44)
  - `ProfileRow` props: `{ profile: Profile }`, emits nothing (navigates via router-link)
  - `SearchBar` props: `{ modelValue: string; placeholder?: string }`, emits `update:modelValue`
  - `EmptyState` props: `{ icon: string; title: string; hint?: string }`

- [ ] **Step 1: Identicon component**

`src/components/Identicon.vue`:

```vue
<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import Identicons from '@nimiq/identicons/dist/identicons.bundle.min.js'

const props = withDefaults(defineProps<{ address: string; size?: number }>(), { size: 44 })
const src = ref(Identicons.placeholderToDataUrl('#bbb'))

watchEffect(async () => {
  if (!props.address) return
  src.value = await Identicons.toDataUrl(props.address)
})
</script>

<template>
  <img :src="src" :width="size" :height="size" alt="" class="identicon" />
</template>

<style scoped>
.identicon { display: block; }
</style>
```

- [ ] **Step 2: SearchBar and EmptyState**

`src/components/SearchBar.vue`:

```vue
<script setup lang="ts">
defineProps<{ modelValue: string; placeholder?: string }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <input
    class="search"
    type="search"
    :value="modelValue"
    :placeholder="placeholder ?? 'Search name, address, tag…'"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<style scoped>
.search {
  width: 100%;
  height: 44px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: var(--card);
  color: var(--text);
  font: inherit;
  outline: none;
}
.search:focus { border-color: var(--nq-gold); }
</style>
```

`src/components/EmptyState.vue`:

```vue
<script setup lang="ts">
defineProps<{ icon: string; title: string; hint?: string }>()
</script>

<template>
  <div class="empty">
    <div class="empty-icon">{{ icon }}</div>
    <div class="empty-title">{{ title }}</div>
    <div v-if="hint" class="empty-hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.empty { text-align: center; padding: 48px 24px; color: var(--text-2); }
.empty-icon { font-size: 40px; margin-bottom: 12px; }
.empty-title { font-weight: 700; color: var(--text); }
.empty-hint { font-size: 14px; margin-top: 4px; }
</style>
```

- [ ] **Step 3: ProfileRow**

`src/components/ProfileRow.vue`:

```vue
<script setup lang="ts">
import type { Profile } from '../types/profile'
import { shortAddress } from '../services/links'
import Identicon from './Identicon.vue'

defineProps<{ profile: Profile }>()
</script>

<template>
  <router-link :to="`/profile/${profile.id}`" class="row">
    <Identicon :address="profile.address" :size="44" />
    <div class="row-main">
      <div class="row-name">{{ profile.name }}</div>
      <div class="row-address">{{ shortAddress(profile.address) }}</div>
    </div>
    <span v-if="profile.favorite" class="row-star">★</span>
  </router-link>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  min-height: 64px;
  text-decoration: none;
  color: var(--text);
  transition: background 0.12s ease;
}
.row:active { background: var(--border); }
.row-main { flex: 1; min-width: 0; }
.row-name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-address { font-size: 13px; color: var(--text-2); }
.row-star { color: var(--nq-gold); font-size: 18px; }
</style>
```

- [ ] **Step 4: ContactsPage**

`src/pages/ContactsPage.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useProfilesStore } from '../stores/profiles'
import ProfileRow from '../components/ProfileRow.vue'
import SearchBar from '../components/SearchBar.vue'
import EmptyState from '../components/EmptyState.vue'

const store = useProfilesStore()
const query = ref('')

const searching = computed(() => query.value.trim().length > 0)
const results = computed(() => store.search(query.value))
const sections = computed(() => [
  { title: 'Recent', items: store.recent },
  { title: 'Favorites', items: store.favorites },
  { title: 'All', items: store.sortedContacts },
].filter(s => s.items.length > 0))
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Contacts</h1>
      <SearchBar v-model="query" />
    </header>

    <EmptyState
      v-if="store.contacts.length === 0"
      icon="👥"
      title="No contacts yet"
      hint="Add your first contact to turn addresses into people."
    />

    <template v-else-if="searching">
      <div class="card list">
        <ProfileRow v-for="p in results" :key="p.id" :profile="p" />
      </div>
      <EmptyState v-if="results.length === 0" icon="🔍" title="No matches" />
    </template>

    <template v-else>
      <section v-for="section in sections" :key="section.title" class="section">
        <h2 class="section-title">{{ section.title }}</h2>
        <div class="card list">
          <ProfileRow v-for="p in section.items" :key="p.id" :profile="p" />
        </div>
      </section>
    </template>

    <router-link to="/add" class="fab" aria-label="Add contact">＋</router-link>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 88px; }
.header h1 { font-size: 28px; margin: 8px 0 12px; }
.section { margin-top: 20px; }
.section-title {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-2);
  margin: 0 0 8px 4px;
}
.list { overflow: hidden; padding: 4px 0; }
.fab {
  position: fixed;
  right: max(16px, calc(50% - 264px));
  bottom: calc(var(--nav-h) + env(safe-area-inset-bottom) + 16px);
  width: 56px;
  height: 56px;
  border-radius: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: #fff;
  text-decoration: none;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
  box-shadow: 0 4px 16px rgba(233, 178, 19, 0.4);
}
</style>
```

- [ ] **Step 5: Verify manually**

Run: `npm run dev`. Add two profiles via the browser console to seed:

```js
// paste in devtools console
const { useProfilesStore } = await import('/src/stores/profiles.ts')
const s = useProfilesStore()
await s.add({ address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', name: 'Alice', favorite: true })
await s.add({ address: 'NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN', name: 'Bob Café', tags: ['merchant'] })
```

Expected: identicons render, Favorites section shows Alice, All shows both A–Z, search "merchant" finds Bob, empty search restores sections, FAB visible. Reload page — data persists.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: contacts list with sections, search, identicons"
```

---

### Task 10: Add / Edit profile form with QR scanning

**Files:**
- Create: `src/components/QrScanner.vue`, `src/components/TagChips.vue`
- Modify: `src/pages/ProfileFormPage.vue`

**Interfaces:**
- Consumes: store `add`/`update`/`getById`/`allTags`, `ValidationUtils`, `qr-scanner` package.
- Produces:
  - `QrScanner` emits `scan(text: string)` and `error()`; shows camera preview; caller overlays/closes it
  - `TagChips` props `{ modelValue: string[]; suggestions: string[] }`, emits `update:modelValue`
  - Form handles both `/add` and `/edit/:id`; QR scans accept raw addresses and `nimiq:` URIs.

- [ ] **Step 1: QrScanner component**

`src/components/QrScanner.vue`:

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import QrScanner from 'qr-scanner'

const emit = defineEmits<{ scan: [text: string]; error: [] }>()
const video = ref<HTMLVideoElement>()
let scanner: QrScanner | null = null

onMounted(async () => {
  try {
    scanner = new QrScanner(
      video.value!,
      result => emit('scan', result.data),
      { returnDetailedScanResult: true, highlightScanRegion: true },
    )
    await scanner.start()
  } catch {
    emit('error')
  }
})

onBeforeUnmount(() => {
  scanner?.destroy()
})
</script>

<template>
  <video ref="video" class="scanner" />
</template>

<style scoped>
.scanner { width: 100%; border-radius: var(--radius); background: #000; aspect-ratio: 1; object-fit: cover; }
</style>
```

- [ ] **Step 2: TagChips component**

`src/components/TagChips.vue`:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ modelValue: string[]; suggestions: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [tags: string[]] }>()
const draft = ref('')

const available = computed(() =>
  props.suggestions.filter(s => !props.modelValue.includes(s)),
)

function addTag(tag: string) {
  const t = tag.trim()
  if (t && !props.modelValue.includes(t)) emit('update:modelValue', [...props.modelValue, t])
  draft.value = ''
}

function removeTag(tag: string) {
  emit('update:modelValue', props.modelValue.filter(t => t !== tag))
}
</script>

<template>
  <div class="tags">
    <div class="chips">
      <button v-for="t in modelValue" :key="t" type="button" class="chip active" @click="removeTag(t)">
        {{ t }} ✕
      </button>
    </div>
    <input
      v-model="draft"
      class="tag-input"
      placeholder="Add tag…"
      @keydown.enter.prevent="addTag(draft)"
      @blur="addTag(draft)"
    />
    <div v-if="available.length" class="chips">
      <button v-for="s in available" :key="s" type="button" class="chip" @click="addTag(s)">{{ s }}</button>
    </div>
  </div>
</template>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.chip {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-2);
  border-radius: 16px;
  padding: 6px 12px;
  min-height: 32px;
  cursor: pointer;
}
.chip.active { background: var(--nq-blue); color: #fff; border-color: var(--nq-blue); }
.tag-input {
  width: 100%; height: 44px; padding: 0 12px; font: inherit;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--card); color: var(--text);
}
</style>
```

- [ ] **Step 3: ProfileFormPage**

`src/pages/ProfileFormPage.vue`:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { parseRequestLink, Currency } from '@nimiq/utils/request-link-encoding'
import { useProfilesStore } from '../stores/profiles'
import Identicon from '../components/Identicon.vue'
import QrScanner from '../components/QrScanner.vue'
import TagChips from '../components/TagChips.vue'
import type { ProfileType } from '../types/profile'

const route = useRoute()
const router = useRouter()
const store = useProfilesStore()

const editId = route.params.id as string | undefined
const name = ref('')
const address = ref('')
const notes = ref('')
const tags = ref<string[]>([])
const favorite = ref(false)
const type = ref<ProfileType>('person')
const scanning = ref(false)
const error = ref('')

onMounted(async () => {
  await store.load()
  if (editId) {
    const p = store.getById(editId)
    if (!p) return router.replace('/')
    name.value = p.name
    address.value = p.address
    notes.value = p.notes
    tags.value = [...p.tags]
    favorite.value = p.favorite
    type.value = p.type
  }
})

const addressValid = computed(() => ValidationUtils.isValidAddress(address.value))

function onScan(text: string) {
  scanning.value = false
  // Accept raw addresses or nimiq: request links
  if (ValidationUtils.isValidAddress(text)) {
    address.value = text
    return
  }
  try {
    const parsed = parseRequestLink(text, { currencies: [Currency.NIM] })
    if (parsed?.recipient) address.value = parsed.recipient
  } catch {
    error.value = 'QR code does not contain a Nimiq address'
  }
}

async function save() {
  error.value = ''
  try {
    if (editId) {
      await store.update(editId, {
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: tags.value, favorite: favorite.value, type: type.value,
      })
      router.back()
    } else {
      const p = await store.add({
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: tags.value, favorite: favorite.value, type: type.value,
      })
      router.replace(`/profile/${p.id}`)
    }
  } catch (e) {
    error.value = (e as Error).message === 'duplicate-address'
      ? 'You already have a contact with this address.'
      : 'Please enter a valid Nimiq address (NQ…).'
  }
}
</script>

<template>
  <div class="page">
    <header class="form-header">
      <button type="button" class="back" @click="router.back()">‹ Back</button>
      <h1>{{ editId ? 'Edit Profile' : 'New Contact' }}</h1>
    </header>

    <form class="card form" @submit.prevent="save">
      <div class="avatar-preview">
        <Identicon :address="addressValid ? address : ''" :size="72" />
      </div>

      <label class="field">
        <span>Name</span>
        <input v-model="name" required placeholder="Alice" />
      </label>

      <label class="field">
        <span>Nimiq address</span>
        <div class="address-row">
          <input v-model="address" required placeholder="NQ…" spellcheck="false" autocapitalize="characters" />
          <button type="button" class="scan-btn" aria-label="Scan QR" @click="scanning = !scanning">▣</button>
        </div>
      </label>

      <QrScanner v-if="scanning" @scan="onScan" @error="scanning = false; error = 'Camera unavailable — paste the address instead.'" />

      <label class="field">
        <span>Type</span>
        <select v-model="type">
          <option value="person">Person</option>
          <option value="business">Business</option>
          <option value="merchant">Merchant</option>
          <option value="other">Other</option>
        </select>
      </label>

      <label class="field">
        <span>Notes</span>
        <textarea v-model="notes" rows="3" placeholder="Met at Nimiq meetup…" />
      </label>

      <div class="field">
        <span>Tags</span>
        <TagChips v-model="tags" :suggestions="store.allTags" />
      </div>

      <label class="favorite-row">
        <input v-model="favorite" type="checkbox" />
        <span>⭐ Favorite</span>
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button type="submit" class="primary" :disabled="!name.trim() || !addressValid">
        {{ editId ? 'Save changes' : 'Add contact' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.form-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.form-header h1 { font-size: 22px; margin: 0; }
.back { background: none; border: none; color: var(--nq-light-blue); font-size: 16px; padding: 8px; cursor: pointer; }
.form { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.avatar-preview { display: flex; justify-content: center; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 13px; font-weight: 700; color: var(--text-2); }
.field input, .field select, .field textarea {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg); color: var(--text);
}
.address-row { display: flex; gap: 8px; }
.address-row input { flex: 1; }
.scan-btn {
  width: 44px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg); color: var(--text); font-size: 20px; cursor: pointer;
}
.favorite-row { display: flex; align-items: center; gap: 8px; min-height: 44px; font-weight: 600; }
.error { color: var(--nq-red); font-size: 14px; margin: 0; }
.primary {
  height: 48px; border: none; border-radius: 24px; cursor: pointer;
  font-weight: 700; font-size: 16px; color: #fff;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
}
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
```

Note: if `parseRequestLink`'s option signature differs in the installed `@nimiq/utils` version, check `node_modules/@nimiq/utils/dist/request-link-encoding/RequestLinkEncoding.d.ts` and adapt the call — the goal is only: extract `recipient` from a `nimiq:` URI.

- [ ] **Step 4: Verify manually**

Run: `npm run dev`.
- Add flow: FAB → form; invalid address disables submit; valid address shows live identicon; duplicate address shows friendly error; tags autocomplete from existing tags; save lands on the new profile route (stub page for now).
- Edit flow: `/edit/<id>` pre-fills.
- QR: click ▣ — camera prompt in a normal browser; deny it → friendly paste hint.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add/edit profile form with QR scanning and tags"
```

---

### Task 11: ProfileView, details page, Send / Request / History

**Files:**
- Create: `src/components/ProfileView.vue`, `src/components/QrCode.vue`, `src/components/ActionSheet.vue`
- Modify: `src/pages/ProfileDetailsPage.vue`

**Interfaces:**
- Consumes: store, `sendNim`/`getProvider` (Task 6), `makeRequestLink` (Task 6), `fetchHistory` (Task 7).
- Produces:
  - `QrCode` props `{ text: string; size?: number }` — renders QR as `<img>` via `qrcode` `toDataURL`
  - `ActionSheet` props `{ open: boolean; title: string }`, emits `close`, default slot — bottom sheet modal
  - `ProfileView` props `{ profile: Profile; own?: boolean }`, emits `edit`, `remove` — renders header + actions + notes; used by both details page and MyProfilePage.

- [ ] **Step 1: QrCode component**

`src/components/QrCode.vue`:

```vue
<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import QRCode from 'qrcode'

const props = withDefaults(defineProps<{ text: string; size?: number }>(), { size: 240 })
const src = ref('')

watchEffect(async () => {
  if (!props.text) return
  src.value = await QRCode.toDataURL(props.text, { width: props.size, margin: 1 })
})
</script>

<template>
  <img v-if="src" :src="src" :width="size" :height="size" alt="QR code" class="qr" />
</template>

<style scoped>
.qr { border-radius: 12px; background: #fff; padding: 8px; display: block; margin: 0 auto; }
</style>
```

- [ ] **Step 2: ActionSheet component**

`src/components/ActionSheet.vue`:

```vue
<script setup lang="ts">
defineProps<{ open: boolean; title: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <teleport to="body">
    <transition name="sheet">
      <div v-if="open" class="backdrop" @click.self="$emit('close')">
        <div class="sheet card">
          <div class="sheet-bar" />
          <h2>{{ title }}</h2>
          <slot />
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(31, 35, 72, 0.4);
  display: flex; align-items: flex-end; justify-content: center;
}
.sheet {
  width: 100%; max-width: 560px;
  border-radius: var(--radius) var(--radius) 0 0;
  padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
  max-height: 80dvh; overflow-y: auto;
}
.sheet-bar { width: 36px; height: 4px; border-radius: 2px; background: var(--border); margin: 8px auto 4px; }
.sheet h2 { font-size: 18px; margin: 12px 0; }
.sheet-enter-active, .sheet-leave-active { transition: opacity 0.2s ease; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform 0.2s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(100%); }
</style>
```

- [ ] **Step 3: ProfileView component**

`src/components/ProfileView.vue`:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { getProvider, sendNim } from '../services/nimiq'
import { makeRequestLink } from '../services/links'
import { fetchHistory, type HistoryItem } from '../services/history'
import Identicon from './Identicon.vue'
import QrCode from './QrCode.vue'
import ActionSheet from './ActionSheet.vue'

const props = defineProps<{ profile: Profile; own?: boolean }>()
defineEmits<{ edit: []; remove: [] }>()

const store = useProfilesStore()
const insidePay = ref(false)
const sheet = ref<'send' | 'request' | 'history' | null>(null)
const amount = ref<number | null>(null)
const sending = ref(false)
const sendResult = ref<'ok' | string | null>(null)
const history = ref<HistoryItem[] | null>(null)
const historyError = ref(false)
const copied = ref(false)

onMounted(async () => {
  insidePay.value = (await getProvider()) !== null
})

const requestLink = computed(() => makeRequestLink(props.profile.address, amount.value ?? undefined))
const dateAdded = computed(() => new Date(props.profile.createdAt).toLocaleDateString())
const lastSeen = computed(() =>
  props.profile.lastInteractionAt ? new Date(props.profile.lastInteractionAt).toLocaleDateString() : null,
)

async function copyAddress() {
  await navigator.clipboard.writeText(props.profile.address)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function openSheet(which: 'send' | 'request' | 'history') {
  amount.value = null
  sendResult.value = null
  sheet.value = which
  if (which === 'history') loadHistory()
}

async function doSend() {
  if (!amount.value) return
  sending.value = true
  sendResult.value = null
  try {
    await sendNim(props.profile.address, amount.value)
    sendResult.value = 'ok'
    await store.touchInteraction(props.profile.id)
  } catch (e) {
    sendResult.value = (e as Error).message
  } finally {
    sending.value = false
  }
}

function copyRequestLink() {
  navigator.clipboard.writeText(requestLink.value)
  store.touchInteraction(props.profile.id)
}

async function loadHistory() {
  history.value = null
  historyError.value = false
  const me = store.self?.address
  if (!me) {
    historyError.value = true
    return
  }
  try {
    history.value = await fetchHistory(me, props.profile.address)
    await store.touchInteraction(props.profile.id)
  } catch {
    historyError.value = true
  }
}
</script>

<template>
  <div class="profile">
    <div class="card head">
      <Identicon :address="profile.address" :size="96" />
      <h1 class="name">
        {{ profile.name }}
        <button v-if="!own" class="star" :class="{ on: profile.favorite }" @click="store.toggleFavorite(profile.id)">
          {{ profile.favorite ? '★' : '☆' }}
        </button>
      </h1>
      <button class="address" @click="copyAddress">
        {{ profile.address }}
        <span class="copy-hint">{{ copied ? 'Copied!' : 'Tap to copy' }}</span>
      </button>
      <div v-if="profile.tags.length" class="tag-row">
        <span v-for="t in profile.tags" :key="t" class="tag">{{ t }}</span>
      </div>
      <div class="meta">
        <span>Added {{ dateAdded }}</span>
        <span v-if="lastSeen"> · Last activity {{ lastSeen }}</span>
      </div>
    </div>

    <div v-if="!own" class="actions">
      <button class="action live" @click="openSheet('send')">💸<span>Send</span></button>
      <button class="action live" @click="openSheet('request')">📥<span>Request</span></button>
      <button class="action live" @click="openSheet('history')">🕘<span>History</span></button>
    </div>
    <div v-if="!own" class="actions future">
      <button class="action" disabled>🧾<span>Invoice</span></button>
      <button class="action" disabled>🍕<span>Split Bill</span></button>
      <button class="action" disabled>💛<span>Tip</span></button>
      <button class="action" disabled>💬<span>Message</span></button>
    </div>

    <div v-if="own" class="card own-qr">
      <QrCode :text="requestLink" :size="220" />
      <p class="hint">Let others scan this to add you or pay you.</p>
    </div>

    <div v-if="profile.notes" class="card notes">
      <h2>Notes</h2>
      <p>{{ profile.notes }}</p>
    </div>

    <div class="manage">
      <button class="link" @click="$emit('edit')">Edit</button>
      <button v-if="!own" class="link danger" @click="$emit('remove')">Delete</button>
    </div>

    <ActionSheet :open="sheet === 'send'" title="Send NIM" @close="sheet = null">
      <template v-if="insidePay">
        <label class="amount-label">
          Amount (NIM)
          <input v-model.number="amount" type="number" min="0.00001" step="any" placeholder="0.00" />
        </label>
        <p v-if="sendResult === 'ok'" class="ok">✓ Sent to {{ profile.name }}</p>
        <p v-else-if="sendResult" class="err">{{ sendResult }}</p>
        <button class="primary" :disabled="!amount || sending" @click="doSend">
          {{ sending ? 'Waiting for confirmation…' : `Send to ${profile.name}` }}
        </button>
      </template>
      <p v-else class="hint">Open NimConnect inside Nimiq Pay to send NIM directly.</p>
    </ActionSheet>

    <ActionSheet :open="sheet === 'request'" title="Request payment" @close="sheet = null">
      <label class="amount-label">
        Amount (NIM, optional)
        <input v-model.number="amount" type="number" min="0" step="any" placeholder="Any amount" />
      </label>
      <QrCode :text="requestLink" :size="220" />
      <p class="hint">{{ profile.name }} can scan this QR or open the link to pay you.</p>
      <button class="primary" @click="copyRequestLink">
        Copy payment link
      </button>
    </ActionSheet>

    <ActionSheet :open="sheet === 'history'" title="Payment history" @close="sheet = null">
      <p v-if="historyError" class="hint">History is unavailable right now{{ store.self ? '' : ' — connect inside Nimiq Pay first' }}.</p>
      <p v-else-if="history === null" class="hint">Loading…</p>
      <p v-else-if="history.length === 0" class="hint">No payments between you and {{ profile.name }} yet.</p>
      <ul v-else class="history">
        <li v-for="h in history" :key="h.hash">
          <span class="dir" :class="h.incoming ? 'in' : 'out'">{{ h.incoming ? '←' : '→' }}</span>
          <span class="value">{{ h.incoming ? '+' : '−' }}{{ h.valueNim }} NIM</span>
          <span class="when">{{ new Date(h.timestamp * (h.timestamp < 1e12 ? 1000 : 1)).toLocaleDateString() }}</span>
        </li>
      </ul>
    </ActionSheet>
  </div>
</template>

<style scoped>
.profile { display: flex; flex-direction: column; gap: 16px; }
.head { padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.name { font-size: 24px; margin: 4px 0 0; display: flex; align-items: center; gap: 8px; }
.star { background: none; border: none; font-size: 24px; color: var(--text-2); cursor: pointer; min-width: 44px; min-height: 44px; }
.star.on { color: var(--nq-gold); }
.address {
  background: none; border: none; cursor: pointer; color: var(--text-2);
  font-family: monospace; font-size: 13px; line-height: 1.5; word-break: break-all; padding: 4px;
}
.copy-hint { display: block; font-family: 'Mulish', sans-serif; font-size: 11px; color: var(--nq-light-blue); }
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.tag { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 3px 10px; font-size: 12px; }
.meta { font-size: 12px; color: var(--text-2); }
.actions { display: flex; gap: 10px; }
.actions.future { opacity: 0.45; }
.action {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 4px; min-height: 64px; font-size: 20px;
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); cursor: pointer; box-shadow: var(--shadow);
}
.action span { font-size: 12px; font-weight: 700; }
.action:disabled { cursor: default; }
.action.live:active { transform: scale(0.97); }
.own-qr { padding: 24px; text-align: center; }
.notes { padding: 16px 20px; }
.notes h2 { font-size: 14px; color: var(--text-2); margin: 0 0 6px; }
.notes p { margin: 0; white-space: pre-wrap; }
.manage { display: flex; justify-content: center; gap: 24px; }
.link { background: none; border: none; color: var(--nq-light-blue); font-weight: 700; cursor: pointer; min-height: 44px; }
.link.danger { color: var(--nq-red); }
.amount-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 12px; }
.amount-label input {
  font: inherit; font-size: 24px; padding: 10px 12px; text-align: center;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text);
}
.primary {
  width: 100%; height: 48px; border: none; border-radius: 24px; cursor: pointer;
  font-weight: 700; font-size: 16px; color: #fff; margin-top: 12px;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
}
.primary:disabled { opacity: 0.5; }
.ok { color: var(--nq-green); font-weight: 700; }
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.history { list-style: none; margin: 0; padding: 0; }
.history li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.dir.in { color: var(--nq-green); }
.dir.out { color: var(--nq-red); }
.value { flex: 1; font-weight: 700; }
.when { color: var(--text-2); font-size: 13px; }
</style>
```

- [ ] **Step 4: ProfileDetailsPage**

`src/pages/ProfileDetailsPage.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import ProfileView from '../components/ProfileView.vue'

const route = useRoute()
const router = useRouter()
const store = useProfilesStore()

onMounted(() => store.load())
const profile = computed(() => store.getById(route.params.id as string))

async function remove() {
  if (!profile.value) return
  if (!confirm(`Delete ${profile.value.name}?`)) return
  await store.remove(profile.value.id)
  router.replace('/')
}
</script>

<template>
  <div class="page">
    <button type="button" class="back" @click="router.back()">‹ Back</button>
    <ProfileView
      v-if="profile"
      :profile="profile"
      @edit="router.push(`/edit/${profile!.id}`)"
      @remove="remove"
    />
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.back { background: none; border: none; color: var(--nq-light-blue); font-size: 16px; padding: 8px 8px 12px 0; cursor: pointer; }
</style>
```

- [ ] **Step 5: Verify manually**

Run: `npm run dev`.
- Details page shows rich header (identicon, name, star toggle, full address with tap-to-copy, tags, added date), live action row, greyed future row (Invoice / Split Bill / Tip / Message), notes card, Edit/Delete.
- Send sheet in browser shows "Open NimConnect inside Nimiq Pay…" (correct fallback).
- Request sheet: amount changes the QR live; copy link works; Recent section on home now shows this contact (touchInteraction fired).
- History sheet: with no self profile shows the connect hint; with a seeded self profile (`await s.ensureSelf('NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN')` in console) it queries the RPC — mainnet addresses with real history show entries.
- Delete confirms and returns home.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: profile details with live send, request, history actions"
```

---

### Task 12: My Profile page and Settings

**Files:**
- Modify: `src/pages/MyProfilePage.vue`, `src/pages/SettingsPage.vue`

**Interfaces:**
- Consumes: `ProfileView` with `own` flag, store `self`/`ensureSelf`/`exportDocument`/`importDocument`, `getMyAddress`.

- [ ] **Step 1: MyProfilePage**

`src/pages/MyProfilePage.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { getMyAddress } from '../services/nimiq'
import ProfileView from '../components/ProfileView.vue'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()
const store = useProfilesStore()
const checking = ref(true)

onMounted(async () => {
  await store.load()
  if (!store.self) {
    const address = await getMyAddress()
    if (address) await store.ensureSelf(address)
  }
  checking.value = false
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Profile</h1>
      <router-link to="/settings" class="settings-link" aria-label="Settings">⚙</router-link>
    </header>

    <p v-if="checking" class="hint">Connecting…</p>

    <ProfileView
      v-else-if="store.self"
      :profile="store.self"
      own
      @edit="router.push(`/edit/${store.self!.id}`)"
    />

    <EmptyState
      v-else
      icon="🪪"
      title="No wallet connected"
      hint="Open NimConnect inside Nimiq Pay to create your profile."
    />
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.header { display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 28px; margin: 8px 0 12px; }
.settings-link { font-size: 22px; text-decoration: none; color: var(--text-2); min-width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center; }
.hint { color: var(--text-2); }
</style>
```

- [ ] **Step 2: SettingsPage**

`src/pages/SettingsPage.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'

const router = useRouter()
const store = useProfilesStore()
const message = ref('')
const fileInput = ref<HTMLInputElement>()

function exportJson() {
  const doc = store.exportDocument()
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nimconnect-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function importJson(event: Event) {
  message.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const doc = JSON.parse(await file.text())
    const { added, skipped } = await store.importDocument(doc)
    message.value = `Imported ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate/invalid` : ''}.`
  } catch {
    message.value = 'That file is not a valid NimConnect export.'
  }
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <div class="page">
    <button type="button" class="back" @click="router.back()">‹ Back</button>
    <h1>Settings</h1>

    <div class="card group">
      <h2>Backup</h2>
      <button class="item" @click="exportJson">⬇ Export contacts (JSON)</button>
      <button class="item" @click="fileInput?.click()">⬆ Import contacts (JSON)</button>
      <input ref="fileInput" type="file" accept="application/json" hidden @change="importJson" />
      <p v-if="message" class="message">{{ message }}</p>
    </div>

    <div class="card group">
      <h2>About</h2>
      <p class="about">
        NimConnect — a relationship manager for your wallet.<br />
        Version 0.1.0 · Built for the Nimiq Pay Mini App competition.
      </p>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.back { background: none; border: none; color: var(--nq-light-blue); font-size: 16px; padding: 8px 8px 12px 0; cursor: pointer; }
h1 { font-size: 28px; margin: 0 0 16px; }
.group { padding: 16px 20px; margin-bottom: 16px; }
.group h2 { font-size: 14px; color: var(--text-2); margin: 0 0 8px; }
.item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 12px 0; min-height: 44px; font: inherit; font-weight: 600;
  color: var(--text); cursor: pointer; border-bottom: 1px solid var(--border);
}
.item:last-of-type { border-bottom: none; }
.message { color: var(--nq-green); font-size: 14px; }
.about { color: var(--text-2); font-size: 14px; line-height: 1.6; margin: 0; }
</style>
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`.
- Profile tab in browser (no wallet): "No wallet connected" empty state. Seed self via console → rerun: own profile with QR card, no favorite star, no delete, edit works.
- Settings: export downloads a JSON with `app/version/exportedAt/profiles`; re-import reports "skipped N duplicate"; import into a cleared DB restores contacts.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: own profile with share QR, settings with import/export"
```

---

### Task 13: Polish pass, full verification, README

**Files:**
- Modify: `index.html` (meta), any rough edges found
- Create: `README.md`

- [ ] **Step 1: Mobile/meta polish**

In `index.html` `<head>`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#1f2348" />
<title>NimConnect</title>
```

- [ ] **Step 2: Full manual sweep (mobile viewport in devtools)**

Checklist — fix anything that fails, matching existing styles:
- All touch targets ≥ 44px; no horizontal scroll at 360px width.
- Dark mode: toggle `prefers-color-scheme` in devtools — every page legible.
- Empty states: fresh profile (clear IndexedDB) shows friendly empty contacts + profile pages.
- Add → details → edit → delete round trip; search from home; Recent appears after using Request.
- Reload persistence.

- [ ] **Step 3: Full test + build gate**

Run: `npm run test && npx vue-tsc --noEmit && npm run build`
Expected: all tests pass, no type errors, production build succeeds.

- [ ] **Step 4: README**

`README.md`:

```markdown
# NimConnect

A relationship manager for your wallet — a Nimiq Pay Mini App.

People don't remember addresses; they remember people. NimConnect turns every
wallet address into a Profile: avatar (Nimiq identicon), name, tags, notes —
with live **Send**, **Request payment**, and **payment History** built on the
Nimiq Pay Mini App SDK.

## Features

- 👥 Profiles with identicons, favorites, tags, private notes
- 🔍 Smart search across name, address, notes, tags
- 🕘 Recent / Favorites / All sections
- 💸 Send NIM (inside Nimiq Pay), 📥 request via `nimiq:` link + QR
- 📷 Add contacts by QR scan, share your own profile QR
- 💾 Local-first: IndexedDB, works offline, JSON import/export
- 🌗 Light/dark, mobile-first, no backend

## Development

```bash
npm install
npm run dev     # plain-browser mode: everything works except live Send
npm run test    # vitest unit tests
npm run build
```

## Architecture

One Pinia store (`src/stores/profiles.ts`) is the app's API, write-through to
Dexie (`src/db`). Services isolate IO: `nimiq.ts` (Mini App SDK), `links.ts`
(request links), `history.ts` (chain history). `ProfileView` renders any
profile — yours or a contact's — so future features (messaging, invoices,
reputation) attach to Profiles, not new modules.
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: polish pass, meta tags, README"
```
