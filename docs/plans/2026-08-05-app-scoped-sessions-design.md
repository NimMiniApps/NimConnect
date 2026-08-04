# App-scoped sessions ("Sign in with NimConnect") — design

Status: proposed
Date: 2026-08-05

## Problem

`POST /api/session` authenticates a wallet signature over

```text
nimconnect-session:v1:{compactAddress}:{timestamp}
```

The message names the *user* and the *moment*, but not the *app*. Three
consequences, all visible now that a second consumer exists:

1. **Every app costs the user another signature.** NimWorld already signs a
   login challenge for its own Go backend; connecting friends signs a second
   time, seconds later, for the same account. Two Hub popups for one login.
   NimBomber will make it three.
2. **A NimConnect signature can't be safely reused by anyone else.** A consumer
   could verify the signature itself (it is a plain Ed25519 signature over a
   deterministic string) and skip its own challenge — but since the message
   doesn't say who it was for, anything that observes it (NimConnect's own
   backend, its logs, a proxy) could replay it into that consumer within the
   5-minute window. So today the honest answer to "can I reuse this?" is no.
3. **Onboarding a consumer needs an ops change.** Session and friends calls are
   POST/DELETE, so they fall through `publicReadPaths` in `backend/cors.go` to
   the `ALLOWED_ORIGIN` env list. A new app gets `Failed to fetch` in the
   browser until someone edits an env var and redeploys. NimWorld hit exactly
   this.

The tempting fix — let NimConnect accept challenges issued by other apps — is
the wrong direction. It turns the ecosystem's identity service into the most
permissive verifier in the system: a signature a user produced for some other
purpose would become a NimConnect login. Verification must stay strict.

## Proposal

Bind the challenge to an audience.

```text
nimconnect-session:v2:{compactAddress}:{timestamp}:{audience}
```

`audience` identifies the app the session is for — a lowercase slug from the
app registry (`nimconnect`, `nimworld`, `nimbomber`). The issued token records
its audience alongside the address.

That one field fixes all three problems:

1. **One signature per login.** The consumer collects the signature once, posts
   it to NimConnect for a friends token, and verifies the same signature itself
   for its own session. NimWorld's `apps/api` can then delete its
   challenge/verify/nonce path entirely.
2. **No cross-app replay.** A signature for `audience=nimworld` fails
   verification anywhere else, including at NimConnect. Reuse becomes safe
   because the user's consent is explicit about which app it applies to.
3. **Registered audience carries its origin**, so CORS becomes data instead of
   env config (see Follow-on).

### Compatibility

`v1` stays accepted for one release, treated as `audience=nimconnect`. The
backend picks the verifier by prefix, so old and new clients coexist and
`@nimconnect/profile-client` can require `audience` from 0.7.0 without breaking
0.6.x callers in the wild.

### What this is not

- Not OAuth. No redirects, no consent screen, no client secrets. The wallet
  signature *is* the consent, and it names the app in plain text the user's
  wallet displays before signing.
- Not a token other apps can present to NimConnect. Each app gets its own
  token; a `nimworld` token is not valid for a `nimbomber` call.
- Not a change to what a session may read. Scopes stay out of scope: every
  session still means "this address, friends API only".

## Security notes

- **Window unchanged**: ±5 minutes (`userSessionLoginWindow`), matching Hub's
  signing latency on slow devices.
- **Replay within the window is possible today** — the same signature mints
  unlimited tokens for 5 minutes. Audience scoping narrows the blast radius to
  one app but does not close it. Fix alongside: a single-use cache keyed by
  signature hash, evicted past the window. Small, and it makes signature reuse
  by consumers genuinely safe rather than merely narrow.
- **Sessions are in-memory** (`UserSessions.tokens` map). A restart logs
  everyone out and a second replica never sees the first one's tokens. Not
  caused by this change and not fixed by it, but it becomes more visible when
  other apps depend on the session too. Track separately; the friendships table
  already proves Postgres is available.

## Follow-on (not required for this change)

An **app registry** table — `audience`, display name, origin(s), enabled —
would let `withCORS` reflect a registered app's origin instead of consulting
`ALLOWED_ORIGIN`, and let the login handler reject unknown audiences. Onboarding
an ecosystem app becomes a row, not a redeploy. Worth doing once there is a
third consumer; two can live with the env var.

## Decision

Worth building when a second app needs to log in, which is now. The saved popup
is not the point — the point is that NimConnect becomes the ecosystem's identity
provider, and every consumer deletes its own auth instead of inventing one.
