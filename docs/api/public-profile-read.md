# Public Profile & Handle Read API

For how `@handle`s are claimed (on-chain, not a NimConnect write endpoint),
see [`handle-claim-protocol.md`](./handle-claim-protocol.md).

Read-only contract for NimConnect's public identity endpoints, intended for
consumption by other apps in the ecosystem (e.g. NimBomber) via
`@nimconnect/profile-client`. Source of truth: `backend/handles_handlers.go`,
`backend/handles_registry.go`, `backend/profiles.go`.

These are the **only** endpoints external consumers should call. Write
endpoints (`PUT`/`DELETE /api/profile/{address}`, `POST /api/handles/claims`)
require a wallet signature tied to NimConnect's own claim/edit flows and must
not be called from other apps — see [Out of scope for consumers](#out-of-scope-for-consumers).

## Base URL

Production SPA: `https://nimconnect.nimiqminiapps.com`  
Production API: `https://api-nimconnect.nimiqminiapps.com`

## Endpoints

### `GET /api/resolve/{handle}`

Resolves a `@handle` to its winning claim.

- `handle` path segment must match `^[a-z0-9_]{3,31}$` (lowercase letters,
  digits, underscore, 3–31 chars) or the request is rejected as invalid.

**200 OK**

```json
{
  "handle": "chuck",
  "address": "NQ11 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX",
  "tx_hash": "<claim transaction hash>",
  "block_height": 12345,
  "tx_index": 0
}
```

**400 Bad Request** — malformed handle:

```json
{ "error": "invalid handle" }
```

**404 Not Found** — no claim indexed for that handle:

```json
{ "error": "unknown handle" }
```

### `GET /api/profile/{address}`

Fetches the signed public profile JSON stored for a Nimiq address.

- `address` path segment must be a valid Nimiq address (`NQ` + 2-digit
  checksum + 32 base32 chars; spaces are stripped before matching).

**200 OK**

```json
{
  "address": "NQ11 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX",
  "updated_at": 1732000000000,
  "profile": {
    "display_name": "Chuck",
    "bio": "building things on Nimiq",
    "website": "https://example.com",
    "github": "chuck",
    "x": "chuck",
    "tags": ["builder", "validator"]
  }
}
```

`profile` is a flat JSON object. All fields are optional (a stored profile may
contain any subset). Known keys and caps enforced server-side on write
(informational for readers — not re-validated on read):

| Key | Type | Cap |
|---|---|---|
| `display_name` | string | 64 chars |
| `bio` | string | 300 chars |
| `website` | string (http/https URL) | 200 chars |
| `github` | string | 39 chars |
| `x` | string | 15 chars |
| `tags` | string array | ≤8 tags, ≤24 chars each |

Consumers should treat unknown/future keys in `profile` as opaque and ignore
them rather than failing — the schema is additive-only.

**400 Bad Request** — malformed address:

```json
{ "error": "invalid address" }
```

**404 Not Found** — address has no stored profile:

```json
{ "error": "no profile" }
```

### `GET /api/handles/by-address/{address}`

Reverse lookup: finds the handle claim owned by an address, if any.

Unlike profile GET, this handler does **not** validate Nimiq address format.
The path segment is compact-compared against indexed claims; malformed and
unknown addresses both miss and return the same 404.

**200 OK** — same shape as `GET /api/resolve/{handle}`:

```json
{
  "handle": "chuck",
  "address": "NQ11 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX",
  "tx_hash": "<claim transaction hash>",
  "block_height": 12345,
  "tx_index": 0
}
```

**404 Not Found** — no handle for that address (including malformed addresses):

```json
{ "error": "no handle" }
```

## Caching

All three endpoints above are cacheable GETs and set:

- `Cache-Control: public, max-age=60`
- `ETag` — `resolve` / `by-address` use the claim's `tx_hash`; `profile` uses
  `updated_at` as the ETag value.

Send `If-None-Match` with the previously-seen ETag to get a `304 Not Modified`
(empty body) instead of re-fetching the payload.

## CORS

The three read endpoints above are **always CORS-open** (`Access-Control-Allow-Origin: *`),
regardless of the server's `ALLOWED_ORIGIN` setting — any mini app, from any
origin, can call them directly with no server-side config change. This is
what makes the ecosystem self-serve: a new consumer never needs a PR against
NimConnect's deploy config to start reading profiles/handles.

`ALLOWED_ORIGIN` (single origin, `*`, or a comma-separated allow-list) still
governs everything else — the signed write endpoints
(`PUT`/`DELETE /api/profile/{address}`, `POST /api/handles/claims`) and any
other route. Those stay origin-gated; a wallet signature is the real trust
boundary for writes either way, origin-locking is defense in depth on top of it.

`OPTIONS` preflight requests short-circuit with `204 No Content`. Read-only
consumers hitting these three GET endpoints don't send custom headers or
non-simple methods, so preflight is generally not triggered anyway.

## Out of scope for consumers

Other apps (NimBomber, future mini-apps) must only call the read endpoints
documented above. Do **not** call, from another app:

- `PUT /api/profile/{address}` — requires a wallet signature over a
  NimConnect-specific message (`nimconnect:profile:v1...`) tied to
  NimConnect's own edit UI.
- `DELETE /api/profile/{address}` — requires signed `X-Profile-*` headers,
  same trust boundary as above.
- `POST /api/handles/claims` — advisory fast-indexing hook tied to
  NimConnect's claim-transaction flow; not a general-purpose write API.

NimConnect remains the sole write authority for handles and public profiles.
Consumers should link users to the NimConnect app
(`https://nimconnect.nimiqminiapps.com`) to claim a handle or edit their
profile, rather than reimplementing the write path.
