# Full scoped authorization for NimConnect apps

Status: approved
Date: 2026-08-05

## Context

NimConnect already supports audience-bound `v2` sessions. A wallet signs once
for a named app such as `nimconnect` or `nimworld`, and NimConnect issues a
24-hour token. Those sessions currently authorize only the friends API.

Other off-chain features still ask Nimiq Pay for separate wallet signatures:
inbox reads and sends, public-profile changes, encrypted-backup operations, and
marketplace intents. These repeated confirmations are poor UX and do not move
funds or alter on-chain ownership.

The authorization boundary should distinguish off-chain application actions
from blockchain transactions. A user should authorize an app once, then use
ordinary NimConnect features without repeated wallet prompts. Payments,
escrow transfers, handle claims/releases, and every other on-chain action must
continue to receive explicit wallet approval.

## Decision

Implement audience-and-capability scoped sessions across registered apps owned
by the project, including NimConnect and NimWorld.

One readable wallet signature grants a registered app an exact set of scopes
for seven days. NimConnect persists a hash of the resulting bearer token and
enforces its audience, wallet, expiry, revocation state, and scopes at every
protected endpoint.

Tokens are never shared between audiences. Owning both apps does not make a
NimConnect token valid in NimWorld or give either app scopes it did not request.

## Alternatives considered

### One unrestricted ecosystem token

This would be the simplest integration, but a compromise in one app would
grant access to every off-chain operation in every app. It is rejected because
it removes the isolation that audience-bound sessions just introduced.

### Audience-and-capability sessions

This is the selected approach. It fits the existing session architecture,
keeps wallet consent readable, permits each app to request only what it needs,
and can be introduced endpoint by endpoint.

### Delegated device keys

A wallet could authorize a locally generated key that signs every later API
request. This provides stronger per-request cryptographic provenance, but adds
key lifecycle, recovery, canonical request signing, and replay-state
complexity. The scope model in this design leaves room to add device keys later
without requiring them for the first release.

## Authorization message

The app first obtains a challenge from NimConnect. The canonical signed message
is readable and includes the wallet, audience, exact canonical scope list,
expiry, and a server-generated nonce. For example:

```text
NimConnect authorization v3
App: nimworld
Address: NQ07...
Access: friends:read, friends:write, inbox:read, inbox:send
Expires: 2026-08-12T12:00:00Z
Nonce: AbCdEfGhIjKlMnOpQrStUw
```

This is an arbitrary signed authentication message, not transaction data. It
is not subject to the 64-byte on-chain data limit. The anticipated complete
message is only a few hundred UTF-8 bytes, but the exact production message
must be verified in the Nimiq Pay emulator before the protocol is locked.

Scopes are sorted lexicographically before formatting. TypeScript and Go share
byte-for-byte fixture tests for the canonical form.

## App registry

Registered apps have:

- a stable lowercase audience slug;
- a display name;
- an enabled flag;
- allowed browser origins;
- a maximum set of scopes they may request.

An app may request any subset of its allowed scopes. It does not receive its
entire maximum set automatically. Disabling an app immediately makes its
sessions unusable even before their stored expiry.

The registry is the source for CORS decisions on scoped-auth endpoints. An
origin is not itself proof of authorization; it is an additional browser
boundary around the signed challenge and bearer-token checks.

## Scope catalogue

The initial scopes are:

- `friends:read`
- `friends:write`
- `inbox:read`
- `inbox:send`
- `inbox:delete`
- `profile:write`
- `backup:read`
- `backup:write`
- `marketplace:read`
- `marketplace:trade`

Public profile reads, public handle lookup, and payment-authoritative handle
resolution remain public and do not require a scope.

Admin authorization stays separate and is not grantable through the ordinary
app registry.

No scope authorizes an on-chain transaction. In particular, sending funds,
funding escrow, releasing escrow funds, claiming a handle, and releasing a
handle continue through Nimiq Pay or Hub transaction confirmation.

## Session issuance

### Challenge creation

The app sends its audience, wallet address, and requested scopes to
`POST /api/auth/challenges`.

NimConnect:

1. validates the wallet address and audience;
2. confirms that the request origin is registered for the audience;
3. canonicalizes and validates the requested scope subset;
4. creates a cryptographically random, single-use nonce;
5. persists only the challenge state needed for consumption, with a five-minute
   expiry; and
6. returns the canonical message plus a challenge identifier.

Challenge creation is rate-limited per wallet and per IP.

### Signature exchange

The app asks Nimiq Pay or Hub to sign the exact returned message, then posts the
challenge identifier, public key, and signature to
`POST /api/auth/sessions`.

NimConnect consumes the challenge atomically, verifies the Nimiq signed-message
format, verifies that the public key derives the challenged address, and issues
a cryptographically random bearer token. Concurrent or repeated exchange of
the same challenge fails.

An owned consumer backend may verify the same audience-bound signature for its
own login so the user still sees only one prompt. NimConnect's nonce remains
single-use at NimConnect.

## Session persistence

Sessions live in PostgreSQL rather than an in-memory map. Each row contains:

- a hash of the bearer token, never the plaintext token;
- wallet address;
- audience;
- granted scopes;
- creation and expiry timestamps;
- last-used timestamp;
- optional revocation timestamp; and
- authorization provenance needed for audit and migration.

The lifetime is seven days. There is no refresh token in the first release.
After expiry, the app requests one new wallet authorization.

Apps store their own token in IndexedDB, keyed separately by audience and
wallet. Tokens must not be logged. Account switching deletes a mismatched local
token and attempts to revoke it remotely.

The session API provides inspection of the current grant, current-session
revocation, and wallet-wide revocation:

```text
POST   /api/auth/challenges
POST   /api/auth/sessions
GET    /api/auth/session
DELETE /api/auth/session
DELETE /api/auth/sessions
```

`DELETE /api/auth/sessions` implements "log out everywhere" for the
authenticated wallet.

## Request authorization

Protected requests use:

```http
Authorization: Bearer <session-token>
```

Middleware hashes the supplied token, resolves its session, and rejects
unknown, expired, revoked, disabled-audience, or insufficient-scope grants.
The authenticated actor always comes from the session. Wallet or sender fields
in request bodies must match that actor or be removed from the new request
shape; clients cannot select another actor in JSON.

Authorization does not replace feature validation. Existing profile schemas,
backup envelope/hash/version checks, monotonic backup timestamps, inbox quotas,
marketplace ownership checks, nonces, deadlines, and state-machine rules remain
in force.

## Stored authorization provenance

Some current rows retain the wallet signature that authorized their creation.
New session-authorized rows record the wallet, audience, and session/grant
provenance instead of inventing a wallet signature.

This is compatible with the current practical trust boundary:

- NimConnect's backend currently verifies inbox signatures before storage;
- the receiving NimConnect client trusts the envelope returned by that backend
  and does not independently verify its signature; and
- the public profile client returns normalized profile fields rather than
  exposing signature verification as its trust boundary.

Legacy signed records remain readable without rewriting history. Schema fields
needed only by the legacy authorization mode become nullable only after all
read paths have explicit support for both provenance modes.

## Endpoint migration

Migration is incremental:

1. Move existing friends calls to the `v3` bearer path.
2. Move inbox read, send, and delete to their scopes.
3. Move profile write and delete to `profile:write`.
4. Move encrypted backup read and write to backup scopes without weakening any
   ciphertext integrity controls.
5. Move marketplace history lookup and off-chain list, reserve, and cancel
   intents to marketplace scopes.
6. Integrate the same authorization flow into NimWorld using its own audience
   and requested subset.

The current `/api/session` `v1`/`v2` endpoint and legacy per-action signed
requests remain available for one compatibility release. Their removal is a
separate, explicit cleanup after deployed clients have migrated.

## UX and errors

An app requests authorization when it first needs a protected capability. A
single consent screen explains the app, access categories, and seven-day
duration. Successful authorization resumes the original action automatically.

A missing or expired session triggers one reauthorization attempt. User
rejection leaves the attempted operation unchanged and displays
"Authorization cancelled" rather than presenting it as a failed transaction.

An insufficient-scope response does not silently broaden the existing grant.
The app requests a new grant containing the desired canonical scope set and
shows the updated consent message.

## Security controls

- Five-minute, random, single-use server challenges.
- Atomic challenge consumption.
- Exact audience and canonical-scope binding in the wallet signature.
- Seven-day maximum session lifetime with no silent refresh.
- Hashed server-side bearer tokens.
- Registry-enforced origin and maximum-scope checks.
- Endpoint-specific scope middleware.
- Immediate rejection for revoked sessions or disabled apps.
- Per-wallet and per-IP issuance rate limits.
- Strict CSP and no tokens in URLs, logs, analytics, or error payloads.
- Existing request-size limits and domain validation remain active.

Bearer tokens reduce prompts by deliberately carrying authority for their
lifetime. A stolen token can perform only its audience-bound scopes, but those
scopes remain meaningful. This tradeoff is explicit in the wallet consent and
bounded by isolation, expiry, revocation, CSP, and minimal requested scope
sets.

## Verification

The implementation must cover:

- byte-identical canonical messages in Go and TypeScript;
- complete-message signing in the Nimiq Pay emulator;
- unknown audience, invalid origin, and scope escalation rejection;
- challenge expiry, replay, and concurrent consumption;
- token hashing, expiry, revocation, and disabled-app behavior;
- every protected endpoint's exact required scope;
- wrong-audience and cross-wallet substitution attempts;
- preservation of existing backup, inbox, profile, and marketplace validation;
- legacy signed-request and stored-record compatibility;
- PostgreSQL migration rehearsal and multi-instance behavior;
- NimConnect end-to-end flows with no off-chain wallet prompts after login;
- NimWorld end-to-end flows using a separate audience token; and
- continued Nimiq Pay prompts for every real on-chain action.

## Success criteria

- A user approves each app at most once per seven days for its requested
  off-chain capabilities.
- Inbox, friends, profile, backup, and approved marketplace API operations do
  not request additional wallet signatures while the grant is valid.
- NimConnect and NimWorld cannot use each other's tokens.
- Apps cannot request scopes outside their registry allowance.
- Account switching and revocation prevent reuse of the prior wallet's grant.
- No on-chain transaction becomes silently authorized by a scoped session.
