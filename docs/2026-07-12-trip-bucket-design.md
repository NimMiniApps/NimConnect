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
  id: string                 // uuid
  source: 'chain' | 'manual'
  amountNim: number
  sender?: string            // Nimiq address when known
  txHash?: string            // set for source 'chain' — dedupe key
  note?: string              // manual entries: free-text label/contact name
  at: number                 // epoch ms
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
  contributions: BucketContribution[]   // persisted ledger, chain + manual
}
```

Contributions are a **persisted ledger** on the bucket, not recomputed from
history on every view: `fetchIncomingPayments` only fetches the last 100 txs
per address, so tagged contributions to a long-running bucket would fall out
of the window. Instead, each polling pass appends newly seen tagged payments
(`source: 'chain'`, deduped by `txHash`) to the bucket record; once recorded,
a contribution survives regardless of the fetch window. Manual entries are
organizer adjustments and are never deduped against chain entries.

## Contribution tracking

- Payment message: `"🪣 <name> #<short-id>"` where `<short-id>` is the first
  8 chars of the bucket id, with **no fixed amount**.
- Two link forms, per the existing contract in `links.ts`: the **QR code**
  encodes `makeRequestLink(myAddress, undefined, message)` (native `nimiq:`
  URI); the **messenger share URL** uses
  `makePaymentShareLink(myAddress, undefined, message)`.
- Matching: a pure function `matchContributions(bucket, payments)` beside
  `matchPayments` — returns `fetchIncomingPayments` results whose message
  contains `#<short-id>` and whose `txHash` is not already in the bucket's
  ledger. The store appends matches as `source: 'chain'` contributions.
- Payments that lost the tag (payer edited the message): organizer adds them
  via a **manual add contribution** action on the bucket sheet (amount +
  optional contact), mirroring how invoices can be manually marked paid.
- Contributor display: sender addresses resolve to names through the existing
  profiles store; unknown senders show a short address.
- Scanning: `ScanRequestType` in `links.ts` gains a `bucket` member
  (`classifyScan` detects the `🪣` message prefix), and `ScanSheet.vue`'s
  title/copy switch gets a matching case so a scanned bucket QR reads
  "Trip bucket" instead of generic "Payment request". Covered by tests in
  `links.test.ts` and the scan-sheet behavior.

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
recordChainContributions / importMany`, calling `notifyDataChanged()` for
cloud backup. Tests for the store and for `matchContributions`.

## Backup / restore

Buckets follow the exact path invoices took, touching every hop explicitly:

- `ExportDocument` in `types/profile.ts` becomes `version: 1 | 2 | 3` with an
  optional `buckets?: Bucket[]` field; `exportDocument()` in
  `stores/profiles.ts` emits version 3 and includes buckets.
- `importDocument()` accepts versions 1–3 and calls
  `bucketsStore.importMany()` when `buckets` is present.
- `resetAll()` clears the `buckets` table and store state.
- `afterRestore()` in `services/restore.ts` reloads the buckets store.
- Cloud backup needs no format change (it wraps the export document), but
  its tests should cover a buckets round-trip.

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
