# Feedback fixes: notifications, recurring invoices, fiat history, insights

**Date:** 2026-07-13
**Status:** Approved

User feedback asked for push notifications, recurring payments, shareable links,
tx memos, fiat display, and spending insights. Share links
(`makePaymentShareLink`) and send memos (QuickSendSheet message field) already
exist. The remaining four are built here, each scoped to what a Nimiq Pay mini
app can actually do.

## 1. In-app notifications (Home banner)

No real push: no service worker, and the Nimiq Pay webview makes the
`Notification` API unreliable. The app is only alive when open, so a banner on
the Home page fed by the polling that already runs delivers the same value.

- New pref `lastSeenActivityAt` (number, ms) in `src/services/prefs.ts`,
  stored under `nimconnect:last-seen-activity:<sorted compact own-address
  set>` so a restored or switched wallet never inherits another identity's
  seen-state. **First run** (key absent): after the first successful data
  load, initialize to `Date.now()` — nothing pre-existing is flagged "new"
  (due invoices still show; they are not timestamp-gated).
- New service `src/services/activity.ts` with a pure function
  `newActivity({ payments, inboxItems, invoices, lastSeenAt, now })` returning
  `{ payments: IncomingPayment[], requests: InboxItem[], dueInvoices: Invoice[] }`:
  - payments / inbox requests with `timestampMs(item.timestamp) > lastSeenAt`
    — chain timestamps can arrive in seconds, so normalization through the
    existing `timestampMs()` (`src/services/history.ts:51`) is mandatory
  - pending invoices overdue or due within 48h (independent of `lastSeenAt`)
- HomePage renders a dismissible banner above the existing summary:
  "2 payments received · 1 new request · 1 invoice due". Dismiss sets
  `lastSeenActivityAt = now`. Due-invoice entries reappear until the invoice
  is paid — the banner hides them for the session after dismiss.
- **Navigation:** payment/request entries go to the matching contact's
  `/profile/:id`. Invoice entries go to `/profile/:id?sheet=invoice` — the
  profile is looked up by the invoice's address, and `ProfileView` opens the
  invoice sheet when that query param is present (new, small). When no
  contact matches the address, the entry doesn't navigate; Home's existing
  pending-invoice list already shows it.
- Data comes from the calls HomePage/inbox already make; no new polling loops.

## 2. Recurring invoice reminders

- `Invoice` gains `repeat?: 'weekly' | 'monthly'` and
  `successorInvoiceId?: string` (`src/types/profile.ts`). Neither is indexed
  → no Dexie version bump needed.
- Today's only transition is `setStatus(id, status)`, called from
  `src/pages/HomePage.vue:372,393` and `src/components/InvoiceSheet.vue:160`
  (which also toggles paid → pending). New store API **`markPaid(id)`**, one
  Dexie `'rw'` transaction on `invoices`:
  1. read source; if already `paid` → no-op
  2. write `status: 'paid'`, `paidAt`
  3. if `repeat` set and `successorInvoiceId` absent: create the successor
     (same address/amount/description/repeat, new id) and persist its id as
     `successorInvoiceId` on the source — same transaction
  Atomicity makes it safe: two racing calls or a crash mid-transition can't
  create zero or two successors. Toggling back to pending keeps
  `successorInvoiceId`, so re-marking paid never duplicates. The two "mark
  paid" UI call sites switch to `markPaid`; the sheet's paid → pending toggle
  stays on `setStatus`.
- Successor `dueAt`: advanced **once** from the previous `dueAt` (or from
  `paidAt` when the original had no due date). Weekly = +7 days. Monthly =
  next calendar month **clamped to its last day** (Jan 31 → Feb 28/29) via a
  small `addMonthClamped()` helper — JS `setMonth(+1)` overflows into March
  and would skip a cycle. An invoice paid long after its due date may thus
  produce an already-overdue successor; that's intended — the cadence stays
  anchored to the original schedule and the banner surfaces it.
- `InvoiceSheet.vue` gets a repeat `<select>` (none / weekly / monthly) next
  to the due-date input. The inline import parsing
  (`src/stores/invoices.ts:136` area) passes both new fields through.
- No scheduler: a new reminder only matters once the previous invoice is
  settled, and the due-soon banner (feature 1) surfaces it from then on.

## 3. Fiat on history rows

- `ProfileView.vue` history list shows `≈ 1.23 €` next to each NIM amount,
  using the already-loaded `rates` + `nimToFiat` + `preferredCurrency`
  (the component fetches rates for the net-balance line today).
- Today's rate, not historical — labeled with `≈`. Historical rates would need
  new backend data for questionable ROI; explicitly out of scope.
- Hidden when `preferredCurrency` is NIM or rates are unavailable.

## 4. Insights page

- New route `/insights` in `src/router.ts` + nav entry alongside existing ones.
- New service `src/services/insights.ts`:
  - Fetch: one `fetchTransactionsByAddress` per own address (via
    `expandMyAddresses`, same as `fetchIncomingPayments`), both directions,
    deduped by hash. Self-transfers (both sides own) excluded.
  - **Coverage boundary:** the RPC call caps at 200 txs per address with no
    pagination. When any address returns a full page, the boundary is the
    oldest fetched timestamp; the month switcher does not navigate past it
    and the page shows "history before <date> not available". No pagination
    in v1 (YAGNI — revisit if users hit the cap).
  - **Cache:** raw transactions (not aggregates) in localStorage under
    `nimconnect:insights-txs:<sorted compact own-address set>`, same
    best-effort pattern as history. Keying by address set prevents one
    wallet's figures showing for another; caching raw txs means aggregation
    always runs against live profiles/tags, so contact edits need no cache
    invalidation.
  - Pure aggregation `monthInsights(txs, profiles, month)`:
    total sent / received NIM, per-counterparty totals matched to contacts by
    compact address, unmatched addresses lumped into "Others".
  - **Tag grouping:** a multi-tagged contact counts fully under *each* of its
    tags; tag rows overlap by design and are presented as independent bars,
    never summed to a total. Untagged contacts group under "Untagged".
- `InsightsPage.vue`: month switcher (prev/next, floored at the coverage
  boundary), sent/received totals with fiat approximation, top 5 contacts by
  volume, by-tag bars in plain CSS. No chart library.

## Testing

Vitest units (existing patterns, fake-indexeddb where needed):

- `activity.test.ts` — cutoff filtering with seconds- and ms-based
  timestamps, due-within-48h/overdue selection, first-run initialization.
- `invoices.test.ts` additions — successor creation on `markPaid`
  (`addMonthClamped` incl. Jan 31 → Feb 28/29, weekly), no successor without
  `repeat`, no duplicate on double/concurrent `markPaid` or after a
  pending-toggle round trip.
- `insights.test.ts` — dedupe, self-transfer exclusion, month boundaries,
  overlapping tag grouping, "Others"/"Untagged" buckets, coverage-boundary
  detection at a full 200-tx page.

UI verified by driving the app (`npm run dev`).

## Out of scope

- Real push notifications (needs host-app support or PWA install path).
- Automatic recurring *payments* (SDK requires user confirmation per send).
- Historical fiat rates.
- Charts on the insights page.
