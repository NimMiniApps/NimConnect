# Ecosystem Awards and App Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose a wallet's live app grants, mirror NimiqMiniApps catalog identity into NimConnect for consent and declared-scope enforcement, and let registered apps award idempotent achievements with visibility-aware profile reads.

**Architecture:** Build on the existing audience-and-capability session tables (`auth_apps`, `auth_sessions`, `auth_app_scopes`, `auth_app_origins`). Mirror catalog app records into `auth_apps` (identity + declared scopes + launch origins + optional app API key hash). List grants from live sessions; award via app API keys into a new `awards` table keyed by `(app_id, achievement_id, address)`; profile reads honour `visibility` and `achievements:read`.

**Tech Stack:** Go 1.24 HTTP backend, PostgreSQL migrations via embedded SQL, existing `AuthStore` / first-party `UserSessions`, Go integration tests against the guarded test database.

---

## Execution prerequisites

- Use `@superpowers:using-git-worktrees` to create an isolated worktree (preferred: `.worktrees/`, already ignored). Do **not** implement directly on dirty `main` without explicit consent.
- Use `@superpowers:test-driven-development` for every task below.
- Before PostgreSQL integration tests or migrations, load and follow `@database-safety-guard`. Target only a DB name containing `test` / `_test` (project fallback: `postgres://nimconnect:nimconnect@127.0.0.1:5432/nimconnect_scoped_auth_test?sslmode=disable`).
- **Never stage** unrelated `security_best_practices_report.md`.
- **Out of scope:** item trading / escrow reuse (design phase 4). Do not invent inventory tables.
- **Open-question defaults** (locked for this slice):
  1. App award credentials are issued by NimConnect admin (`POST /api/admin/apps/{audience}/api-key`); catalog registration does not mint them yet.
  2. Awards are not revocable in v1.
  3. `rarity` and `progress` are app-declared and untrusted — store and return verbatim; never imply verification.

### Working-tree note

Uncommitted WIP on `main` may already contain most of Tasks 1–5. If so: move those files into the feature worktree (or cherry-pick/copy), treat the plan as the acceptance checklist, fill any missing tests (especially scope-escalation re-consent), and only rewrite code that fails the checklist.

---

### Task 1: Migration — registry mirror columns and awards table

**Files:**
- Create: `backend/migrations/004_awards_and_app_registry.sql`
- Modify: `backend/db_test.go` (seed scope counts + `auth_apps` columns + `awards` schema)
- Modify: `backend/migration_rehearsal_test.go` (nimconnect/nimworld scope counts after `achievements:read`)

**Step 1: Write the failing migration / schema tests**

Extend `TestOpenAndMigrateCreatesScopedAuthorizationSchema` (or add a sibling) so that after `Migrate`:

- `auth_apps` has columns `icon_url`, `verified`, `owner_id`, `api_key_hash`
- `awards` exists with unique `(app_id, achievement_id, address)` and visibility check constraint
- seed scopes include `achievements:read` for both `nimconnect` and `nimworld`
- `schema_migrations` records `004_awards_and_app_registry`
- cutover rehearsal counts: nimconnect scopes = 11, nimworld scopes = 3

**Step 2: Run test to verify it fails**

```bash
cd backend
TEST_DATABASE_URL='postgres://nimconnect:nimconnect@127.0.0.1:5432/nimconnect_scoped_auth_test?sslmode=disable' \
  go test ./... -run 'TestOpenAndMigrateCreatesScopedAuthorizationSchema|TestProductionCutoverFrom001ToScopedAuthorizationPreservesRows' -count=1
```

Expected: FAIL (missing columns / wrong scope counts / no `004`).

**Step 3: Write the migration**

```sql
-- Catalog-as-registry mirror fields, and app-authenticated achievement awards.
ALTER TABLE auth_apps ADD COLUMN IF NOT EXISTS icon_url TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_apps ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auth_apps ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_apps ADD COLUMN IF NOT EXISTS api_key_hash BYTEA CHECK (api_key_hash IS NULL OR octet_length(api_key_hash) = 32);

INSERT INTO auth_app_scopes (audience, scope) VALUES
  ('nimconnect', 'achievements:read'),
  ('nimworld', 'achievements:read')
ON CONFLICT (audience, scope) DO NOTHING;

-- rarity and progress are app-declared and untrusted: NimConnect stores and
-- returns them as-is, it does not verify them against any game state.
CREATE TABLE IF NOT EXISTS awards (
  id BIGSERIAL PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES auth_apps(audience),
  achievement_id TEXT NOT NULL,
  address TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL DEFAULT '',
  progress JSONB,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, achievement_id, address)
);
CREATE INDEX IF NOT EXISTS awards_address ON awards (address, granted_at DESC);
```

**Step 4: Run tests to verify they pass**

Same command as Step 2 — Expected: PASS.

**Step 5: Commit**

```bash
git add backend/migrations/004_awards_and_app_registry.sql backend/db_test.go backend/migration_rehearsal_test.go
git commit -m "$(cat <<'EOF'
feat: add awards schema and catalog mirror columns

EOF
)"
```

---

### Task 2: `GET /api/authorizations` — list live grants

**Files:**
- Modify: `backend/auth_store.go` (`AuthorizedApp`, `ListGrants`)
- Create: `backend/authorizations_handlers.go`
- Create: `backend/authorizations_handlers_test.go`
- Modify: `backend/main.go` (route)

**Step 1: Write the failing test**

```go
func TestAuthorizationsListHandlerRequiresFirstPartySession(t *testing.T) {
	// withTestDB + AuthStore + UserSessions
	// Issue a scoped session for nimworld
	// GET /api/authorizations without X-NimConnect-Session → 401
	// With first-party session → 200 and body contains "nimworld"
	// Response fields: audience, display_name, icon_url, verified, scopes, granted_at, expires_at
}
```

Also unit-test `ListGrants`: revoked and expired sessions excluded; disabled apps excluded.

**Step 2: Run test to verify it fails**

```bash
cd backend
go test ./... -run 'TestAuthorizationsListHandler|TestListGrants' -count=1
```

Expected: FAIL (missing handler / `ListGrants`).

**Step 3: Minimal implementation**

- `ListGrants(address)` joins `auth_sessions` → `auth_apps`, filters `revoked_at IS NULL`, `expires_at > now()`, `enabled`, newest first.
- Handler uses `requireUserSession` only (never a third-party scoped token — that token must not enumerate other apps' grants).
- Register `GET /api/authorizations`.

**Step 4: Run tests — Expected: PASS**

**Step 5: Commit**

```bash
git add backend/auth_store.go backend/authorizations_handlers.go backend/authorizations_handlers_test.go backend/main.go
git commit -m "$(cat <<'EOF'
feat: list a wallet's authorized apps

EOF
)"
```

---

### Task 3: Catalog mirror — UpsertApp, GetApp, re-consent, API keys

**Files:**
- Create: `backend/app_registry.go`
- Create: `backend/app_registry_handlers.go`
- Create: `backend/app_registry_test.go`
- Modify: `backend/main.go`
- Modify: `backend/auth_protocol.go` (ensure `ScopeAchievementsRead` is in `authorizationScopes`)

**Step 1: Write the failing tests**

```go
func TestUpsertAppRevokesSessionsOnScopeChangeAndOwnerChange(t *testing.T) {
	// Upsert app owner-a + friends:read; IssueSession; ListGrants → 1
	// Upsert rename same owner/scopes → session survives
	// Upsert owner-b → ListGrants → 0
	// Re-issue session; Upsert with scopes:read+write (escalation) → ListGrants → 0
}

func TestAppAPIKeyRoundTrip(t *testing.T) {
	// IssueAppAPIKey → ResolveAppByAPIKey matches audience; wrong key fails
}
```

HTTP:
- `GET /api/apps/{audience}` public → display_name, icon_url, verified, scopes, origins (no `owner_id`, no key material)
- `POST /api/admin/apps` requires admin session; upserts mirror
- `POST /api/admin/apps/{audience}/api-key` returns plaintext once

**Step 2: Run — Expected: FAIL**

**Step 3: Implement**

`UpsertApp`:
- Validate audience regex + every scope ∈ `authorizationScopes`
- Replace scopes/origins sets
- If prior row existed and `owner_id` changed **or** declared scope set changed → revoke all live sessions for that audience
- Name/icon/verified updates alone do **not** revoke

`IssueAppAPIKey` / `ResolveAppByAPIKey`: 32 random bytes, `base64.RawURLEncoding`, store `sha256` only (same discipline as session tokens).

Routes:
- `GET /api/apps/{audience}`
- `POST /api/admin/apps`
- `POST /api/admin/apps/{audience}/api-key`

Declared-scope enforcement for grants already lives in `AuthStore.ValidateScopes` / challenge creation — do not bypass it. Exact-match launch origins already live in `OriginAllowed` — ensure upserted origins are what CORS/challenge admission use.

**Step 4: Run — Expected: PASS**

**Step 5: Commit**

```bash
git add backend/app_registry.go backend/app_registry_handlers.go backend/app_registry_test.go backend/auth_protocol.go backend/main.go
git commit -m "$(cat <<'EOF'
feat: mirror catalog apps and revoke on ownership or scope change

EOF
)"
```

---

### Task 4: Awards store — idempotent grant + visibility

**Files:**
- Create: `backend/awards.go`
- Create: `backend/awards_test.go`

**Step 1: Write the failing tests**

```go
func TestAwardGrantIsIdempotent(t *testing.T) {
	// Grant twice with different title → second returns first row unchanged; list length 1
}

func TestAwardVisibilityHidesPrivateFromPublicReads(t *testing.T) {
	// public + private grants; ListForAddress(..., false) → public only
	// ListForAddress(..., true) → both
}
```

Also reject invalid address / empty achievement_id / oversized fields / bad visibility / invalid progress JSON.

**Step 2: Run — Expected: FAIL**

**Step 3: Implement `AwardStore`**

```go
// Grant: INSERT ... ON CONFLICT (app_id, achievement_id, address) DO NOTHING
// then SELECT the stored row (retry-safe, history replay-safe)
// rarity/progress stored verbatim; never validated against game state
```

**Step 4: Run — Expected: PASS**

**Step 5: Commit**

```bash
git add backend/awards.go backend/awards_test.go
git commit -m "$(cat <<'EOF'
feat: persist idempotent app awards with visibility

EOF
)"
```

---

### Task 5: Awards HTTP — create + profile achievements

**Files:**
- Create: `backend/awards_handlers.go`
- Create: `backend/awards_handlers_test.go`
- Modify: `backend/main.go`

**Step 1: Write the failing tests**

```go
func TestAwardsCreateHandlerRequiresAppCredential(t *testing.T) {
	// POST /api/awards without Bearer → 401
	// With app API key → 200, body has achievement_id
}

func TestAchievementsListHandlerHidesPrivateFromAnonymousReaders(t *testing.T) {
	// anonymous GET /api/profiles/{address}/achievements → public only
	// Bearer scoped session with achievements:read for same wallet → includes private
}
```

**Step 2: Run — Expected: FAIL**

**Step 3: Implement**

- `POST /api/awards` — `ResolveAppByAPIKey(bearerToken)`; body has no `app_id` (derived from key); call `Grant`
- `GET /api/profiles/{address}/achievements` — public by default; `includePrivate` only when `resolveScopedActor(..., ScopeAchievementsRead)` matches path address

**Step 4: Full verification**

```bash
cd backend
TEST_DATABASE_URL='postgres://nimconnect:nimconnect@127.0.0.1:5432/nimconnect_scoped_auth_test?sslmode=disable' \
  go test -race ./... -count=1
```

Expected: PASS (skip only if Postgres unavailable and tests correctly skip).

**Step 5: Commit**

```bash
git add backend/awards_handlers.go backend/awards_handlers_test.go backend/main.go
git commit -m "$(cat <<'EOF'
feat: expose award grant and profile achievements APIs

EOF
)"
```

---

### Task 6: Design doc status + acceptance checklist

**Files:**
- Modify: `docs/plans/2026-08-07-ecosystem-awards-and-app-registry-design.md` (status → approved/implemented for phases 1–3)

**Step 1: Walk the design checklist**

| Design requirement | Acceptance |
|---|---|
| `GET /api/authorizations` session-auth, live grants only | Task 2 |
| Mirror id/name/icon/verified/scopes/origins | Task 3 |
| Consent identity via `GET /api/apps/{audience}` | Task 3 |
| Declared-scope enforcement on grant | Existing `ValidateScopes` + upsert scopes |
| Exact-match launch origins | Existing `OriginAllowed` + upsert origins |
| Re-consent on ownership transfer | Upsert revokes sessions |
| Re-consent on scope escalation | Upsert revokes sessions (**must be covered by test**) |
| `POST /api/awards` app-key auth, idempotent | Tasks 4–5 |
| `achievements:read` + visibility on profile read | Tasks 1 + 5 |
| No item trading | Explicitly skipped |

**Step 2: If scope-escalation is not asserted in tests, add the assertion and re-run Task 3 tests.**

**Step 3: Commit**

```bash
git add docs/plans/2026-08-07-ecosystem-awards-and-app-registry-design.md
git commit -m "$(cat <<'EOF'
docs: mark awards and app-registry design phases 1-3 implemented

EOF
)"
```

---

## Done when

- Migration `004` applies idempotently on the guarded test DB
- All three phases from the design (authorizations list, catalog mirror + re-consent, awards) are covered by failing-then-passing tests
- `go test -race ./...` passes in `backend/`
- Item trading remains untouched
