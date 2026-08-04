# Friends API

Authenticated mutual-friends graph for NimConnect and ecosystem consumers
(via `@nimconnect/profile-client`). Design:
[`docs/plans/2026-08-04-friends-social-graph-design.md`](../plans/2026-08-04-friends-social-graph-design.md).

Local contacts are **not** part of this API.

## Auth

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
  "timestamp": 1700000000
}
```

Signed message (Nimiq Pay / Hub `signMessage` format):

```text
nimconnect-session:v1:{compactAddress}:{timestamp}
```

`timestamp` must be within ±5 minutes of server time.

**200 OK**

```json
{ "token": "<opaque>", "expires_at": 1700086400 }
```

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

**NimBomber** is the first ecosystem app wired to this API (lobby / leaderboard
Add friend, profile Friends section) via `@nimconnect/profile-client@0.6.0`.
