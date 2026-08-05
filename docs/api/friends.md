# Friends API

Authenticated mutual-friends graph for NimConnect and ecosystem consumers
(via `@nimconnect/profile-client`). Design:
[`docs/plans/2026-08-04-friends-social-graph-design.md`](../plans/2026-08-04-friends-social-graph-design.md).

Local contacts are **not** part of this API. The graph is stored in Postgres
(`friendships` table; see `backend/migrations/001_init.sql`).

## Auth

New clients should request `friends:read` and/or `friends:write` through the
[scoped authorization API](./scoped-authorization.md) and send
`Authorization: Bearer <token>`. The actor always comes from the grant.

The v1/v2 flow below remains for one compatibility release:

1. `POST /api/session` with a wallet-signed challenge
2. Send `X-NimConnect-Session: <token>` on every friends call
3. `DELETE /api/session` to revoke

### `POST /api/session`

Body:

```json
{
  "address": "NQ…",
  "publicKey": "<hex>",
  "signature": "<hex>",
  "timestamp": 1700000000,
  "audience": "yourapp"
}
```

`audience` is a lowercase slug (`^[a-z0-9][a-z0-9_-]{1,31}$`) naming the app
the session is for. Omit it only for legacy clients — the server then accepts
the v1 challenge and records `audience=nimconnect`.

Signed message (Nimiq Pay / Hub `signMessage` format):

```text
nimconnect-session:v2:{compactAddress}:{timestamp}:{audience}
```

Legacy (empty `audience` only):

```text
nimconnect-session:v1:{compactAddress}:{timestamp}
```

`timestamp` must be within ±5 minutes of server time. Each signature mints
exactly one token (replay within the window returns 401).

**200 OK**

```json
{ "token": "<opaque>", "expires_at": 1700086400, "audience": "yourapp" }
```

### Verifying the signature yourself

Because the challenge names your app, your backend can verify the same
signature for its own session and skip a second Hub popup:

1. Rebuild `nimconnect-session:v2:{compact}:{timestamp}:{yourAudience}`
2. Check address matches, audience is yours, `|now - timestamp| ≤ 5m`
3. Verify the Ed25519 signature the same way NimConnect does (Nimiq
   `signMessage` hash)
4. Issue your own cookie/session — do **not** present a NimConnect token as
   proof to another app; each audience gets its own token

`userSessionChallenge(address, timestamp, audience)` is exported from
`@nimconnect/profile-client` for this.

### `DELETE /api/session`

Requires `X-NimConnect-Session`. **204** on success.

## Friends endpoints

All require a valid `X-NimConnect-Session`. The session address is the only
actor — there is no way to list another user's friends.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/friends` | Accepted friends |
| `GET` | `/api/friends/requests` | Incoming + outgoing pending |
| `POST` | `/api/friends/requests` | Send request `{ "to": "<handle\|address>" }` |
| `POST` | `/api/friends/requests/{id}/accept` | Recipient accepts |
| `POST` | `/api/friends/requests/{id}/decline` | Recipient declines |
| `DELETE` | `/api/friends/{address}` | Unfriend (either side) |

### Friend entry

```json
{
  "address": "NQ17VERV…",
  "handle": "bob",
  "displayName": "Bob Nice",
  "status": "accepted",
  "friendshipId": "<id>"
}
```

`status` is `accepted`, `pending_out`, or `pending_in` relative to the
authenticated user. `handle` / `displayName` are enriched from the registry
and profile stores when available.

`POST /api/friends/requests` returns one friend entry (`pending_out`).
Accept / decline / remove return **204**.

### Errors

| Code | When |
|------|------|
| 400 | Invalid handle/address, self-friend |
| 401 | Missing/expired/invalid session (or non-recipient accept/decline) |
| 404 | Unknown request id / unknown target handle |
| 409 | Duplicate pending/accepted edge |
| 429 | Rate-limited request creation (30/hour per address) |

## Privacy

- Never returns notes, tags, invoices, backups, or another user's graph
- Contacts remain local-only in the NimConnect Mini App

## First consumer

**NimBomber** / **NimWorld** consume this API via
`@nimconnect/profile-client` with an app-specific `audience`.
