# Admin Handle Directory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an admin-session-protected directory of all currently active handles to the existing admin stats page.

**Architecture:** Copy and alphabetically sort the current winning claims from `HandleRegistry`, expose them through a dedicated authenticated endpoint, and load the snapshot beside stats. The Vue page performs small client-side handle/address filtering and presents public-profile and transaction links.

**Tech Stack:** Go standard library HTTP/JSON, Vue 3, TypeScript, Vitest.

---

### Task 1: Registry snapshot and authenticated endpoint

**Files:**
- Modify: `backend/handles_registry.go`
- Modify: `backend/stats.go`
- Modify: `backend/main.go`
- Test: `backend/handles_registry_test.go`
- Test: `backend/stats_test.go`

**Step 1: Write failing registry and handler tests**

Add a registry test that rebuilds claims in non-alphabetical order, includes a
valid release/reclaim, calls `Claims()`, and asserts:

```go
claims := registry.Claims()
if len(claims) != 2 || claims[0].Handle != "alice" || claims[1].Handle != "chuck" {
	t.Fatalf("claims = %+v", claims)
}
```

Mutate the returned slice and assert a second `Claims()` call is unchanged.

Add `TestAdminHandlesHandler` covering:

- no session returns `401`;
- a valid session returns `200` and alphabetically sorted current claims; and
- a nil registry returns `{"handles":[]}`.

**Step 2: Run focused tests and verify RED**

Run:

```bash
cd backend && go test ./... -run 'TestHandleRegistryClaims|TestAdminHandlesHandler'
```

Expected: compile failure because `Claims` and `adminHandlesHandler` do not
exist.

**Step 3: Implement the minimal backend**

Add a read-locked method:

```go
func (r *HandleRegistry) Claims() []HandleClaim {
	r.mu.RLock()
	defer r.mu.RUnlock()
	claims := make([]HandleClaim, 0, len(r.handles))
	for _, claim := range r.handles {
		claims = append(claims, claim)
	}
	sort.Slice(claims, func(i, j int) bool {
		return claims[i].Handle < claims[j].Handle
	})
	return claims
}
```

Add a handler that validates `X-Admin-Session`, initializes an empty
`[]HandleClaim`, replaces it with `registry.Claims()` when non-nil, and encodes
`{"handles": claims}`. Register it unconditionally at
`GET /api/admin/handles` so disabled registries return an authenticated empty
list.

**Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd backend && go test ./... -run 'TestHandleRegistryClaims|TestAdminHandlesHandler'
```

Expected: PASS.

**Step 5: Commit**

```bash
git add backend/handles_registry.go backend/handles_registry_test.go backend/stats.go backend/stats_test.go backend/main.go
git commit -m "feat: add authenticated handle directory endpoint"
```

### Task 2: Typed frontend service

**Files:**
- Modify: `src/services/adminAuth.ts`
- Test: `src/services/adminAuth.test.ts`

**Step 1: Write failing service tests**

Add a successful request test that stores a session, returns two handle
fixtures, calls `fetchAdminHandles()`, and asserts the result plus:

```ts
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining('/api/admin/handles'),
  expect.objectContaining({ headers: { 'X-Admin-Session': 'tok-handles' } }),
)
```

Add a `401` test asserting the stored session is cleared and
`AdminSessionExpiredError` is thrown.

**Step 2: Run the service test and verify RED**

Run:

```bash
npx vitest run src/services/adminAuth.test.ts
```

Expected: compile/runtime failure because `fetchAdminHandles` is not exported.

**Step 3: Implement the typed service**

Add:

```ts
export interface AdminHandle {
  handle: string
  address: string
  tx_hash: string
  claimed_at: number
}
```

Implement `fetchAdminHandles(): Promise<AdminHandle[]>` against
`apiUrl('/api/admin/handles')`, using the same stored-session header and `401`
behavior as `fetchStats`.

**Step 4: Run the service test and verify GREEN**

Run:

```bash
npx vitest run src/services/adminAuth.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/adminAuth.ts src/services/adminAuth.test.ts
git commit -m "feat: add admin handle directory client"
```

### Task 3: Searchable current-handles section

**Files:**
- Modify: `src/pages/AdminStatsPage.vue`
- Test: `src/pages/AdminStatsPage.test.ts`

**Step 1: Write failing page tests**

Extend mocks with `fetchAdminHandles`. In the loaded-state test, return claims
for `alice` and `chuck` and assert:

- `Current handles (2)` is present;
- rows are rendered in service order;
- `/u/alice` and the transaction explorer URL are linked; and
- full addresses/hashes are retained in `title` attributes.

Add a filtering test that enters `chuck`, then an address fragment, and sees
only the matching row. Add empty-registry and no-search-match assertions.

**Step 2: Run the page test and verify RED**

Run:

```bash
npx vitest run src/pages/AdminStatsPage.test.ts
```

Expected: assertions fail because the handle section is absent.

**Step 3: Implement the page**

Load stats and handles together with `Promise.all`. Keep the existing reconnect
and retry state behavior for either failure.

Add a case-insensitive computed filter over handle and whitespace-compacted
address. Render a separate section with a search input, alphabetical table,
public profile links, transaction links, formatted UTC dates, and the two
empty states from the design.

Use the existing theme variables and table styling. Add responsive overflow to
the directory table rather than changing the admin shell width.

**Step 4: Run focused frontend tests and verify GREEN**

Run:

```bash
npx vitest run src/services/adminAuth.test.ts src/pages/AdminStatsPage.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/pages/AdminStatsPage.vue src/pages/AdminStatsPage.test.ts
git commit -m "feat: show current handles in admin stats"
```

### Task 4: Full verification and integration

**Files:**
- Verify all modified files

**Step 1: Format and run backend tests**

```bash
cd backend
gofmt -w handles_registry.go handles_registry_test.go stats.go stats_test.go main.go
go test ./...
```

Expected: PASS.

**Step 2: Run the root frontend tests**

```bash
npx vitest run --passWithNoTests --exclude '.worktrees/**'
```

Expected: 77 test files and 0 failures.

**Step 3: Build**

```bash
npm run build
```

Expected: PASS.

**Step 4: Inspect**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors or uncommitted implementation files.
