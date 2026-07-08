# Activity Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Activity view and contact dashboard that expose pending invoices across all contacts.

**Architecture:** Keep the data source in `src/stores/invoices.ts`, adding computed summaries over existing invoice records. The Activity page composes invoices with profiles by address, reusing `makeRequestLink` for copyable payment links and existing store mutations for paid/delete actions.

**Tech Stack:** Vue 3, Pinia, Vue Router, Dexie, Vitest.

---

### Task 1: Invoice Summary Getters

**Files:**
- Modify: `src/stores/invoices.ts`
- Test: `src/stores/invoices.test.ts`

**Steps:**
1. Write a failing test proving the store exposes pending invoices newest first and totals pending NIM.
2. Run `npx vitest run src/stores/invoices.test.ts` and confirm the new test fails because the getters do not exist.
3. Add `pending`, `pendingTotalNim`, and `pendingByAddress(address)` computed/store functions.
4. Run `npx vitest run src/stores/invoices.test.ts` and confirm it passes.

### Task 2: Activity Page

**Files:**
- Create: `src/pages/ActivityPage.vue`
- Modify: `src/router.ts`
- Modify: `src/App.vue`

**Steps:**
1. Create an Activity route at `/activity`.
2. Replace the middle bottom-nav Split action with an Activity link.
3. Build a pending invoice list with copy link, mark paid, delete, and contact shortcut.
4. Add an empty state with useful actions.

### Task 3: Contacts Dashboard And Badges

**Files:**
- Modify: `src/pages/ContactsPage.vue`
- Modify: `src/components/ProfileRow.vue`

**Steps:**
1. Load invoice data alongside profiles on Contacts.
2. Add a compact dashboard above list sections.
3. Pass pending invoice count into profile rows.
4. Render a stable badge that does not resize the row awkwardly.

### Task 4: Verification

**Commands:**
- `npm run test`
- `npm run build`

**Manual checks:**
- Contacts shows pending totals when invoices exist.
- Activity lists pending invoices and can mark them paid.
- Bottom nav highlights Contacts, Activity, and Profile correctly.
