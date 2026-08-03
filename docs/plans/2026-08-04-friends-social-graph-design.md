# Friends social graph — design

Date: 2026-08-04
Status: approved

## Goal

Add an opt-in, mutual **friends** graph to NimConnect so ecosystem apps
(NimBomber first, NimWorld next) can list the signed-in user's friends and
send/accept friend requests — without exposing local contacts or anyone else's
friend list.

## Decisions

| Topic | Choice |
|---|---|
| Model | Mutual requests (pending → accepted / declined) |
| Visibility | Only the authenticated user can read their own graph |
| Auth | Wallet sign once → short-lived server session (`X-NimConnect-Session`) |
| Discovery | By `@handle` / address + in-app Add from known players |
| Contacts | Stay local-first / encrypted; never synced into friends |
| First consumer | NimBomber (NimWorld follow-up) |
| Client | Extend `@nimconnect/profile-client` with authenticated friends APIs |

## Non-goals (this slice)

- Exposing another user's friend list
- Migrating or publishing private contacts / notes / tags
- Blocking, mute, messaging, presence-from-friends
- NimWorld Social Club wire-up (follow-up after NimBomber)
- Per-request wallet signatures for every friends call

## Architecture

```text
NimBomber / NimConnect UI
        │  wallet sign once (Pay SDK or Hub)
        ▼
NimConnect backend
  POST /api/session              → issue short-lived user session
  /api/friends/*                 → require X-NimConnect-Session
        │
        ├── friends store (server-side graph only)
        └── existing public profile/handle reads (unchanged)

Local contacts (IndexedDB) stay private forever.
```

### Ownership

| Concern | Owner |
|---|---|
| Public `@handle` + profile | Existing NimConnect public APIs |
| Private contacts / notes | NimConnect Mini App only (local) |
| Friends graph | NimConnect backend + authenticated client |
| Game stats / rooms / challenges | NimBomber |
| Plaza presence | NimWorld (separate) |

## Session

```text
POST /api/session
  body: { address, publicKey, signature, expiresAt }
  signed message: nimconnect-session:v1:{address}:{expiresAt}
  → { token, expiresAt }   // ~24h TTL
  header for subsequent calls: X-NimConnect-Session: <token>

DELETE /api/session
  → revoke current token
```

- Signature verification reuses existing Nimiq Pay / Hub `signMessage` format
  (`backend/auth.go`).
- Session maps token → address; friends handlers always act as that address.
- Expired / missing session → `401`; clients re-prompt one wallet sign.
- Pattern inspired by `AdminSessions`, but per-user (any wallet), not admin allow-list.

## Data model

```text
friendship {
  id
  requesterAddress
  recipientAddress
  status: pending | accepted | declined
  createdAt, updatedAt
}
```

- Accepted edges are undirected for reads (“my friends”).
- Pending edges are directed (incoming vs outgoing).
- One active edge per address pair (`pending` or `accepted`).
- Re-request after `declined` is allowed; not while `pending` or `accepted`.
- Cannot friend yourself.

Persistence: JSON file store under `/data/friends.json` (same style as handles /
marketplace stores) unless a clearer existing store pattern wins during
implementation. Keep the store interface swappable.

## API

All friends routes require a valid `X-NimConnect-Session`.

```text
GET    /api/friends                      → accepted friends
GET    /api/friends/requests             → incoming + outgoing pending
POST   /api/friends/requests             → { to: handle|address }
POST   /api/friends/requests/{id}/accept
POST   /api/friends/requests/{id}/decline
DELETE /api/friends/{address}            → unfriend (either side)
```

### Friend payload (public fields only)

```ts
{
  address: string
  handle?: string
  displayName?: string
  status: 'accepted' | 'pending_out' | 'pending_in'
  friendshipId: string
}
```

Enrich `handle` / `displayName` from existing registry + profile stores.
Never include notes, tags, invoices, backup data, or another user's graph.

### Errors

| Code | When |
|---|---|
| 400 | Invalid handle/address, self-friend |
| 401 | Missing/expired/invalid session |
| 404 | Unknown request id / unknown target handle |
| 409 | Duplicate pending/accepted edge |
| 429 | Rate-limited request creation |

## `@nimconnect/profile-client`

Keep public reads unchanged. Add authenticated surface:

- `createSession({ address, signMessage, expiresAt? })`
- `clearSession()` / `getSession()`
- `listFriends()`
- `listFriendRequests()`
- `sendFriendRequest(to: string)` // handle or address
- `acceptFriendRequest(id)`
- `declineFriendRequest(id)`
- `removeFriend(address)`

Session token storage is owned by the **app** (memory + `sessionStorage`).
The client accepts an injected token or stores one when `createSession` succeeds.
Wallet signing stays in the app (Pay SDK / Hub); client never owns keys.

Bump package minor version and document the authenticated APIs in the package README.

## NimConnect UI

- New **Friends** surface (separate from Contacts): accepted list, incoming /
  outgoing pending, Add by `@handle` / address.
- Opening Friends with no session → one wallet sign → `POST /api/session`.
- Actions: Accept, Decline, Remove.
- Optional: “Add as friend” on public profile when session exists.
- Contacts unchanged. Short copy: Friends are shared with apps you authorize;
  Contacts and notes stay on this device.

## NimBomber integration (first consumer)

- After wallet connect: create or reuse NimConnect session.
- Profile / lobby / leaderboard: **Add friend** when address/handle is known and
  relationship is not already pending/accepted.
- Small Friends section: accepted + pending.
- Display names continue via `getDisplayIdentity`; friends API is relationship
  state only.
- No NimBomber backend dependency on NimConnect friends.

## Follow-ups

1. NimWorld Social Club: replace mock friends with this API.
2. Challenge-friend / invite deep links using accepted friends.
3. Batch profile enrichment if friend lists grow large.
4. Block list (separate from decline).

## Testing

- Go: session issue/validate/expire; friendship state machine; authz (cannot
  accept others' requests; cannot list others' friends); rate limit.
- Client: session header wiring; request/accept/decline/remove happy paths + 401/409.
- NimConnect UI: smoke for sign-in → request → accept.
- NimBomber: Add friend from lobby/leaderboard when session available.

## Privacy principle

Public identity remains public. Private contacts remain private. Friends are an
explicit, user-owned, authenticated graph — never inferred from contacts and
never readable by third parties without the user's session.
