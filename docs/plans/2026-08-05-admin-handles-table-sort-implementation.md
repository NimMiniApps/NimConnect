# Admin Handles Table Sort Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add client-side column sorting to the Current handles table on Admin · Stats, defaulting to newest Claimed first.

**Architecture:** Keep search and sort entirely in `AdminStatsPage.vue`. Extend the existing `filteredHandles` computed to filter first, then sort by `sortKey` / `sortDir`. Make table headers interactive buttons with `aria-sort` and a subtle ↑/↓ marker. No backend or API changes.

**Tech Stack:** Vue 3, TypeScript, Vitest, `@vue/test-utils`.

**Design:** `docs/plans/2026-08-05-admin-handles-table-sort-design.md`

---

### Task 1: Failing page tests for default + toggle sort

**Files:**
- Modify: `src/pages/AdminStatsPage.test.ts`
- Modify: `src/pages/AdminStatsPage.vue` (later task)

**Step 1: Extend the fixture handles and write failing tests**

In `AdminStatsPage.test.ts`, ensure the shared `handles` fixture has distinct
`claimed_at` values (already true: alice Jul 21, chuck Jul 22). Add a third
handle so alphabetical vs claimed order clearly diverge:

```ts
const handles = [
  {
    handle: 'chuck',
    address: 'NQ22 CHUCK WALLET',
    tx_hash: 'chuck-tx',
    claimed_at: Date.UTC(2026, 6, 22),
  },
  {
    handle: 'alice',
    address: 'NQ11 ALICE WALLET',
    tx_hash: 'alice-tx',
    claimed_at: Date.UTC(2026, 6, 21),
  },
  {
    handle: 'bob',
    address: 'NQ33 BOB WALLET',
    tx_hash: 'bob-tx',
    claimed_at: 0,
  },
]
```

Update any existing assertions that assumed API order (`alice` then `chuck`)
to use handle-name selectors instead of row index, or adjust expected order to
default Claimed desc: `chuck`, `alice`, `bob` (unknown last).

Add:

```ts
it('defaults current handles to claimed newest-first with unknown last', async () => {
  mocks.getSessionToken.mockReturnValue('tok')
  mocks.fetchStats.mockResolvedValue(summary)
  mocks.fetchAdminHandles.mockResolvedValue(handles)
  const wrapper = mount(AdminStatsPage)
  await flushPromises()
  expect(wrapper.findAll('[data-handle-row]').map(row => row.text())).toEqual([
    expect.stringContaining('@chuck'),
    expect.stringContaining('@alice'),
    expect.stringContaining('@bob'),
  ])
})

it('toggles claimed sort and sorts by handle', async () => {
  mocks.getSessionToken.mockReturnValue('tok')
  mocks.fetchStats.mockResolvedValue(summary)
  mocks.fetchAdminHandles.mockResolvedValue(handles)
  const wrapper = mount(AdminStatsPage)
  await flushPromises()

  await wrapper.get('[data-sort="claimed"]').trigger('click')
  expect(wrapper.findAll('[data-handle-row]').map(row => row.text())).toEqual([
    expect.stringContaining('@alice'),
    expect.stringContaining('@chuck'),
    expect.stringContaining('@bob'),
  ])

  await wrapper.get('[data-sort="handle"]').trigger('click')
  expect(wrapper.findAll('[data-handle-row]').map(row => row.text())).toEqual([
    expect.stringContaining('@alice'),
    expect.stringContaining('@bob'),
    expect.stringContaining('@chuck'),
  ])

  await wrapper.get('[data-sort="handle"]').trigger('click')
  expect(wrapper.findAll('[data-handle-row]').map(row => row.text())).toEqual([
    expect.stringContaining('@chuck'),
    expect.stringContaining('@bob'),
    expect.stringContaining('@alice'),
  ])
})

it('applies search before sort', async () => {
  mocks.getSessionToken.mockReturnValue('tok')
  mocks.fetchStats.mockResolvedValue(summary)
  mocks.fetchAdminHandles.mockResolvedValue(handles)
  const wrapper = mount(AdminStatsPage)
  await flushPromises()

  await wrapper.get('[data-handle-search]').setValue('a')
  // alice + (optionally others containing "a"); with this fixture: alice only
  // if "a" matches alice; chuck has no "a". bob has no "a".
  expect(wrapper.findAll('[data-handle-row]').map(row => row.text())).toEqual([
    expect.stringContaining('@alice'),
  ])

  await wrapper.get('[data-handle-search]').setValue('')
  await wrapper.get('[data-sort="handle"]').trigger('click')
  await wrapper.get('[data-handle-search]').setValue('c')
  expect(wrapper.findAll('[data-handle-row]').map(row => row.text())).toEqual([
    expect.stringContaining('@chuck'),
  ])
})
```

**Step 2: Run tests and verify RED**

Run:

```bash
npm test -- src/pages/AdminStatsPage.test.ts
```

Expected: FAIL — default order still API/alphabetical; `[data-sort]` missing.

**Step 3: Commit failing tests only if preferred; otherwise proceed to Task 2**

Optional:

```bash
git add src/pages/AdminStatsPage.test.ts
git commit -m "test: cover admin handles table column sorting"
```

---

### Task 2: Implement client-side sort in AdminStatsPage

**Files:**
- Modify: `src/pages/AdminStatsPage.vue`
- Test: `src/pages/AdminStatsPage.test.ts`

**Step 1: Add sort state and helpers**

In `<script setup>`, add:

```ts
type SortKey = 'handle' | 'owner' | 'claimed' | 'transaction'
type SortDir = 'asc' | 'desc'

const sortKey = ref<SortKey>('claimed')
const sortDir = ref<SortDir>('desc')

function defaultDirFor(key: SortKey): SortDir {
  return key === 'claimed' || key === 'transaction' ? 'desc' : 'asc'
}

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortKey.value = key
  sortDir.value = defaultDirFor(key)
}

function compareHandles(a: AdminHandle, b: AdminHandle): number {
  const dir = sortDir.value === 'asc' ? 1 : -1
  if (sortKey.value === 'claimed') {
    const aUnknown = a.claimed_at <= 0
    const bUnknown = b.claimed_at <= 0
    if (aUnknown && bUnknown) return a.handle.localeCompare(b.handle)
    if (aUnknown) return 1
    if (bUnknown) return -1
    return (a.claimed_at - b.claimed_at) * dir
  }
  const field =
    sortKey.value === 'handle' ? a.handle
    : sortKey.value === 'owner' ? a.address
    : a.tx_hash
  const other =
    sortKey.value === 'handle' ? b.handle
    : sortKey.value === 'owner' ? b.address
    : b.tx_hash
  return field.localeCompare(other, undefined, { sensitivity: 'base' }) * dir
}
```

Replace `filteredHandles` so it filters, copies, then sorts:

```ts
const filteredHandles = computed(() => {
  const query = handleQuery.value.trim().toLowerCase()
  const compactQuery = query.replace(/\s+/g, '')
  let rows = handles.value
  if (query) {
    rows = rows.filter(claim =>
      claim.handle.toLowerCase().includes(query)
      || claim.address.toLowerCase().replace(/\s+/g, '').includes(compactQuery),
    )
  }
  return [...rows].sort(compareHandles)
})
```

**Step 2: Wire sortable headers in the template**

Replace the directory table header row with:

```html
<thead>
  <tr>
    <th
      v-for="col in [
        { key: 'handle', label: 'Handle' },
        { key: 'owner', label: 'Owner' },
        { key: 'claimed', label: 'Claimed' },
        { key: 'transaction', label: 'Transaction' },
      ] as const"
      :key="col.key"
      :aria-sort="sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'"
    >
      <button
        type="button"
        class="sort-button"
        :data-sort="col.key"
        @click="setSort(col.key)"
      >
        {{ col.label }}
        <span v-if="sortKey === col.key" class="sort-indicator" aria-hidden="true">
          {{ sortDir === 'asc' ? '↑' : '↓' }}
        </span>
      </button>
    </th>
  </tr>
</thead>
```

If the inline `v-for` array feels noisy, extract a `const sortColumns = [...] as const`
in script instead — either is fine.

**Step 3: Add minimal styles**

```css
.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
}
.sort-button:hover { color: var(--text); }
.sort-button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 4px;
}
.sort-indicator { font-size: 11px; opacity: 0.85; }
```

**Step 4: Run tests and verify GREEN**

Run:

```bash
npm test -- src/pages/AdminStatsPage.test.ts
```

Expected: PASS (update any leftover order-sensitive assertions from the old
alphabetical fixture order).

**Step 5: Commit**

```bash
git add src/pages/AdminStatsPage.vue src/pages/AdminStatsPage.test.ts
git commit -m "feat: sort admin handles table by column"
```

---

### Task 3: Smoke-check related admin tests

**Files:** none expected

**Step 1: Run adjacent frontend tests**

```bash
npm test -- src/pages/AdminStatsPage.test.ts src/components/AdminStatsChart.test.ts src/services/adminAuth.test.ts
```

Expected: PASS.

**Step 2: Manual check (optional)**

Open `/#/admin/stats`, sign in, confirm:

- Claimed shows ↓ by default and newest claims first
- Clicking Claimed flips to ↑ / oldest first (unknown still last)
- Handle / Owner / Transaction headers sort as expected
- Search still narrows the sorted list

---

## Done when

- [ ] Default order is Claimed newest-first, unknown last
- [ ] Column headers toggle / switch sort with indicators + `aria-sort`
- [ ] Search composes with sort
- [ ] `AdminStatsPage` tests pass
- [ ] No backend changes
