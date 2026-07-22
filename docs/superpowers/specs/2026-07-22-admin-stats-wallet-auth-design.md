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
- `AdminSessions` type: owns the whitelist (`map[string]bool` of
  `compactAddress` values), an injectable clock (`now func() time.Time`,
  matching `Stats.now`), and `sync.Mutex` + `map[string]time.Time` (token →
  expiry). No external session store or signing secret — single-instance
  deployment, in-memory is sufficient.
  - `NewAdminSessions(addresses []string) *AdminSessions` — builds the
    whitelist set, defaults `now` to `time.Now`.
  - `IsAdmin(address string) bool` — whitelist check on `compactAddress`.
  - `Issue() (token string, expiresAt time.Time, err error)` — generates a
    random 32-byte token (`crypto/rand`, hex-encoded); returns an error if
    `crypto/rand` fails (caller responds 500) instead of silently
    swallowing it. Stores the token with a 24h expiry from `now()`.
  - `Valid(token string) bool` — looks up the token and checks expiry.
  - `sweep()` — called at the start of `Issue` and `Valid` (cheap, holds
    the lock it already needs) to delete all expired entries, not just the
    one being checked, so unused expired sessions don't accumulate
    unboundedly.
- `POST /api/admin/login` handler:
  - Body: `{address, publicKey, signature, timestamp}` (`timestamp` = Unix
    seconds, set by the client at signing time). Malformed JSON → 400.
  - **This bounds signature freshness, it is not replay prevention.** A
    captured request can be replayed at will until `timestamp` falls
    outside the 5-minute window, minting a fresh 24h session each time.
    Accepted as adequate for a single-admin-address homelab deployment
    where the request travels over HTTPS and the whitelist is small; a
    server-issued single-use nonce is the upgrade path if this ever needs
    real replay resistance. Reject `timestamp` more than 5 minutes from
    server time in either direction (both stale and future-dated values —
    a future timestamp would otherwise extend the usable replay window).
  - Reject if `!sessions.IsAdmin(address)`.
  - Challenge message: `nimconnect-admin-login:v1:<compactAddress>:<timestamp>`,
    verified with the existing `verifySignedMessage`.
  - On success: `{"token": "<session-token>", "expires_at": <unix>}`
    (`expires_at` comes from `Issue`'s return value, not recomputed).
  - On failure: 401 with a generic "unauthorized" error body (no detail on
    *why*, to avoid leaking which addresses are whitelisted). A
    `crypto/rand` failure in `Issue` is a 500, not a 401.

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

### `backend/cors.go`

- Add `X-Admin-Session` to the `Access-Control-Allow-Headers` value in
  `withCORS` (`backend/cors.go:55`), alongside the existing
  `X-Inbox-Public-Key`/`X-Inbox-Signature`/`X-Inbox-Issued-At` entries.
  Without this, a cross-origin browser request to `/api/stats` never gets
  past preflight — production serves the frontend and API from separate
  hosts (see `docs/api/...` / `VITE_API_BASE_URL` in `.env.example`).

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
  `apiUrl('/api/admin/login')` (from `src/services/api.ts`, matching every
  other service — a literal `/api/...` fetch would hit the frontend host
  in production, where the API is served from a separate origin), stores
  `{token, expires_at}` under localStorage key `nimconnect_admin_session`.
- `getSessionToken(): string | null` — returns the stored token if present
  and not expired (checked client-side against `expires_at`; the server is
  still the source of truth and will 401 independently), else `null` (and
  clears storage if expired).
- `logout(): void` — clears the stored session.
- `fetchStats(): Promise<StatsSummary>` — `GET` to `apiUrl('/api/stats')`
  with `X-Admin-Session` header set from `getSessionToken()`.
  - On a `401` response: calls `logout()` and throws a typed
    `AdminSessionExpiredError` so the page knows to fall back to the login
    prompt.
  - On any other failure (network error, 5xx, malformed response): throws
    a plain error *without* clearing the session — the page shows a
    retryable error state instead of re-prompting for a wallet signature,
    since the session may still be valid.

### `src/pages/AdminStatsPage.vue` (new)

- No session → "Connect wallet" button, calls `adminAuth.login()`, then
  loads stats.
- Session present → calls `adminAuth.fetchStats()` on mount, renders:
  - Header numbers: total unique wallets, total opens.
  - Table: day / unique wallets / opens, most recent first.
  - `AdminSessionExpiredError` falls back to the login prompt with a short
    message. Any other error (network/5xx) shows an inline retryable error
    state and keeps the stored session — it does not force another wallet
    signature.
- Uses existing Nimiq UI kit primitives/styles for consistency with the
  rest of the app (per the `nimiq-ui-kit` skill) — no new component
  library.

### `src/router.ts`

- Add `{ path: '/admin/stats', component: () => import('./pages/AdminStatsPage.vue') }`.
- Not referenced from any nav component, menu, or link — reachable only by
  someone who knows the URL. Because the router uses hash history, the
  actual address is `/#/admin/stats`, not `/admin/stats`.

### `src/config/desktop-portal.ts`

- Add `/admin/stats` to `DESKTOP_PORTAL_ROUTES`. Without this, `src/App.vue`'s
  desktop-shell watcher (`src/App.vue:203`) redirects any route outside
  `isDesktopPortalPath()` back to `/` on desktop browsers outside Nimiq
  Pay — the route would work inside the Nimiq Pay mini-app shell but
  bounce to `/` for a plain desktop browser visit, which is the primary
  way an admin would open this page. This registers the route with the
  desktop shell only; it still adds no nav link anywhere.

## Out of scope

- No acquisition-source/referrer tracking — this only surfaces the
  wallet-open counts already recorded by `Stats`.
- No charts/graphs — a table is enough for the current data shape (few
  dozen days at most); revisit if the dataset or ask grows.
- No multi-admin audit log (who viewed stats when) — not requested.
- No rate limiting on `/api/admin/login` beyond the existing per-address
  whitelist + 5-minute timestamp window — add if abuse is observed.

## Testing

- Go: `admin_test.go` covering:
  - `AdminSessions.Issue`/`Valid`/expiry/`sweep` (using the injectable
    clock, no real sleeps).
  - `parseAdminAddresses` including an empty whitelist (no admins
    configured → every login 401s, endpoint doesn't panic).
  - the login handler: valid signature + whitelisted address → token;
    wrong address, stale timestamp, future timestamp, bad signature,
    malformed JSON body → 401/400 as appropriate.
  - a `crypto/rand` failure path for `Issue` returning 500, not 401 (inject
    a failing reader or test the error-return contract directly).
  - `stats_test.go` updated for the new `statsHandler` signature.
  - `cors_test.go`: a preflight (`OPTIONS`) test asserting
    `X-Admin-Session` is present in `Access-Control-Allow-Headers`.
- Frontend:
  - `adminAuth.test.ts`: token storage/expiry logic, the exact signed
    challenge string sent to `/api/admin/login`, use of `apiUrl()` for both
    calls, the `X-Admin-Session` header on `fetchStats`, and that a 401
    clears the session while a network/5xx error does not (mirroring
    existing service test patterns, e.g. `hub.test.ts`).
  - A router/App test proving `/#/admin/stats` renders the admin page (not
    redirected to `/`) for a plain desktop browser outside Nimiq Pay —
    this is the regression the spec review caught, so it needs an explicit
    assertion rather than relying on the route existing.
