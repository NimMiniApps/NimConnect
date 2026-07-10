# Payment-Request Inbox — Design

**Date:** 2026-07-11
**Status:** Approved for planning

## Problem

NimConnect can create invoices, split bills, and payment requests, but the only
way to deliver them is a QR code or share link the recipient must scan or tap.
There is no way to send a request (or a reminder for an unpaid invoice) so it
appears inside the recipient's own NimConnect app.

## Solution

A server-side mailbox on the existing Go backend. A sender POSTs a signed
payment-request payload addressed to a recipient's Nimiq address; the recipient's
app polls its mailbox, renders incoming requests on the Activity page, and
deletes them from the server after importing them locally.

Not chat. Payloads are structured payment requests only (the existing `nimiq:`
request-link string). The envelope is generic enough that other payload types
could ride the same rails later.

### Constraints that shaped the design

- NimConnect never holds private keys; signing goes through the Nimiq Pay
  message-signing popup (as in the existing cloud-backup auth). Therefore:
  no end-to-end encryption of mailbox contents (nothing client-side could
  decrypt), and each send costs one signature popup — fine for invoices,
  prohibitive for chat.
- Backend stays file-backed, no database, no websockets. Delivery is polling
  while the app is open.
- Messages are plaintext on the server (TLS in transit). Acceptable: the
  backend is self-hosted and the data is payment requests, not secrets.

## Backend

### Storage

One directory per recipient, one JSON file per message:
`INBOX_DIR/<compact-address>/<id>.json` (`INBOX_DIR` env var, default
`/data/inbox`). Compact address = same normalization as `BackupStore`.

Message record:

```json
{
  "id": "<uuid, server-generated>",
  "sender": "NQ07 0000 ...",
  "payload": "nimiq:NQ...?amount=...&message=Invoice+...",
  "sent_at": 1760000000000,
  "public_key": "<hex>",
  "signature": "<hex>"
}
```

### Endpoints

All under the existing mux in `backend/main.go`, same CORS/logging middleware.

**`POST /api/inbox/{recipient}`**
Body: record minus `id`. Server:

1. Verifies `signature` by `public_key` over the message
   `nimconnect-inbox-send:{recipient}:{sent_at}:{payload}` and checks
   `public_key` derives the claimed `sender` address — the existing
   `verifyBackupAuth` logic generalized to take the message string as a
   parameter (refactor, not duplicate).
2. Rejects when:
   - `payload` > 2048 bytes, or any required field missing → 400
   - signature invalid or key/address mismatch → 401
   - `sent_at` more than 10 minutes off server time (replay guard) → 409
   - recipient mailbox already holds 100 messages (spam ceiling) → 429
3. Assigns a UUID, writes the file (tmp + rename, 0600, like backups).

Returns 201 with `{ "id": ... }`.

**`GET /api/inbox/{address}`**
Returns `{ "messages": [record, ...] }` (empty array for empty/absent mailbox).

Auth headers: `X-Inbox-Public-Key`, `X-Inbox-Signature`, `X-Inbox-Issued-At` —
a signature over `nimconnect-inbox-read:{address}:{issued_at}`, verified the
same way as send auth (key must derive `{address}`). Accepted while
`issued_at` is less than 30 days old. The client signs once and caches;
no per-poll popup, no server session state.

Side effect: lazy retention sweep — files in this mailbox older than 60 days
(by `sent_at`) are deleted before responding. No cron.

**`DELETE /api/inbox/{address}/{id}`**
Same auth as GET. 204 on success, 404 if absent. Recipient calls this after
importing or dismissing a message.

### Backend tests

Table-driven, matching existing style: send happy path; each rejection
(oversize, bad signature, sender/key mismatch, stale `sent_at`, mailbox full);
read auth accept/expire; delete; retention sweep.

## Client

### `src/services/inbox.ts`

- `sendPaymentRequest(recipient, payload)` — request a Nimiq Pay message
  signature over the send string (same flow `cloud-backup.ts` uses), POST.
- `fetchInbox()` / `deleteInboxMessage(id)` — using a cached read-auth token
  `{ publicKey, signature, issuedAt }` in localStorage; when missing or > 30
  days old, prompt one signature to mint a new one.
- Unit tests for message-string construction and auth-token expiry logic.

### Send UX

Where the app currently offers "share invoice / split link" (InvoiceSheet and
the split flow), add **"Send to their NimConnect"** when the counterparty is a
saved contact with an address. Reminder for an unpaid invoice = re-send the
same invoice payload from the invoice's actions.

### Receive UX

- Poll on app open / foreground resume, and on pull-to-refresh on the
  Activity page.
- Fetched messages are stored in a new Dexie table and deleted from the
  server — the mailbox is a relay, not a source of truth. Local copies join
  the existing cloud-backup data set via `notifyDataChanged()`.
- Each message's `payload` runs through the existing `classifyScan` →
  rendered as an incoming split / invoice / request card on the Activity page
  with **Pay** and **Dismiss** actions (Pay reuses the existing pay flow fed
  by the parsed intent).
- Messages from senders in contacts render normally; unknown senders sit in a
  collapsed **"Requests from unknown senders"** group. From a message, the
  user can add the sender as a contact via the existing add-contact flow.
- Duplicate delivery is handled by message `id`: importing an id already in
  the local table is a no-op.

## Error handling

- Network/server failures on poll are silent (badge stays stale); on send,
  surface the existing toast/error pattern.
- Signature popup dismissed by user = send cancelled, no error state.
- 429 (recipient mailbox full) on send: show "recipient's inbox is full,
  share a link instead".

## Out of scope

Free-text chat, delivery receipts, read receipts, push notifications, message
editing, E2E encryption, server-side contact allowlists.
