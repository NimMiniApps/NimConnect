# Create Profile Deep Link Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one canonical create-profile deep link that works in a browser and when opening NimConnect through Nimiq Pay.

**Architecture:** A semantic Vue Router entry route redirects to the existing `/me?sheet=claim` behavior, avoiding a second identity flow. Central URL constants expose browser and Nimiq Pay variants, and the existing public-profile CTA consumes the Nimiq Pay variant.

**Tech Stack:** Vue 3, Vue Router 4, TypeScript, Vitest

---

### Task 1: Define and verify the canonical URLs

**Files:**
- Modify: `src/config/host-app.ts`
- Test: `src/config/host-app.test.ts`

**Step 1: Write the failing test**

Add assertions that `CREATE_PROFILE_URL` equals the public app origin plus
`/#/create-profile`, and `NIMPAY_CREATE_PROFILE_URL` equals `NIMPAY_OPEN_URL`
plus `#/create-profile`.

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/config/host-app.test.ts`

Expected: FAIL because the constants are not exported.

**Step 3: Write the minimal implementation**

Export both constants from `src/config/host-app.ts`, deriving the Nimiq Pay
variant from `NIMPAY_OPEN_URL` and the browser variant from the configured mini
app domain.

**Step 4: Run the test to verify it passes**

Run: `npm test -- src/config/host-app.test.ts`

Expected: PASS.

### Task 2: Add the semantic entry route

**Files:**
- Modify: `src/router.ts`
- Test: `src/router.test.ts`

**Step 1: Write the failing test**

Resolve `/create-profile` through the router and assert that its redirected
location is `/me?sheet=claim`.

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/router.test.ts`

Expected: FAIL because `/create-profile` currently falls through to Home.

**Step 3: Write the minimal implementation**

Add `/create-profile` before the catch-all route with a redirect object whose
path is `/me` and whose query is `{ sheet: 'claim' }`.

**Step 4: Run the test to verify it passes**

Run: `npm test -- src/router.test.ts`

Expected: PASS.

### Task 3: Use the canonical acquisition link

**Files:**
- Modify: `src/components/PublicProfileLanding.vue`
- Test: `src/components/PublicLandings.test.ts`

**Step 1: Write the failing test**

Mount `PublicProfileLanding` and assert the “Claim your own @handle” anchor uses
`NIMPAY_CREATE_PROFILE_URL`.

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: FAIL because the component still hand-assembles the old internal URL.

**Step 3: Write the minimal implementation**

Import `NIMPAY_CREATE_PROFILE_URL` and bind it directly to the claim CTA.

**Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: PASS.

### Task 4: Verify the complete change

**Files:**
- Verify only

**Step 1: Run focused tests together**

Run: `npm test -- src/config/host-app.test.ts src/router.test.ts src/components/PublicLandings.test.ts`

Expected: PASS.

**Step 2: Run the frontend verification gate**

Run: `npm test`

Expected: all tests pass with no unhandled errors.

Run: `npm run build`

Expected: production build succeeds.

**Step 3: Review the diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; the unrelated `security_best_practices_report.md`
remains unstaged and unchanged.
