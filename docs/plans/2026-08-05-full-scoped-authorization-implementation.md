# Full Scoped Authorization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace repeated wallet signatures for NimConnect off-chain actions with seven-day, audience-and-capability scoped sessions while preserving explicit wallet confirmation for every on-chain transaction.

**Architecture:** NimConnect issues single-use PostgreSQL-backed challenges and stores only hashes of audience-bound bearer tokens. Registered apps may request only allowed scope subsets; endpoint middleware derives the wallet actor from the grant and enforces an exact scope. The profile client and owned apps use one readable wallet signature to establish the grant, persist it in IndexedDB, and reuse it for off-chain APIs.

**Tech Stack:** Go 1.24 HTTP backend, PostgreSQL migrations via embedded SQL, Vue 3/TypeScript, Dexie, `@nimconnect/profile-client`, Vitest, Go tests, Nimiq Pay mini-app SDK.

---

## Execution prerequisites

- Use `@superpowers:using-git-worktrees` to create an isolated NimConnect worktree from commit `14eec9d` or newer. Do not implement directly in the current dirty main checkout.
- Use `@superpowers:test-driven-development` for every task below.
- Before running PostgreSQL integration tests or migrations, load and follow `@database-safety-guard`; use only the guarded `TEST_DATABASE_URL` database.
- Keep `/home/maestro/Documents/projects/NimWorld` changes in a separate NimWorld worktree and commit series.
- Never stage the unrelated `security_best_practices_report.md` from the current NimConnect checkout.

### Task 1: Add the authorization schema and durable stores

**Files:**
- Create: `backend/migrations/002_scoped_authorization.sql`
- Create: `backend/auth_store.go`
- Create: `backend/auth_store_test.go`
- Modify: `backend/db_test.go`
- Modify: `backend/migration_rehearsal_test.go`

**Step 1: Write the failing migration and store tests**

Add integration tests proving migration `002` creates these tables and constraints:

```sql
auth_apps(audience PRIMARY KEY, display_name, enabled)
auth_app_origins(audience REFERENCES auth_apps, origin, PRIMARY KEY(audience, origin))
auth_app_scopes(audience REFERENCES auth_apps, scope, PRIMARY KEY(audience, scope))
auth_challenges(id PRIMARY KEY, nonce_hash UNIQUE, address, audience,
                scopes TEXT[], message, created_at, expires_at, consumed_at)
auth_sessions(token_hash PRIMARY KEY, address, audience, scopes TEXT[],
              created_at, expires_at, last_used_at, revoked_at)
```

Seed `nimconnect` and `nimworld` app rows plus their production/local origins and explicit maximum scope sets. Test that rerunning `Migrate` is idempotent and the production-cutover rehearsal preserves existing rows.

Add store tests for:

- creating and atomically consuming a five-minute challenge;
- rejecting a second concurrent consumption;
- issuing a seven-day session while persisting only `sha256(token)`;
- resolving, touching, revoking one session, and revoking all wallet sessions;
- rejecting expired/revoked sessions and sessions for a disabled app; and
- checking a requested scope subset against `auth_app_scopes`.

Define the store-facing records explicitly:

```go
type AuthGrant struct {
    ID        string
    Address   string
    Audience  string
    Scopes    []string
    CreatedAt time.Time
    ExpiresAt time.Time
}

type AuthStore struct {
    db       *sql.DB
    now      func() time.Time
    randRead func([]byte) (int, error)
}
```

**Step 2: Run tests to verify they fail**

Run:

```bash
cd backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" go test ./... -run 'TestAuthStore|TestOpenAndMigrate|TestProductionCutoverRehearsal' -count=1
```

Expected: FAIL because migration `002`, `AuthStore`, and authorization tables do not exist.

**Step 3: Implement the migration and store**

Use application-generated 32-byte random tokens/nonces. Hash them with SHA-256 before persistence. Use a single conditional statement for challenge consumption:

```sql
UPDATE auth_challenges
SET consumed_at = now()
WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
RETURNING address, audience, scopes, message
```

Sort/deduplicate scopes before storage. Keep timestamps as `TIMESTAMPTZ`. Do not use plaintext bearer tokens, wildcard scopes, silent session extension, or database-generated secrets returned through logs.

**Step 4: Run tests to verify they pass**

Run the command from Step 2, then:

```bash
cd backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" go test -race ./... -count=1
```

Expected: targeted tests PASS; full backend race suite PASS (PostgreSQL-dependent tests may skip only when the guarded test database is unavailable).

**Step 5: Commit**

```bash
git add backend/migrations/002_scoped_authorization.sql backend/auth_store.go backend/auth_store_test.go backend/db_test.go backend/migration_rehearsal_test.go
git commit -m "feat: persist scoped authorization grants"
```

### Task 2: Define scopes, app policy, and the canonical v3 message

**Files:**
- Create: `backend/auth_protocol.go`
- Create: `backend/auth_protocol_test.go`
- Modify: `packages/profile-client/src/session.ts`
- Modify: `packages/profile-client/src/session.test.ts`
- Modify: `packages/profile-client/src/types.ts`

**Step 1: Write failing protocol parity tests**

Define the closed scope set:

```go
const (
    ScopeFriendsRead     = "friends:read"
    ScopeFriendsWrite    = "friends:write"
    ScopeInboxRead       = "inbox:read"
    ScopeInboxSend       = "inbox:send"
    ScopeInboxDelete     = "inbox:delete"
    ScopeProfileWrite    = "profile:write"
    ScopeBackupRead      = "backup:read"
    ScopeBackupWrite     = "backup:write"
    ScopeMarketplaceRead = "marketplace:read"
    ScopeMarketplaceTrade = "marketplace:trade"
)
```

Add Go and TypeScript fixtures asserting the exact same message:

```text
NimConnect authorization v3
App: nimworld
Address: NQ...
Access: friends:read, friends:write, inbox:read
Expires: 2026-08-12T12:00:00Z
Nonce: AbCdEfGhIjKlMnOpQrStUw
```

Tests must reject unknown scopes, duplicates after canonicalization, invalid audiences, expiry beyond seven days, and unsorted output. They must verify UTF-8 byte identity, not merely field equality.

**Step 2: Run tests to verify they fail**

```bash
cd backend && go test ./... -run TestAuthorizationMessage -count=1
npm run test:profile-client -- --run session.test.ts
```

Expected: FAIL because the v3 formatter and scope types do not exist.

**Step 3: Implement the canonical protocol**

Export this TypeScript contract:

```ts
export type AuthScope =
  | 'friends:read' | 'friends:write'
  | 'inbox:read' | 'inbox:send' | 'inbox:delete'
  | 'profile:write'
  | 'backup:read' | 'backup:write'
  | 'marketplace:read' | 'marketplace:trade'

export interface AuthorizationChallenge {
  challengeId: string
  message: string
  address: string
  audience: string
  scopes: AuthScope[]
  expiresAt: number
}
```

Use normalized compact uppercase addresses, lexicographically sorted scopes, RFC3339 UTC seconds, and base64url nonces without padding. Preserve existing v1/v2 helpers for compatibility.

**Step 4: Run tests to verify they pass**

Run both commands from Step 2 plus:

```bash
npm run build -w @nimconnect/profile-client
```

Expected: protocol tests PASS and profile-client build PASS.

**Step 5: Commit**

```bash
git add backend/auth_protocol.go backend/auth_protocol_test.go packages/profile-client/src/session.ts packages/profile-client/src/session.test.ts packages/profile-client/src/types.ts
git commit -m "feat: define scoped authorization protocol"
```

### Task 3: Implement challenge and session HTTP APIs

**Files:**
- Create: `backend/auth_handlers.go`
- Create: `backend/auth_handlers_test.go`
- Modify: `backend/main.go`
- Modify: `backend/user_session_handlers.go`
- Modify: `backend/user_session_handlers_test.go`

**Step 1: Write failing handler tests**

Cover:

- `POST /api/auth/challenges` returns the canonical server message;
- unknown/disabled audience, unregistered origin, and scope escalation return `403`;
- malformed wallet/scopes return `400`;
- `POST /api/auth/sessions` verifies the wallet signature and consumes the challenge;
- replay and expired challenge return `401`;
- the response exposes plaintext token exactly once plus wallet/audience/scopes/expiry;
- `GET /api/auth/session` returns current grant metadata;
- `DELETE /api/auth/session` revokes only the current grant;
- `DELETE /api/auth/sessions` revokes all grants for the current wallet; and
- existing `/api/session` v1/v2 tests continue passing unchanged.

Use a real test key pair and the repository's `nimiqSignedMessageHash` helper.

**Step 2: Run tests to verify they fail**

```bash
cd backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" go test ./... -run 'TestAuthHandlers|TestUserSessionLoginHandler' -count=1
```

Expected: FAIL with missing handlers/routes.

**Step 3: Implement minimal handlers and routing**

Use request/response shapes:

```go
type createChallengeRequest struct {
    Address  string   `json:"address"`
    Audience string   `json:"audience"`
    Scopes   []string `json:"scopes"`
}

type exchangeChallengeRequest struct {
    ChallengeID string `json:"challenge_id"`
    PublicKey   string `json:"public_key"`
    Signature   string `json:"signature"`
}
```

Limit request bodies and never echo signature material in errors. Read the
unconsumed challenge, verify the signature over its stored canonical message,
then use a conditional `UPDATE ... WHERE consumed_at IS NULL` to claim it.
Only the request that successfully claims the challenge may issue a session.
An invalid signature must not burn another user's challenge.

Construct `AuthStore` from the existing database in `main.go`. Keep `NewUserSessions()` only for the compatibility routes until their later removal.

**Step 4: Run tests to verify they pass**

Run Step 2, then:

```bash
cd backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" go test -race ./... -count=1
```

Expected: handler tests and full backend suite PASS.

**Step 5: Commit**

```bash
git add backend/auth_handlers.go backend/auth_handlers_test.go backend/main.go backend/user_session_handlers.go backend/user_session_handlers_test.go
git commit -m "feat: issue scoped authorization sessions"
```

### Task 4: Add bearer middleware, registry-backed CORS, and scoped friends

**Files:**
- Create: `backend/auth_middleware.go`
- Create: `backend/auth_middleware_test.go`
- Modify: `backend/cors.go`
- Modify: `backend/cors_test.go`
- Modify: `backend/friends_handlers.go`
- Modify: `backend/friends_handlers_test.go`
- Modify: `backend/main.go`

**Step 1: Write failing authorization tests**

Assert that middleware:

- accepts `Authorization: Bearer <token>` only;
- derives the actor from the session;
- checks an exact required scope;
- rejects expired, revoked, wrong-scope, and disabled-app sessions;
- never accepts an `X-NimConnect-Session` token on the new scoped path; and
- never logs or returns the token.

Add friends tests proving reads require `friends:read`, mutations require
`friends:write`, and a request body/path cannot change the authenticated actor.
Keep explicit compatibility tests for v1/v2 `X-NimConnect-Session` during the
one-release migration window.

Add CORS tests proving registered origins work for auth/scoped endpoints,
unregistered origins receive no allow-origin header, `Authorization` is in
`Access-Control-Allow-Headers`, and public reads remain `*`.

**Step 2: Run tests to verify they fail**

```bash
cd backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" go test ./... -run 'TestRequireScope|TestScopedFriends|TestCORS' -count=1
```

Expected: FAIL because bearer middleware and registry-backed CORS are absent.

**Step 3: Implement middleware and migrate friends**

Represent authenticated context explicitly:

```go
type AuthActor struct {
    SessionID string
    Address   string
    Audience  string
    Scopes    map[string]struct{}
}

func requireScope(store *AuthStore, scope string, next func(http.ResponseWriter, *http.Request, AuthActor)) http.HandlerFunc
```

Do not trust an audience header supplied by the client; use the stored grant.
Change CORS to consult the app registry for protected routes while retaining
`ALLOWED_ORIGIN` only for unmigrated compatibility routes.

**Step 4: Run tests to verify they pass**

Run Step 2 and the full backend race suite.

Expected: all PASS.

**Step 5: Commit**

```bash
git add backend/auth_middleware.go backend/auth_middleware_test.go backend/cors.go backend/cors_test.go backend/friends_handlers.go backend/friends_handlers_test.go backend/main.go
git commit -m "feat: enforce scoped bearer authorization"
```

### Task 5: Upgrade `@nimconnect/profile-client` to v3 sessions

**Files:**
- Modify: `packages/profile-client/src/client.ts`
- Modify: `packages/profile-client/src/types.ts`
- Modify: `packages/profile-client/src/session.test.ts`
- Modify: `packages/profile-client/README.md`
- Modify: `packages/profile-client/package.json`

**Step 1: Write failing client tests**

Test the complete request order:

1. create challenge with address/audience/scopes;
2. pass the exact server-returned message to `signMessage`;
3. exchange challenge ID/public key/signature;
4. store token/grant metadata in the client; and
5. send `Authorization: Bearer` on friends requests.

Also test cancellation, 401 errors, canonical server scope response, session
inspection/revocation, and the unchanged v1/v2 compatibility path.

**Step 2: Run tests to verify they fail**

```bash
npm run test:profile-client -- --run session.test.ts
```

Expected: FAIL because `createAuthorization`, scope metadata, and bearer headers do not exist.

**Step 3: Implement the minimal client API**

Add:

```ts
createAuthorization(args: {
  address: string
  scopes: AuthScope[]
  signMessage: SignMessageFn
}): Promise<AuthSession>
getAuthorization(): AuthSession | null
revokeAuthorization(all?: boolean): Promise<void>
```

Require an `audience` for v3. Keep `createSession` as the documented deprecated
compatibility method. Bump the package to `0.8.0`; do not publish yet.

**Step 4: Run tests to verify they pass**

```bash
npm run test:profile-client
npm run build -w @nimconnect/profile-client
```

Expected: all profile-client tests and build PASS.

**Step 5: Commit**

```bash
git add packages/profile-client/src/client.ts packages/profile-client/src/types.ts packages/profile-client/src/session.test.ts packages/profile-client/README.md packages/profile-client/package.json package-lock.json
git commit -m "feat: add scoped authorization client"
```

### Task 6: Add one shared NimConnect authorization session in the SPA

**Files:**
- Create: `src/services/authorization.ts`
- Create: `src/services/authorization.test.ts`
- Modify: `src/db/db.ts`
- Modify: `src/db/db.test.ts`
- Modify: `src/services/friends.ts`
- Modify: `src/services/wallet-bootstrap.ts`
- Modify: `src/pages/SettingsPage.vue`
- Modify: `src/pages/SettingsPage.test.ts`

**Step 1: Write failing session UX tests**

Test that:

- authorization is stored in Dexie/IndexedDB under audience + compact wallet;
- concurrent scope requests cause one wallet prompt;
- an existing grant is reused when it contains the requested scopes;
- requesting a missing scope signs one replacement union grant, never silently broadens;
- expiry or `401` clears the grant and retries the original operation at most once;
- account switching clears/revokes the old wallet grant;
- logout revokes current session and “log out everywhere” revokes all; and
- cancelled authorization leaves the original action unchanged.

**Step 2: Run tests to verify they fail**

```bash
npm test -- --run src/services/authorization.test.ts src/db/db.test.ts src/pages/SettingsPage.test.ts
```

Expected: FAIL because the shared authorization service/storage is absent.

**Step 3: Implement the shared service**

Expose:

```ts
export async function ensureAuthorization(scopes: AuthScope[]): Promise<AuthSession>
export async function authorizedFetch(path: string, scopes: AuthScope[], init?: RequestInit): Promise<Response>
export async function revokeAuthorization(all?: boolean): Promise<void>
export function clearLocalAuthorization(): Promise<void>
```

Resolve the real wallet signer through the existing Nimiq Pay/Hub paths. Store
no signature or plaintext challenge after exchange. Replace the friends-only
`sessionStorage` cache with this service and keep one in-flight authorization
promise.

**Step 4: Run tests to verify they pass**

Run Step 2, then:

```bash
npm test
npm run build
```

Expected: frontend tests and production build PASS.

**Step 5: Commit**

```bash
git add src/services/authorization.ts src/services/authorization.test.ts src/db/db.ts src/db/db.test.ts src/services/friends.ts src/services/wallet-bootstrap.ts src/pages/SettingsPage.vue src/pages/SettingsPage.test.ts
git commit -m "feat: reuse one scoped app authorization"
```

### Task 7: Migrate inbox authorization without weakening sender checks

**Files:**
- Modify: `backend/inbox.go`
- Modify: `backend/inbox_store.go`
- Modify: `backend/inbox_store_test.go`
- Modify: `backend/inbox_handlers.go`
- Modify: `backend/inbox_handlers_test.go`
- Modify: `src/services/inbox.ts`
- Modify: `src/services/inbox.test.ts`
- Modify: `src/services/inbox-import.ts`
- Modify: `src/services/inbox-import.test.ts`
- Create: `backend/migrations/003_authorization_provenance.sql`
- Modify: `backend/migration_rehearsal_test.go`

**Step 1: Write failing scoped inbox tests**

Cover `inbox:read`, `inbox:send`, and `inbox:delete` separately. Assert the
session wallet is always the sender for new messages and always equals the
mailbox address for reads/deletes. Reject body/path substitution. Preserve
payload-recipient-equals-sender classification, quotas, nonce idempotency,
timestamps, retention, and legacy signed envelopes.

Migration `003` adds provenance columns (`auth_mode`, `auth_session_id`,
`auth_audience`) to inbox messages and profiles, and makes their legacy
`public_key`/`signature` fields nullable. Existing rows are backfilled as
`auth_mode = 'wallet_signature'`. Test both row modes and migration rehearsal.
Never amend migration `002` after it has been applied.

**Step 2: Run tests to verify they fail**

```bash
cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" go test ./... -run 'TestInbox.*Scoped|TestInboxStore' -count=1
npm test -- --run src/services/inbox.test.ts src/services/inbox-import.test.ts
```

Expected: FAIL because inbox accepts only wallet-signature authorization.

**Step 3: Implement scoped and compatibility paths**

Add a session-authorized store method whose actor is an argument, not a JSON
field. Keep `Put` as the legacy signed path for one release. Update the SPA to
use `authorizedFetch` and remove per-send/read wallet signing from the new path.
Do not claim that the recipient independently verifies new session-authorized
envelopes; it trusts the authenticated NimConnect service as designed.

**Step 4: Run tests to verify they pass**

Run Step 2 plus full Go race tests, frontend tests, and build.

Expected: all PASS.

**Step 5: Commit**

```bash
git add backend/inbox.go backend/inbox_store.go backend/inbox_store_test.go backend/inbox_handlers.go backend/inbox_handlers_test.go backend/migrations/003_authorization_provenance.sql backend/migration_rehearsal_test.go src/services/inbox.ts src/services/inbox.test.ts src/services/inbox-import.ts src/services/inbox-import.test.ts
git commit -m "feat: authorize inbox with scoped sessions"
```

### Task 8: Migrate profiles and encrypted backups

**Files:**
- Modify: `backend/profiles.go`
- Modify: `backend/profiles_test.go`
- Modify: `backend/handles_handlers.go`
- Modify: `backend/handles_handlers_test.go`
- Modify: `backend/backup.go`
- Modify: `backend/backup_handlers.go`
- Modify: `backend/auth_test.go`
- Modify: `src/services/handles.ts`
- Modify: `src/services/handles.test.ts`
- Modify: `src/services/cloud-backup.ts`
- Modify: `src/services/cloud-backup.test.ts`

**Step 1: Write failing scope and regression tests**

Profiles:

- `profile:write` authorizes put/delete only for the session wallet;
- payload schema, size caps, monotonic `updated_at`, and public reads remain unchanged;
- legacy signed profiles remain readable/writable during compatibility; and
- provenance mode is explicit rather than represented by fake signatures.

Backups:

- `backup:read` protects GET and HEAD for only the session wallet;
- `backup:write` protects PUT for only the session wallet;
- v2 format, salt/ciphertext/KDF bounds, ciphertext hash validation, body caps,
  monotonic export time, and atomic file replacement remain enforced; and
- legacy signed PUT remains accepted for one release.

**Step 2: Run tests to verify they fail**

```bash
cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" go test ./... -run 'TestProfile.*Scoped|TestBackup.*Scoped|TestBackup' -count=1
npm test -- --run src/services/handles.test.ts src/services/cloud-backup.test.ts
```

Expected: FAIL because these operations still sign individually.

**Step 3: Implement scoped paths**

Split data validation/persistence from legacy signature verification so both
authorization modes call the same validated write function. For backups, keep
checking the decoded ciphertext hash even though it is no longer signed per
write; this detects malformed/corrupt envelopes and preserves the v2 format.
Never make plaintext backup contents available to the backend.

**Step 4: Run tests to verify they pass**

Run Step 2 plus full backend/frontend suites and build.

Expected: all PASS.

**Step 5: Commit**

```bash
git add backend/profiles.go backend/profiles_test.go backend/handles_handlers.go backend/handles_handlers_test.go backend/backup.go backend/backup_handlers.go backend/auth_test.go src/services/handles.ts src/services/handles.test.ts src/services/cloud-backup.ts src/services/cloud-backup.test.ts
git commit -m "feat: scope profile and backup operations"
```

### Task 9: Migrate off-chain marketplace intents only

**Files:**
- Modify: `backend/marketplace_handlers.go`
- Modify: `backend/marketplace_handlers_test.go`
- Modify: `backend/marketplace_intents.go`
- Modify: `backend/marketplace_intents_test.go`
- Modify: `src/services/marketplace.ts`
- Modify: `src/services/marketplace.test.ts`
- Modify: `src/pages/desktop/DesktopMarketplaceBuyPage.vue`
- Modify: `src/pages/desktop/DesktopMarketplaceBuyPage.test.ts`
- Modify: `src/pages/desktop/DesktopMarketplaceSellPage.vue`
- Modify: `src/pages/desktop/DesktopMarketplaceSellPage.test.ts`
- Modify: `src/pages/desktop/DesktopIdentityPage.vue`
- Modify: `src/pages/desktop/DesktopIdentityPage.test.ts`

**Step 1: Write failing marketplace boundary tests**

Assert:

- wallet trade history requires `marketplace:read` and actor/path equality;
- list, reserve, and cancel require `marketplace:trade`;
- seller/buyer/actor always comes from the session;
- on-chain ownership epoch, fee cap, refund address validity, nonce replay,
  deposit deadlines, and trade-state rules remain enforced;
- release and claim transaction submission do **not** accept session authority
  as a substitute for a real chain transaction; and
- legacy signed intents still pass during migration.

**Step 2: Run tests to verify they fail**

```bash
cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" go test ./... -run 'TestMarketplace.*Scoped|TestMarketplace.*Signature' -count=1
npm test -- --run src/services/marketplace.test.ts src/pages/desktop/DesktopMarketplaceBuyPage.test.ts src/pages/desktop/DesktopMarketplaceSellPage.test.ts src/pages/desktop/DesktopIdentityPage.test.ts
```

Expected: FAIL because marketplace off-chain actions still sign per request.

**Step 3: Implement the scoped marketplace path**

Remove actor public key/signature fields only from the new scoped request
shapes. Keep operation nonces for replay/idempotency. Continue looking up the
current on-chain handle owner before listing. Leave `submitRelease` and
`submitClaim` transaction payloads and wallet confirmations unchanged.

**Step 4: Run tests to verify they pass**

Run Step 2 plus full suites and build.

Expected: all PASS, including explicit tests that real chain actions still call
the wallet transaction API.

**Step 5: Commit**

```bash
git add backend/marketplace_handlers.go backend/marketplace_handlers_test.go backend/marketplace_intents.go backend/marketplace_intents_test.go src/services/marketplace.ts src/services/marketplace.test.ts src/pages/desktop/DesktopMarketplaceBuyPage.vue src/pages/desktop/DesktopMarketplaceBuyPage.test.ts src/pages/desktop/DesktopMarketplaceSellPage.vue src/pages/desktop/DesktopMarketplaceSellPage.test.ts src/pages/desktop/DesktopIdentityPage.vue src/pages/desktop/DesktopIdentityPage.test.ts
git commit -m "feat: scope off-chain marketplace intents"
```

### Task 10: Integrate NimWorld with one v3 authorization

**Files (NimWorld worktree):**
- Modify: `/home/maestro/Documents/projects/NimWorld/apps/web/src/auth/session.ts`
- Modify: `/home/maestro/Documents/projects/NimWorld/apps/web/src/auth/session.test.ts`
- Modify: `/home/maestro/Documents/projects/NimWorld/apps/web/src/adapters/nimconnect/friendsSession.ts`
- Modify: `/home/maestro/Documents/projects/NimWorld/apps/web/src/adapters/nimconnect/friendsSession.test.ts`
- Modify: `/home/maestro/Documents/projects/NimWorld/apps/web/src/adapters/nimconnect/ProfileClientNimConnectAdapter.ts`
- Modify: `/home/maestro/Documents/projects/NimWorld/apps/web/package.json`
- Modify: `/home/maestro/Documents/projects/NimWorld/package-lock.json`
- Modify only if still needed after the shared signature is adopted: `/home/maestro/Documents/projects/NimWorld/apps/api/main.go`
- Test only if API auth changes: `/home/maestro/Documents/projects/NimWorld/apps/api/main_test.go`

**Step 1: Write failing single-prompt integration tests**

Test that NimWorld requests its configured subset under audience `nimworld`,
stores its own v3 token, and initializes friends without a second wallet
signature. The same signed canonical v3 message may be verified by NimWorld's
backend for its own session, but the NimConnect bearer token must never become
the NimWorld cookie and must never be usable under audience `nimconnect`.

Test expiry, account switching, logout, cancellation, and Nimiq Pay/Hub paths.

**Step 2: Run tests to verify they fail**

```bash
cd /path/to/nimworld-worktree
npm test -- --run apps/web/src/auth/session.test.ts apps/web/src/adapters/nimconnect/friendsSession.test.ts apps/web/src/adapters/nimconnect/friends.test.ts
```

Expected: FAIL because login and friends currently produce separate authorization flows and use sessionStorage.

**Step 3: Implement the NimWorld consumer**

Upgrade to `@nimconnect/profile-client@0.8.0` (or workspace/tarball during local
integration). Use one v3 message and one wallet call, then give the signature
response to both verifiers. Persist only NimWorld's NimConnect grant in its
IndexedDB storage. Request the minimal currently used scope set, initially
`friends:read` and `friends:write`.

Do not grant backup/profile/inbox/marketplace scopes until NimWorld ships a
feature that calls them.

**Step 4: Run tests to verify they pass**

```bash
npm test
npm run build
cd apps/api && go test ./...
```

Expected: NimWorld frontend tests/build and API tests PASS.

**Step 5: Commit in the NimWorld repository**

```bash
git add apps/web/src/auth/session.ts apps/web/src/auth/session.test.ts apps/web/src/adapters/nimconnect/friendsSession.ts apps/web/src/adapters/nimconnect/friendsSession.test.ts apps/web/src/adapters/nimconnect/ProfileClientNimConnectAdapter.ts apps/web/package.json package-lock.json apps/api/main.go apps/api/main_test.go
git commit -m "feat: reuse scoped NimConnect authorization"
```

Stage only files actually changed; omit the API files when the existing backend
can verify the shared v3 message without modification.

### Task 11: Document compatibility and operator configuration

**Files:**
- Create: `docs/api/scoped-authorization.md`
- Modify: `docs/api/friends.md`
- Modify: `backend/README.md`
- Modify: `packages/profile-client/README.md`
- Modify: `README.md`
- Modify: `docker-compose.yml`

**Step 1: Write a documentation checklist test/review fixture**

Create a checklist in the new API document covering exact endpoints, canonical
message, scope table, error statuses, origin registration, seven-day expiry,
revocation, compatibility sunset, and the explicit on-chain exclusion. Add a
test or static assertion where practical that every documented scope is in the
closed code set.

**Step 2: Run the static check to expose missing documentation**

```bash
rg -n 'friends:read|inbox:send|backup:write|marketplace:trade' docs/api/scoped-authorization.md
```

Expected before completion: one or more required scope/contract sections absent.

**Step 3: Complete documentation and local configuration**

Document safe app-registry seeding/updates, registered origins for local and
production deployments, migration order, token secrecy, and rollback. State
that v1/v2 and per-action signed requests remain for one compatibility release;
do not set an unplanned deletion date.

**Step 4: Verify docs and examples**

```bash
rg -n 'seven days|Authorization: Bearer|on-chain|compatibility' docs/api/scoped-authorization.md packages/profile-client/README.md backend/README.md
npm run build -w @nimconnect/profile-client
```

Expected: all required contract language is present and examples compile.

**Step 5: Commit**

```bash
git add docs/api/scoped-authorization.md docs/api/friends.md backend/README.md packages/profile-client/README.md README.md docker-compose.yml
git commit -m "docs: document scoped app authorization"
```

### Task 12: Run final security, migration, and device verification

**Files:**
- Modify if defects are found: tests and implementation files from Tasks 1-11
- Create: `docs/qa/2026-08-05-scoped-authorization-smoke.md`

**Step 1: Run all automated gates**

```bash
npm test
npm run test:profile-client
npm run build
cd backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" go test -race ./... -count=1
```

Expected: all tests PASS, production builds PASS, and no race failures.

**Step 2: Rehearse database upgrade and multi-instance use**

Apply migrations to the guarded test database, create a grant through backend
instance A, use it through instance B, revoke it through B, and confirm A
rejects it. Verify existing profiles, inbox messages, friendships, backups, and
marketplace data remain usable.

Expected: no data loss; cross-instance issuance/use/revocation works.

**Step 3: Verify the complete message in Nimiq Pay**

Use the Android emulator/device workflow to sign the longest production scope
message. Confirm it renders readably, signs successfully, and exchanges for a
grant. If the emulator is locked, ask the user for the current-session unlock;
never store it.

Expected: one authorization prompt and no truncation/bridge error.

**Step 4: Run end-to-end UX smoke tests**

In NimConnect, authorize once, then exercise friends, inbox send/read/delete,
profile edit, backup upload/download, and marketplace lookup/list/reserve/cancel.
Confirm none produces another wallet-signature prompt. Then pay, claim/release
a handle, or use a safe transaction test path and confirm Nimiq Pay still asks
for explicit transaction approval.

In NimWorld, log in once and open/use friends. Confirm there is no second
signature prompt and the NimWorld token cannot call a NimConnect-audience-only
grant.

**Step 5: Record evidence and commit any test fixes**

Record exact commands, app versions, tested audiences/scopes, emulator result,
and any intentionally untested real-money action in the QA smoke document.

```bash
git add docs/qa/2026-08-05-scoped-authorization-smoke.md
git commit -m "test: verify scoped authorization end to end"
```

Do not claim completion until `@superpowers:verification-before-completion` has
been followed against the final tree in both repositories.
