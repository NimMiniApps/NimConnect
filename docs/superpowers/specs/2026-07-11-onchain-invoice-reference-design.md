# On-Chain Invoice Reference — Design

**Date:** 2026-07-11
**Status:** Approved

## Problem

NimConnect currently suggests that a pending invoice has been paid by matching an
incoming transaction's sender, amount, and timestamp. That heuristic is ambiguous
when the same contact has multiple invoices for the same amount, and the recipient
must still confirm the match manually.

New invoices need a compact reference carried by the payment transaction so
NimConnect can associate a confirmed on-chain payment with exactly one invoice.

## Goals

- Settle a new invoice automatically from one confirmed Nimiq transaction.
- Make settlement deterministic by matching an on-chain invoice reference.
- Accept an exact payment or overpayment and record the amount actually received.
- Preserve on-chain proof of settlement in the local invoice record and backups.
- Keep heuristic matching available for legacy invoices without a reference.

## Non-goals

- Combining multiple partial payments to settle one invoice.
- Automatically refunding overpayments or duplicate payments.
- Migrating existing invoices to generated references.
- Replacing manual settlement for cash or other exceptional payment methods.

## Reference format

Each new invoice receives a random six-character `paymentReference`. References
use an uppercase, unambiguous alphabet that excludes visually confusable characters
such as `0`, `O`, `1`, and `I`.

The versioned first line of the transaction data is:

```text
NC1:INV:<reference>
```

For example:

```text
NC1:INV:7K3M9Q
```

`NC1` versions the NimConnect transaction-data format. `INV` identifies the object
as an invoice. When a description is present, it follows a single LF byte:

```text
NC1:INV:7K3M9Q
Logo design
```

The parser treats the first line as the structured reference and all remaining
bytes as optional display text. The compact form leaves room within the Nimiq
basic transaction's 64-byte data limit for a short human-readable description.
Automatic matching depends only on the first line, never on the description.

Reference generation collision-checks against all locally stored invoices. If a
collision occurs, generation retries before the invoice is persisted. A reference
is immutable: copied links and reminders reuse the original value.

## Invoice data

The invoice model gains these optional fields so legacy records remain valid:

```ts
interface Invoice {
  paymentReference?: string
  paymentRecipient?: string
  settlement?: {
    method: 'onchain' | 'manual'
    transactionHash?: string
    amountReceivedNim?: number
    confirmedAt?: number
  }
}
```

`address` continues to identify the customer/contact associated with the invoice.
`paymentRecipient` is the normalized receiving wallet embedded in the payment
request. It is captured when the invoice is created and is immutable so a later
wallet or Settings change cannot alter the settlement rules of an invoice already
sent to a customer.

An on-chain settlement always contains the transaction hash, actual received
amount, and confirmation time. A manual settlement records `method: 'manual'`
without inventing transaction proof.

Backup export, import, and cloud synchronization preserve these fields. Import
validation accepts invoices created by older versions and rejects malformed new
settlement fields without discarding an otherwise recoverable legacy invoice.

## Payment request flow

1. Creating an invoice generates its `paymentReference` and snapshots its
   `paymentRecipient` from the receiving address used for the request.
2. The invoice payment URI carries the amount, description, and structured
   transaction data.
3. Scanning or opening the request shows the recipient, amount, description, and
   invoice reference before wallet confirmation.
4. Paying calls the Nimiq provider's transaction-with-data path and preserves the
   structured reference unchanged in the transaction data.
5. Reminders and copied payment links use the same reference as the original
   invoice.

If the full description and structured reference do not fit in 64 bytes, the
reference takes priority and the description is truncated by UTF-8 byte length.
The structured reference itself must never be truncated.

## Settlement detection

When Activity refreshes transaction history, NimConnect decodes confirmed incoming
transaction data and recognizes `NC1:INV:<reference>` as the exact first line. A
transaction settles an invoice only when all of these are true:

- The invoice is still pending and has the exact reference.
- The transaction recipient equals the invoice's immutable `paymentRecipient`.
- The transaction amount is equal to or greater than the invoice amount.
- The transaction is confirmed.
- The transaction hash has not already settled another invoice.

Settlement is idempotent. Reprocessing the same transaction leaves the existing
settlement unchanged. A reference can settle at most one invoice, and one
transaction can settle at most one invoice.

An overpayment settles the invoice and records the full received amount. A payment
below the requested amount does not settle it and is not combined with later
payments.

Invoices without `paymentReference` continue to use the existing sender, amount,
and timestamp heuristic. Those matches remain suggestions requiring manual
confirmation; they never become verified on-chain settlements.

## Exceptional payments

### Underpayment

An underpayment with a valid reference leaves the invoice pending. Activity shows
the transaction as `Underpaid`, including the requested and received amounts. A
later transaction is evaluated independently and must cover the full invoice
amount by itself.

### Duplicate payment

The first valid confirmed transaction settles the invoice. Later transactions with
the same reference appear as additional payments requiring attention. They do not
replace or add to the original settlement and do not trigger an automatic refund.

### Wrong recipient or malformed data

A matching reference paid to a different address cannot settle the invoice.
Malformed data, unknown format versions, and unknown object types are ignored for
automatic settlement and remain visible as ordinary transaction history where
applicable.

### Pending transaction

An unconfirmed transaction may be shown as a pending detection when the history
source exposes it, but it cannot mark the invoice paid. Settlement occurs only
after a later refresh reports confirmation.

### Manual settlement

`Mark paid` remains available for cash, legacy, and exceptional payments. The UI
labels this as manual settlement so it cannot be confused with verified on-chain
proof. Reopening an invoice clears its current settlement record but does not alter
transaction history; the same on-chain transaction must not be silently consumed
again without an explicit product action.

## Activity and invoice UI

A verified invoice displays:

- `Paid on-chain` status;
- requested amount and actual amount received when they differ;
- confirmation time; and
- a transaction-explorer link using the stored transaction hash.

A manually settled invoice displays `Marked paid manually`. Underpayments and
duplicate payments appear as attention items with links to their transactions.

The invoice reference is visible in payment confirmation and invoice detail views,
but the product does not treat it as a secret or a user-editable field.

## Error handling

- Transaction-history or RPC failures leave invoice state unchanged and use the
  existing Activity refresh error behavior.
- Invalid transaction data never mutates an invoice.
- An inability to create transaction data prevents payment confirmation rather
  than falling back to a reference-less payment for a referenced invoice.
- Settlement persistence is atomic from the invoice store's perspective. A failed
  local write is retried during the next history refresh.
- Backup/restore retains enough proof to reconstruct the settled state without
  trusting a description or timestamp heuristic.

## Tests

### Reference and request construction

- Generates references from the allowed alphabet and retries collisions.
- Produces and parses the exact versioned format.
- Rejects malformed references, unknown versions, and unknown object types.
- Preserves the reference through request-link parsing and wallet payment.
- Truncates descriptions by UTF-8 byte length without truncating the reference.
- Snapshots and preserves the normalized payment recipient at invoice creation.

### Settlement

- Exact payment settles the matching invoice.
- Overpayment settles and stores the amount actually received.
- Underpayment stays pending and does not combine with later underpayments.
- Wrong recipient and unconfirmed transactions do not settle.
- Repeated synchronization is idempotent.
- One transaction cannot settle multiple invoices.
- A duplicate payment becomes an attention item without replacing settlement.
- Legacy invoices retain suggestion-only heuristic matching.

### Persistence and UI

- Backup and restore preserve references and settlement proof.
- Older invoice records continue to load.
- Verified and manual settlements render distinct statuses.
- Explorer links use the stored transaction hash.
- RPC and persistence failures leave invoices in a recoverable state.
