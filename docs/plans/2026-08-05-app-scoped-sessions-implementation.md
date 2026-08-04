# App-scoped sessions — implementation plan

Design: [`2026-08-05-app-scoped-sessions-design.md`](./2026-08-05-app-scoped-sessions-design.md)
Date: 2026-08-05

Ship order is backend → client → NimConnect UI → consumer. Each phase is
releasable on its own; nothing breaks a 0.6.x caller until phase 5 removes v1.

## Phase 1 — Backend accepts an audience

**`backend/user_session.go`**

- `userSessionChallenge(address string, timestamp int64, audience string) string`
  → `nimconnect-session:v2:{compactAddress}:{timestamp}:{audience}`.
  Keep the v1 string behind `userSessionChallengeV1(address, timestamp)`.
  (While here: the current parameter is named `expiresAtUnix` but the handler
  passes `req.Timestamp`. Rename to `timestamp` — it is the signing moment, not
  an expiry.)
- `defaultAudience = "nimconnect"`.
- `audienceRe = ^[a-z0-9][a-z0-9_-]{1,31}$` — reject anything else at login so a
  crafted audience can't smuggle a `:` and forge a different message shape.
- `userSessionEntry` gains `audience string`; `Issue(address, audience)` stores
  it; add `SessionFor(token) (address, audience string, ok bool)` and keep
  `AddressFor` as a wrapper so existing friends handlers are untouched.

**`backend/user_session_handlers.go`**

- Request gains `audience` (optional). Empty → `nimconnect`.
- Verify: if `audience` is empty *and* the v1 challenge verifies, accept it
  (compatibility path). Otherwise require the v2 challenge for the given
  audience. Never fall back from v2 to v1 — that would reintroduce the
  unbound-signature hole.
- Response gains `"audience"` so a client can confirm what it got.

**Tests — `backend/user_session_handlers_test.go`**

- v2 login succeeds and the entry records the audience.
- v1 login still succeeds and records `nimconnect`.
- A signature for `audience=a` is rejected when presented as `audience=b`
  (the core property — do not ship without this one).
- Invalid audience (`Bad Audience`, `a:b`, 40 chars) → 400.
- Stale/future timestamp still → 401.

## Phase 2 — Replay cache

Small enough to land with phase 1; keep it a separate commit.

- `UserSessions` gains `used map[string]time.Time` keyed by a hash of the
  signature, swept on the same `sweepLocked` pass.
- Login rejects a signature already spent (401), so one signature mints exactly
  one token.
- Test: identical login body twice → second is 401.

## Phase 3 — `@nimconnect/profile-client` 0.7.0

**`packages/profile-client/src/session.ts`**

- `userSessionChallenge(address, timestamp, audience)` — v2 format, exported so
  consumers can verify the signature themselves without depending on this
  client's transport.
- Keep a `userSessionChallengeV1` export for anyone verifying old signatures.

**`packages/profile-client/src/client.ts`**

- `createProfileClient({ audience })` — the app's own slug, set once.
- `createSession({ address, signMessage })` signs the v2 challenge and posts
  `audience`. If no audience was configured, keep sending v1 so 0.6.x behaviour
  is unchanged.

**Docs**

- `README.md` friends section: show `createProfileClient({ audience: 'yourapp' })`
  and explain that the signature is reusable by *your* backend precisely
  because it names your app.
- `docs/api/friends.md`: v2 message, `audience` field, the compatibility note,
  and a short "verifying the signature yourself" block — this is the part
  consumers need and cannot guess.

**Tests** — `friends.test.ts` / `session.test.ts`: challenge string shape;
audience is posted; no audience → v1 message.

## Phase 4 — NimConnect frontend

`src/services/friends.ts` — pass `audience: 'nimconnect'` when constructing the
client. No other change; the Friends page is unaffected.

## Phase 5 — First consumer (NimWorld repo, separate PR)

Proves the design and is where the payoff shows up:

- `createProfileClient({ audience: 'nimworld' })`.
- `apps/api` verifies the v2 challenge (prefix, address match, audience
  `nimworld`, ±5 min) and issues its own cookie session.
- Delete `/auth/challenge`, `/auth/verify`, the nonce store, and the second
  Hub signature from `loginWithHub`.

Result: one popup, and NimWorld ends up with less auth code than it started
with.

## Phase 6 — Retire v1

One release after 0.7.0 ships and both consumers are on it:

- Drop `userSessionChallengeV1` and the empty-audience path; audience becomes
  required.
- Note it in `docs/api/friends.md`.

## Out of scope

- **App registry / CORS from data** — the design's follow-on. Until then, a new
  consumer's origin still goes in `ALLOWED_ORIGIN`; NimWorld's deployed origin
  needs adding there regardless of this work.
- **Persisting sessions in Postgres** — pre-existing gap (restart logs everyone
  out, multi-replica breaks). Worth its own plan now that friendships already
  live in Postgres.
- **Scopes.** A session still means "this address, friends API". Adding
  read/write scopes is a separate design.

## Verification

- `cd backend && go test ./...`
- `npm test -w @nimconnect/profile-client`
- Manual: NimConnect Friends page still logs in; NimWorld connects friends with
  a single Hub popup; a session token from one audience is rejected by the
  other.
