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
  following the existing `preferredCurrency` localStorage pattern.
- New service `src/services/activity.ts` with a pure function
  `newActivity({ payments, inboxItems, invoices, lastSeenAt, now })` returning
  `{ payments: IncomingPayment[], requests: InboxItem[], dueInvoices: Invoice[] }`:
  - payments / inbox requests with timestamp > `lastSeenAt`
  - pending invoices overdue or due within 48h (independent of `lastSeenAt`)
- HomePage renders a dismissible banner above the existing summary:
  "2 payments received · 1 new request · 1 invoice due". Entries navigate to
  the relevant contact/invoice; dismiss sets `lastSeenActivityAt = now`.
  Due-invoice entries reappear until the invoice is paid (they are not
  timestamp-gated) — the banner hides them for the session after dismiss.
- Data comes from the calls HomePage/inbox already make; no new polling loops.

## 2. Recurring invoice reminders

- `Invoice` gains `repeat?: 'weekly' | 'monthly'` (`src/types/profile.ts`).
  Not indexed → no Dexie version bump needed.
- In the invoices store, when `markPaid` settles an invoice with `repeat`,
  create the successor immediately: same address/amount/label, new id,
  `createdAt = now`, `dueAt = previous dueAt + interval` (or `now + interval`
  when the original had no due date). Reuses the existing `duplicate()` logic.
  Monthly = same day next month via `setMonth(+1)` (JS clamps overflow, e.g.
  Jan 31 → Mar 2/3; acceptable), weekly = +7 days.
- Guard: successor is only created by the mark-paid transition, so re-marking
  or reload cannot duplicate it.
- `InvoiceSheet.vue` gets a repeat `<select>` (none / weekly / monthly) next to
  the due-date input. Import/export (`fromRaw`-style parsing at
  `src/stores/invoices.ts:169`) passes the field through.
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
  - Pure aggregation `monthInsights(txs, profiles, month)`:
    total sent / received NIM, per-counterparty totals matched to contacts by
    compact address, totals grouped by contact tag, unmatched addresses lumped
    into "Others".
  - Results cached in localStorage (`nimconnect:insights` key, same
    best-effort pattern as history) so the page works offline.
- `InsightsPage.vue`: month switcher (prev/next), sent/received totals with
  fiat approximation, top 5 contacts by volume, by-tag bars in plain CSS.
  No chart library.

## Testing

Vitest units (existing patterns, fake-indexeddb where needed):

- `activity.test.ts` — cutoff filtering, due-within-48h/overdue selection.
- `invoices.test.ts` additions — successor creation on markPaid (interval
  math incl. month-end), no successor without `repeat`, no duplicate on
  double markPaid.
- `insights.test.ts` — dedupe, self-transfer exclusion, month boundaries,
  tag grouping, "Others" bucket.

UI verified by driving the app (`npm run dev`).

## Out of scope

- Real push notifications (needs host-app support or PWA install path).
- Automatic recurring *payments* (SDK requires user confirmation per send).
- Historical fiat rates.
- Charts on the insights page.
