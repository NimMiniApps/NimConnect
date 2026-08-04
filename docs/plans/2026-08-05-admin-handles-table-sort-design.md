# Admin Handles Table Sort

## Goal

Make the Current handles table on Admin · Stats sortable by column so an
administrator can order claims by claimed date (and other fields) without
leaving the page.

## Scope

In scope:

- Client-side sorting on the Current handles table only
- Columns: Handle, Owner, Claimed, Transaction
- Compose with the existing client-side search filter

Out of scope:

- Sorting the daily stats table
- URL/query persistence of sort state
- Backend sort parameters or API changes
- Pagination

## Behavior

- Default sort: Claimed descending (newest first)
- Clicking the active column toggles ascending / descending
- Clicking a different column switches to that column with:
  - ascending for Handle and Owner
  - descending for Claimed and Transaction
- Search filters first; sort applies to the filtered list
- Unknown claim timestamps (`claimed_at <= 0`) sort last when Claimed is the
  active column, regardless of direction
- Comparators:
  - Handle / Owner / Transaction: case-insensitive string compare
  - Claimed: numeric `claimed_at`

## Frontend

All logic lives in `AdminStatsPage.vue`.

- `sortKey` and `sortDir` refs drive the table
- The existing `filteredHandles` computed becomes filter → then sort
- Table headers become focusable buttons
- Active column shows a subtle ↑ / ↓ marker
- Active column sets `aria-sort` to `ascending` or `descending`; inactive
  columns use `none` (or omit)

No changes to `adminAuth`, the admin handles endpoint, or the handle registry
sort used for the API response (alphabetical remains the server default).

## Verification

Extend `AdminStatsPage.test.ts` to cover:

- Default order is Claimed newest-first
- Clicking Claimed toggles to oldest-first
- Clicking Handle sorts A→Z (and toggle Z→A)
- Search + sort compose (filter first, then sort)

## Persistence note

Wallet / open stats remain Postgres-backed (`stats_days`,
`stats_day_wallets`). Claimed handles remain registry-backed. This design does
not change persistence.
