# Admin stats: Nimiq wallet auth + hidden frontend page

## Problem

`GET /api/stats` (daily unique wallets, opens — see `backend/stats.go`) is
currently gated by a static `ADMIN_TOKEN` shared secret compared with
`curl`. There's no UI for it, and the token has to be copy-pasted around
manually. We want the admin to authenticate the same way every other
identity-bound action in this app works — by signing a message with their
Nimiq wallet — and a page to view the numbers that isn't linked from any nav
menu.

## Approach

Reuse the signed-message auth primitive already used for backups
(`backend/auth.go: verifySignedMessage`), issue a short-lived opaque session
token on successful login, and gate `/api/stats` on that token instead of
the static `ADMIN_TOKEN`. Add an unlisted Vue route for the admin to view
the numbers, using the existing Hub sign-message flow
(`src/services/hub.ts`).

## Backend changes

### New file: `backend/admin.go`

- `ADMIN_ADDRESSES` env var: comma-separated Nimiq addresses. Parsed at
  startup into a set of `compactAddress` values.
- `AdminSessions` type: `sync.Mutex` + `map[string]time.Time` (token →
  expiry), matching the existing `Stats` struct's concurrency pattern. No
  external session store or signing secret — single-instance deployment,
  in-memory is sufficient.
  - `Issue() string` — generates a random 32-byte token
    (`crypto/rand`, hex-encoded), stores it with a 24h expiry, returns it.
  - `Valid(token string) bool` — looks up the token, checks expiry, and
    opportunistically evicts expired entries.
- `POST /api/admin/login` handler:
  - Body: `{address, publicKey, signature, timestamp}` (`timestamp` = Unix
    seconds, set by the client at signing time).
  - Reject if `timestamp` is more than 5 minutes from server time (replay
    protection).
  - Reject if `compactAddress(address)` isn't in `ADMIN_ADDRESSES`.
  - Challenge message: `nimconnect-admin-login:v1:<compactAddress>:<timestamp>`,
    verified with the existing `verifySignedMessage`.
  - On success: `{"token": "<session-token>", "expires_at": <unix>}`.
  - On failure: 401 with a generic "unauthorized" error body (no detail on
    *why*, to avoid leaking which addresses are whitelisted).

### `backend/stats.go`

- `statsHandler` signature changes from `(stats *Stats, token string)` to
  `(stats *Stats, sessions *AdminSessions)`.
- Auth check becomes: read `X-Admin-Session` header, `sessions.Valid(...)`.
  401 if missing/invalid/expired.

### `backend/main.go`

- Drop `adminToken := os.Getenv("ADMIN_TOKEN")`.
- Add `adminSessions := NewAdminSessions(parseAdminAddresses(getEnv("ADMIN_ADDRESSES", "")))`.
- Wire `mux.HandleFunc("POST /api/admin/login", adminLoginHandler(adminSessions))`.
- `statsHandler(stats, adminToken)` → `statsHandler(stats, adminSessions)`.

### Docs

- `backend/README.md`: replace the `ADMIN_TOKEN` row with `ADMIN_ADDRESSES`
  (comma-separated whitelist; enables `/api/admin/login` and `/api/stats`).
- `docker-compose.homelab.yml.example`: replace the `ADMIN_TOKEN=...` line
  with `ADMIN_ADDRESSES=<your Nimiq address>`.
- `.env.example`: no change needed (backend-only var, not currently listed
  there for `ADMIN_TOKEN` either).

## Frontend changes

### `src/services/adminAuth.ts` (new)

- `login(): Promise<void>` — calls `chooseHubAddress()` +
  `hubSignMessage()` (existing helpers in `src/services/hub.ts`) over the
  challenge string built the same way the backend builds it, POSTs to
  `/api/admin/login`, stores `{token, expires_at}` under localStorage key
  `nimconnect_admin_session`.
- `getSessionToken(): string | null` — returns the stored token if present
  and not expired (checked client-side against `expires_at`; the server is
  still the source of truth and will 401 independently), else `null` (and
  clears storage if expired).
- `logout(): void` — clears the stored session.
- `fetchStats(): Promise<StatsSummary>` — `GET /api/stats` with
  `X-Admin-Session` header set from `getSessionToken()`. On 401, calls
  `logout()` and rethrows so the page can fall back to the login prompt.

### `src/pages/AdminStatsPage.vue` (new)

- No session → "Connect wallet" button, calls `adminAuth.login()`, then
  loads stats.
- Session present → calls `adminAuth.fetchStats()` on mount, renders:
  - Header numbers: total unique wallets, total opens.
  - Table: day / unique wallets / opens, most recent first.
  - Any error (including a 401 mid-session) falls back to the login
    prompt with a short message.
- Uses existing Nimiq UI kit primitives/styles for consistency with the
  rest of the app (per the `nimiq-ui-kit` skill) — no new component
  library.

### `src/router.ts`

- Add `{ path: '/admin/stats', component: () => import('./pages/AdminStatsPage.vue') }`.
- Not referenced from any nav component, menu, or link — reachable only by
  someone who knows the URL.

## Out of scope

- No acquisition-source/referrer tracking — this only surfaces the
  wallet-open counts already recorded by `Stats`.
- No charts/graphs — a table is enough for the current data shape (few
  dozen days at most); revisit if the dataset or ask grows.
- No multi-admin audit log (who viewed stats when) — not requested.
- No rate limiting on `/api/admin/login` beyond the existing per-address
  whitelist + 5-minute timestamp window — add if abuse is observed.

## Testing

- Go: `admin_test.go` covering `AdminSessions.Issue`/`Valid`/expiry,
  `parseAdminAddresses`, and the login handler (valid signature + whitelisted
  address → token; wrong address, stale timestamp, bad signature → 401).
  `stats_test.go` updated for the new `statsHandler` signature.
- Frontend: a small test for `adminAuth.ts` token storage/expiry logic
  (mirroring existing service test patterns, e.g. `hub.test.ts`).
