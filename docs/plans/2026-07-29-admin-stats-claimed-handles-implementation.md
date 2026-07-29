# Claimed Handles Admin Stats Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an authoritative current claimed-handle total and daily claimed-handle counts to the admin stats API and page.

**Architecture:** Preserve each winning claim's RPC timestamp in `HandleRegistry`, then expose a read-locked aggregate of current handles by UTC claim day. Inject that aggregate into the existing stats handler, merge claim-only and usage-only dates, and extend the typed Vue API contract and table.

**Tech Stack:** Go standard library, JSON persistence, Nimiq JSON-RPC, Vue 3, TypeScript, Vitest.

---

### Task 1: Preserve and aggregate winning claim timestamps

**Files:**
- Modify: `backend/nimiq_rpc.go`
- Modify: `backend/handles_registry.go`
- Test: `backend/handles_registry_test.go`

**Step 1: Write the failing registry tests**

Add timestamps to the claim/release test helpers and add tests equivalent to:

```go
func TestHandleRegistryStatsFollowCurrentWinningClaims(t *testing.T) {
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 100)
	first := claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)
	first.Timestamp = time.Date(2026, 7, 20, 1, 0, 0, 0, time.UTC).UnixMilli()
	release := releaseTx("t2", "NQ11 OWNER", "chuck", 200, 0)
	reclaim := claimTx("t3", "NQ22 NEW", "chuck", 300, 0)
	reclaim.Timestamp = time.Date(2026, 7, 22, 1, 0, 0, 0, time.UTC).UnixMilli()
	alice := claimTx("t4", "NQ33 OWNER", "alice", 301, 0)
	alice.Timestamp = time.Date(2026, 7, 22, 2, 0, 0, 0, time.UTC).UnixMilli()

	if err := r.Rebuild([]rpcTx{first, release, reclaim, alice}); err != nil {
		t.Fatal(err)
	}
	got := r.Stats()
	if got.UniqueHandles != 2 || got.Days["2026-07-22"] != 2 {
		t.Fatalf("unexpected handle stats: %+v", got)
	}
}
```

Add a persistence assertion that `ClaimedAt` survives a `NewHandleRegistry`
reload, and a legacy-cache assertion that a zero timestamp still contributes
to `UniqueHandles` without creating a daily bucket.

**Step 2: Run the tests and verify RED**

Run:

```bash
cd backend && go test ./... -run 'TestHandleRegistryStats|TestHandleClaimTimestampPersistence'
```

Expected: compile failure because `rpcTx.Timestamp`, `HandleClaim.ClaimedAt`,
and `HandleRegistry.Stats` do not exist.

**Step 3: Implement the minimal registry support**

Add:

```go
Timestamp int64 `json:"timestamp"`
```

to `rpcTx`, and:

```go
ClaimedAt int64 `json:"claimed_at,omitempty"`
```

to `HandleClaim`. Copy `tx.Timestamp` into the winning claim during rebuild.

Add:

```go
type HandleStats struct {
	UniqueHandles int
	Days          map[string]int
}
```

and a read-locked `Stats()` method. Count every current map entry in
`UniqueHandles`; for positive millisecond timestamps, group with
`time.UnixMilli(claim.ClaimedAt).UTC().Format("2006-01-02")`.

**Step 4: Run the focused tests and verify GREEN**

Run:

```bash
cd backend && go test ./... -run 'TestHandleRegistryStats|TestHandleClaimTimestampPersistence'
```

Expected: PASS.

### Task 2: Merge handle metrics into the admin stats response

**Files:**
- Modify: `backend/stats.go`
- Modify: `backend/main.go`
- Test: `backend/stats_test.go`

**Step 1: Write failing summary and handler tests**

Extend `TestStatsRecordAndSummary` with an in-memory registry containing claims
on a usage day and a claim-only day. Assert:

```go
sum := s.Summary(registry.Stats())
if sum.UniqueHandles != 2 {
	t.Fatalf("unique handles = %d, want 2", sum.UniqueHandles)
}
// Assert the claim-only day exists with Wallets == 0, Opens == 0, Handles == 1.
```

Extend handler setup to pass a registry and decode the JSON response, asserting
`unique_handles` and `days[].handles`. Add a nil-registry handler case that
returns zero handle metrics.

**Step 2: Run the stats tests and verify RED**

Run:

```bash
cd backend && go test ./... -run 'TestStats|TestWithWalletStat'
```

Expected: compile failure because the response and handler signatures do not
yet accept handle stats.

**Step 3: Implement API merging**

Add `Handles int` to `daySummary` with JSON key `handles` and
`UniqueHandles int` to `statsSummary` with JSON key `unique_handles`.

Change `Summary` to accept `HandleStats`, seed/merge each claim day into the
same date-indexed output, and preserve ascending sort. Change `statsHandler`
to accept `*HandleRegistry`; use an empty `HandleStats` when it is nil.

Construct the registry before route registration in `main.go`, retain a nil
pointer when `REGISTRY_ADDRESS=off`, pass it to `statsHandler`, and keep
registry-specific routes inside the existing enabled block.

**Step 4: Run focused backend tests and verify GREEN**

Run:

```bash
cd backend && go test ./... -run 'TestStats|TestWithWalletStat'
```

Expected: PASS.

### Task 3: Extend the frontend API contract and page

**Files:**
- Modify: `src/services/adminAuth.ts`
- Modify: `src/services/adminAuth.test.ts`
- Modify: `src/pages/AdminStatsPage.vue`
- Modify: `src/pages/AdminStatsPage.test.ts`

**Step 1: Write failing frontend tests**

Change fixtures to include:

```ts
{
  unique_wallets: 12,
  unique_handles: 9,
  total_opens: 40,
  days: [
    { day: '2026-07-21', wallets: 5, opens: 15, handles: 4 },
    { day: '2026-07-22', wallets: 7, opens: 25, handles: 5 },
  ],
}
```

In `AdminStatsPage.test.ts`, assert the loaded page contains `Claimed handles`,
the value `9`, and one `Handles claimed` header. Assert the two daily rows
contain `4` and `5`.

In `adminAuth.test.ts`, assert a fetched typed summary exposes
`unique_handles`.

**Step 2: Run frontend tests and verify RED**

Run:

```bash
npx vitest run src/services/adminAuth.test.ts src/pages/AdminStatsPage.test.ts
```

Expected: page assertions fail because the new card and column are absent.

**Step 3: Implement the typed UI**

Add `handles: number` to `DayStats` and `unique_handles: number` to
`StatsSummary`.

Update the page description to `Daily unique wallets, app opens, and claimed
handles.` Add a third total card bound to `summary.unique_handles`, add the
`Handles claimed` header and `d.handles` cells, and use three equal columns in
the totals grid.

**Step 4: Run focused frontend tests and verify GREEN**

Run:

```bash
npx vitest run src/services/adminAuth.test.ts src/pages/AdminStatsPage.test.ts
```

Expected: PASS.

### Task 4: Full verification

**Files:**
- Verify all modified files

**Step 1: Format**

Run:

```bash
cd backend && gofmt -w nimiq_rpc.go handles_registry.go handles_registry_test.go stats.go stats_test.go main.go
```

**Step 2: Run the backend suite**

Run:

```bash
cd backend && go test ./...
```

Expected: PASS.

**Step 3: Run the frontend suite**

Run:

```bash
npm test
```

Expected: PASS.

**Step 4: Build the production frontend**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 5: Check the diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the claimed-handle implementation, plan,
and the user's pre-existing untracked `video/` directory are present.
