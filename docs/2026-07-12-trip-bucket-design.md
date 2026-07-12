# Trip Bucket — Design (v1)

**Date:** 2026-07-12
**Status:** Approved

## Idea

A shared savings goal ("bucket") for a group trip. The organizer creates a
bucket with a name and a NIM goal, shares a pay link/QR, and friends send
money over time. The bucket shows progress toward the goal and who
contributed what.

## Constraints that shaped the design

- NimConnect is a Nimiq Pay mini app: it can only receive on the organizer's
  existing wallet account. It cannot mint a fresh address per bucket, so
  contributions land in the organizer's normal wallet mixed with other
  payments.
- Therefore progress is **not** an address balance. Contributions are
  identified by a tag embedded in the payment message of the share link, and
  counted from incoming transaction history (already fetched and cached for
  invoice detection).
- Custody: the organizer's wallet holds the funds. Same trust model as
  splits — everyone trusts the organizer to book the trip.

## Data model

Dexie **v4 migration** adds a `buckets` table (`id, status`).

```ts
interface BucketContribution {
  amountNim: number
  sender?: string   // Nimiq address when known
  at: number        // epoch ms
}

interface Bucket {
  id: string                 // uuid; a short form of it is the payment-message tag
  name: string               // "Barcelona 2026"
  goalNim: number
  fiatGoal?: number          // display only, like invoices
  fiatCurrency?: string
  status: 'active' | 'completed'
  createdAt: number
  completedAt?: number
  manualContributions: BucketContribution[]
}
```

## Contribution tracking

- Share link/QR: existing `makePaymentShareLink(myAddress, undefined, message)`
  with **no fixed amount** and message `"🪣 <name> #<short-id>"` where
  `<short-id>` is the first 8 hex chars of the bucket id.
- Matching: a pure function `matchContributions(buckets, payments)` beside
  `matchPayments` in the invoices store area — sums `fetchIncomingPayments`
  results whose message contains `#<short-id>`, newest data wins, plus
  `manualContributions`.
- Payments that lost the tag (payer edited the message): organizer adds them
  via a **manual add contribution** action on the bucket sheet (amount +
  optional contact), mirroring how invoices can be manually marked paid.
- Contributor display: sender addresses resolve to names through the existing
  profiles store; unknown senders show a short address.
- `classifyScan` gains a `bucket` request type (message starts with `🪣`) so
  scanning a bucket QR opens the pay sheet with message pre-filled.

## UI

- **BucketSheet.vue** — one sheet modeled on `InvoiceSheet.vue`, covering
  create (name, goal via `CurrencyAmountInput`) and detail (progress bar,
  contributor list, share link + QR, manual add, mark complete, delete).
- **Home page** — a "Buckets" section listing active buckets with name,
  progress bar, and amount `x / goal NIM` (+ fiat via existing rates).
  Tapping opens the sheet. Hidden when there are no buckets.
- No new route: the payer side goes through the existing Pay page / deep
  links.

## Store

`stores/buckets.ts`, same shape as `stores/invoices.ts`:
`load / reload / create / setStatus / remove / addManualContribution /
importMany`, calling `notifyDataChanged()` for cloud backup. Tests for the
store and for `matchContributions`.

## Backup / restore

Buckets join JSON export/import and the encrypted cloud-backup payload,
following exactly what invoices did in the v2 migration work.

## Error handling

- Invalid goal (`<= 0`) rejected at create, like invoices.
- Duplicate incoming tx hashes counted once (matcher dedupes by hash).
- Missing/binary tx messages simply don't match — no errors surfaced.

## Out of scope (v1)

Deadlines, refunds, pledges/reminders, editing the goal after creation
(delete + recreate), multi-currency goals.

## Explicit v2 path

If tag matching proves leaky in practice: a dedicated bucket wallet
(keypair generated in-app, key held by organizer, progress = address
balance). Requires `@nimiq/core` signing, RPC sending, and key backup —
deliberately deferred. Nothing in the v1 model blocks it: a bucket would
gain an `address` field and skip the matcher.
