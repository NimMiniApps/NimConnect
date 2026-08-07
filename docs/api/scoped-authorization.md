# Scoped authorization API

NimConnect v3 turns one readable wallet signature into a short-lived bearer
grant for off-chain operations. Grants expire after seven days, belong to one
registered app audience and wallet, and contain only explicitly approved
scopes. They never authorize an on-chain payment, handle claim, marketplace
release, or marketplace claim; those actions still require wallet transaction
confirmation.

## Flow

1. `POST /api/auth/challenges` with `{ address, audience, scopes }`.
2. Sign the exact `message` returned by the server.
3. `POST /api/auth/sessions` with `{ challenge_id, public_key, signature }`.
4. Send `Authorization: Bearer <token>` to scoped endpoints.
5. Inspect with `GET /api/auth/session`, revoke this grant with
   `DELETE /api/auth/session`, or revoke every grant for the wallet with
   `DELETE /api/auth/sessions`.

Challenges expire after five minutes and can be consumed once. Invalid
signatures do not consume them. The plaintext bearer token is returned only by
the successful exchange; PostgreSQL stores its SHA-256 digest. Treat the token
as a secret and keep browser grants in IndexedDB rather than URLs or logs.

## Canonical signed message

```text
NimConnect authorization v3
App: nimworld
Address: NQ...
Access: friends:read, friends:write
Expires: 2026-08-12T12:00:00Z
Nonce: AbCdEfGhIjKlMnOpQrStUw
```

Addresses are compact uppercase, scopes are sorted, expiry is RFC3339 UTC at
second precision, and nonces are unpadded base64url. Clients must sign the
server-returned bytes rather than reconstructing the message.

## Scopes

| Scope | Capability |
|---|---|
| `friends:read` | List friends and requests |
| `friends:write` | Send, accept, decline, and remove friendships |
| `inbox:read` | Read the grant wallet's inbox |
| `inbox:send` | Send as the grant wallet |
| `inbox:delete` | Delete from the grant wallet's inbox |
| `profile:write` | Publish or remove the grant wallet's profile |
| `backup:read` | Read or probe the grant wallet's encrypted backup |
| `backup:write` | Upload the grant wallet's encrypted backup |
| `marketplace:read` | Read the grant wallet's private trade history |
| `marketplace:trade` | List, reserve, or cancel off-chain intents |
| `achievements:read` | Include the grant wallet's private achievements on profile reads |

Related ecosystem endpoints (not grant-scoped themselves):

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/authorizations` | `X-NimConnect-Session` | Lists the caller's live app grants (first-party only) |
| `GET /api/apps/{audience}` | public | Mirrored catalog identity for consent screens |
| `POST /api/awards` | app API key Bearer | Idempotent achievement grant by a registered app |
| `GET /api/profiles/{address}/achievements` | public; Bearer + `achievements:read` for private | Profile achievement panel |

The server derives the actor from the grant. Body, query, and path wallet
fields cannot substitute another actor. Apps can request only scopes seeded in
`auth_app_scopes`; NimWorld initially has `friends:read`, `friends:write`, and
`achievements:read`.

## Registration, errors, and operations

An app needs an enabled `auth_apps` row plus exact `auth_app_origins` and
`auth_app_scopes` rows. Registered origins are admitted by CORS for scoped
requests. Unknown origins or scope escalation return `403`; malformed requests
return `400`; invalid, expired, replayed, or revoked authorization returns
`401`.

Migrations apply in order: `001_init.sql`, `002_scoped_authorization.sql`,
`003_authorization_provenance.sql`, then `004_awards_and_app_registry.sql`.
Migration 003 retains legacy profile and inbox rows and records whether each
write used a wallet signature or scoped session. Migration 004 adds catalog
mirror columns on `auth_apps`, seeds `achievements:read`, and creates `awards`.
Back up PostgreSQL before production migration. Rollback is performed by
deploying the previous application while leaving additive tables/columns in
place; do not reverse migrations by deleting authorization provenance.

The v1/v2 `/api/session`, `X-NimConnect-Session`, and per-action signed request
paths remain for one compatibility release. No removal date is set yet.

