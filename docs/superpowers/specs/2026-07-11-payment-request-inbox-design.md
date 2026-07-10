# Payment-Request Inbox — Design

**Date:** 2026-07-11 (revised after review)
**Status:** Approved for planning

## Problem

NimConnect can create invoices, split bills, and payment requests, but the only
way to deliver them is a QR code or share link the recipient must scan or tap.
There is no way to send a request (or a reminder for an unpaid invoice) so it
appears inside the recipient's own NimConnect app.

## Solution

A server-side mailbox on the existing Go backend. A sender POSTs a signed
payment-request envelope addressed to a recipient's Nimiq address; the
recipient's app polls its mailbox, renders incoming requests on the Activity
page, and deletes them from the server after importing them locally.

Not chat. Payloads are structured payment requests only (the existing `nimiq:`
request-link string). The envelope carries `version` and `type` fields so other
payload types can ride the same rails later.

### Constraints that shaped the design

- NimConnect never holds private keys; signing goes through the Nimiq Pay
  message-signing popup (as in the existing cloud-backup auth). Therefore:
  no end-to-end encryption of mailbox contents (nothing client-side could
  decrypt), and each send costs one signature popup — fine for invoices,
  prohibitive for chat.
- Backend stays file-backed, no database, no websockets, no server sessions.
  Delivery is polling while the app is open.
- Messages are plaintext on the server (TLS in transit). Acceptable: the
  backend is self-hosted and the data is payment requests, not secrets.
- Single backend instance; per-mailbox concurrency control is an in-process
  mutex, not cross-process locking.

## Envelope

Stored one JSON file per message: `INBOX_DIR/<compact-address>/<id>.json`
(`INBOX_DIR` env var, default `/data/inbox`). Compact address = same
normalization as `BackupStore`.

```json
{
  "version": 1,
  "type": "payment-request",
  "id": "<uuid, server-generated>",
  "object_id": "<client-stable invoice/split/request id>",
  "nonce": "<128-bit random hex, client-generated>",
  "sender": "NQ07 0000 ...",
  "recipient": "NQ07 0000 ...",
  "payload": "nimiq:NQ...?amount=...&message=Invoice+...",
  "sent_at": 1760000000000,
  "received_at": 1760000000123,
  "public_key": "<hex>",
  "signature": "<hex>"
}
```

- `id` identifies the delivery attempt; `object_id` identifies the logical
  invoice/split/request. A reminder re-sends with the same `object_id` and a
  new `nonce`; the client updates the existing card instead of duplicating.
- `sent_at` is sender metadata only. `received_at` is server-assigned and is
  what retention, ordering, and debugging use.
- `recipient` is stored in the record (not only implied by the directory) so
  records are self-describing for debugging and migration.

## Signed message formats

Canonical, versioned, multiline (colon-concatenation is ambiguous because the
payload itself contains colons and arbitrary encoded text). Addresses are
compact-normalized before signing and verifying — never the raw route/body
formatting.

Send:

```text
nimconnect:inbox:send:v1
sender={compactSender}
recipient={compactRecipient}
sentAt={sentAt}
nonce={nonce}
objectId={objectId}
payloadHash={sha256hex(payload)}
```

Read/delete capability:

```text
nimconnect:inbox:read:v1
address={compactAddress}
issuedAt={issuedAt}
```

The read capability is explicitly a **replayable bearer token**: anyone who
extracts the cached signature can read and delete that mailbox until
`issuedAt` + 14 days. This is accepted for the threat model (self-hosted
backend, XSS in the app compromises far more than this token). It is stored in
Dexie/IndexedDB alongside the rest of the app data, not localStorage. Read and
delete deliberately share one capability: both live in the same client
storage, so splitting them adds a signature popup without an attacker-relevant
boundary.

## Backend

### Endpoints

All under the existing mux in `backend/main.go`, same CORS/logging middleware.

**`POST /api/inbox/messages`**
Body: envelope minus `id` and `received_at` (recipient lives in the signed
body, not the route). Server, under the recipient's mailbox mutex:

1. Validates field presence, `version == 1`, known `type`, `sender` and
   `recipient` are valid addresses (compact-normalized before use — route and
   filesystem paths are never built from raw input), `nonce` is 32 hex chars,
   payload ≤ 2048 bytes.
2. Verifies `signature` by `public_key` over the canonical send message and
   checks `public_key` derives the claimed `sender` address — the existing
   `verifyBackupAuth` logic generalized to take the message string as a
   parameter (refactor, not duplicate).
3. Rejects / short-circuits:
   - missing/invalid fields, oversize payload → 400
   - signature invalid or key/address mismatch → 401
   - `sent_at` more than 10 minutes off server time → 409
   - same `sender` + `nonce` already in the mailbox → 200 with the existing
     `id` (idempotent replay; a scan of ≤100 files, no index)
   - sender already has 10 messages pending in this mailbox → 429
   - mailbox holds 100 messages → 429
4. Assigns a UUID, sets `received_at` to server time, writes the file
   (tmp + rename, 0600, like backups).

Returns 201 with `{ "id": ... }`. Response behavior does not reveal whether a
mailbox "exists" — an empty and an absent mailbox directory behave identically
everywhere.

**`GET /api/inbox/{address}/messages`**
Returns `{ "messages": [envelope, ...] }`, oldest first by `received_at`
(deterministic), empty array for empty/absent mailbox. Response is bounded by
design: ≤100 messages × ≤2KB payloads. No pagination (YAGNI at this cap).

Auth headers: `X-Inbox-Public-Key`, `X-Inbox-Signature`, `X-Inbox-Issued-At` —
a signature over the canonical read message, key must derive `{address}`,
accepted while `issued_at` < 14 days old.

Behavior under the mailbox mutex:
- Lazy retention sweep: files with `received_at` older than 60 days are
  deleted before responding. No cron.
- A file that fails to parse is quarantined (renamed to `<id>.json.corrupt`)
  and logged server-side; it never fails the whole read.
- Directory scan is capped (1000 entries) as a filesystem-abuse guard.

**`DELETE /api/inbox/{address}/messages/{id}`**
Same auth as GET. `{id}` must be a well-formed UUID before any path is built.
204 on success, 404 if absent (repeat deletes are 404, not errors).

### Filesystem hardening

- Paths are built only from compact-normalized addresses and validated UUIDs.
- `INBOX_DIR` is owned exclusively by the service; symlinked entries in
  mailbox directories are skipped and logged.
- Per-mailbox `sync.Mutex` (map keyed by compact address) wraps
  count/sweep/write/delete so concurrent sends cannot exceed quotas.

### Deployment note

Per-IP rate limiting is a reverse-proxy concern: apply nginx `limit_req` to
`/api/inbox/` in the existing nginx config. The app-level defenses
(per-sender cap, mailbox cap, nonce idempotency) are wallet-independent, which
is what matters — time-windowed per-sender limits are not implemented because
fresh wallets are free and would bypass them anyway.

## Client

### `src/services/inbox.ts`

- `sendPaymentRequest({recipient, payload, objectId})` — generates nonce,
  builds the canonical send message, requests a Nimiq Pay message signature
  (same flow `cloud-backup.ts` uses), POSTs.
- `fetchInbox()` / `deleteInboxMessage(id)` — using the cached read capability
  in Dexie; when missing or > 14 days old, prompt one signature to mint a new
  one.
- Unit tests for canonical message construction, payload hashing, and
  capability expiry logic.

### Send UX

Where the app currently offers "share invoice / split link" (InvoiceSheet and
the split flow), add **"Send to their NimConnect"** when the counterparty is a
saved contact with an address. `object_id` = the local invoice/split id.
Reminder for an unpaid invoice = re-send the same `object_id` from the
invoice's actions.

### Receive: import-before-delete

Per message, in order:

1. Fetch envelope.
2. Validate envelope (version, type, addresses, signature fields present).
3. Parse and validate payload (see payload validation below).
4. Store locally in a Dexie transaction with an import status.
5. Only after the transaction commits, DELETE the message remotely.

If the remote delete fails, the next poll redelivers and local dedup (by
message `id`) makes it a no-op. If local import fails, the message is left on
the server for the next poll.

Local records carry explicit state:

```ts
type InboxImportStatus = 'actionable' | 'unsupported' | 'invalid' | 'dismissed' | 'paid'
```

- Unknown `version`/`type` → stored as `unsupported`, **not deleted from the
  server** and not silently discarded locally — a newer client may handle it.
  Only an explicit user dismissal deletes an unsupported message remotely.
- Malformed payloads → `invalid`, shown minimally, never payable.
- Messages with a known `object_id` update the existing card (reminder)
  instead of creating a new one.

### Payload validation (client, trust boundary)

- Payload must be a supported `nimiq:` URI (parsed by the existing
  `parsePaymentRequest`); unsupported query params are ignored.
- **The payment destination must equal the signed `sender`.** Otherwise an
  attacker signs as a trusted contact but routes payment elsewhere. Mismatch →
  status `invalid`, rendered with the raw facts and no pay action. (Delegated
  merchant payouts where signer ≠ destination are explicitly out of scope; if
  ever needed they require their own envelope type and UI.)
- Amounts validated as positive finite numbers within NIM precision (5
  decimals).
- Message text is untrusted plain text: never rendered as HTML, URLs inside it
  are not made tappable.
- The server stays payload-agnostic; this validation is entirely client-side.

### Activity UX

- Incoming messages render via the existing `classifyScan` as split / invoice
  / request cards with **Pay** and **Dismiss**.
- Senders in contacts render normally. Unknown senders: a section header with
  a count, first two requests visible, rest expandable. Paying an unknown
  sender always goes through an explicit confirmation screen showing the full
  sender address — never one-tap.
- Inbox badge counts successfully imported `actionable` messages, not raw
  fetches.
- Poll on app open / foreground resume, and on pull-to-refresh on Activity.
  Local copies join the existing cloud-backup data set via
  `notifyDataChanged()`.

## Error handling

- Network/server failures on poll are silent (badge stays stale); on send,
  surface the existing toast/error pattern.
- Signature popup dismissed by user = send cancelled, no error state.
- 429 on send: show "recipient's inbox is full, share a link instead".

## Tests

Backend (table-driven, matching existing style):

- Send happy path; each rejection: oversize payload (2048 ok / 2049 rejected),
  bad signature, sender/key mismatch, `sent_at` exactly at ±10 min boundary,
  per-sender cap (10th ok / 11th rejected), mailbox cap, sender == recipient.
- Nonce replay returns original id; two identical submissions create one file.
- Concurrent sends at the mailbox limit stay ≤ 100 (mutex test).
- Path traversal attempts in address and id; non-canonical address formatting
  verifies against the compact form; malformed UUID rejected.
- Read auth accept / expire at 14-day boundary; corrupt JSON file skipped and
  quarantined; symlink skipped; retention boundary exactly at 60 days.
- Delete twice → 204 then 404.

Client:

- Canonical message construction and payload hash.
- Capability expiry logic.
- Import pipeline: fetch-ok/import-fails leaves server copy;
  import-ok/delete-fails dedups on next poll; reminder with existing
  `object_id` updates not duplicates; unknown type → `unsupported` and not
  auto-deleted; destination ≠ sender → `invalid`, no pay action.

## Out of scope

Free-text chat, delivery receipts, read receipts, push notifications, message
editing, E2E encryption, server-side contact allowlists, delegated payments
(signer ≠ payment destination), cursor pagination, time-windowed rate limits
(see deployment note), server session tokens.
