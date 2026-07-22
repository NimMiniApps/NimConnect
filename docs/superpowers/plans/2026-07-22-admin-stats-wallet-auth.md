# Admin Stats: Nimiq Wallet Auth + Hidden Frontend Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `ADMIN_TOKEN` on `GET /api/stats` with Nimiq wallet-signature login, and add an unlisted `/admin/stats` desktop page for viewing the numbers.

**Architecture:** Backend adds a `POST /api/admin/login` endpoint that verifies a wallet-signed challenge against a whitelist of Nimiq addresses (`ADMIN_ADDRESSES` env var) and issues a short-lived in-memory session token; `GET /api/stats` now requires that token via `X-Admin-Session` instead of `X-Admin-Token`. Frontend adds a service (`adminAuth.ts`) that drives the Hub sign-in flow and calls those two endpoints, and a page (`AdminStatsPage.vue`) at an unlinked route (`/admin/stats`) registered as a desktop-shell route so it renders for a plain desktop browser visit.

**Tech Stack:** Go 1.x stdlib (`net/http`, `crypto/ed25519`, `crypto/rand`), Vue 3 `<script setup>`, Vitest + `@vue/test-utils`.

## Global Constraints

- Session TTL: 24 hours (`adminSessionTTL`).
- Login timestamp freshness window: ±5 minutes (`adminLoginWindow`) — this is freshness bounding, not replay prevention; do not describe it as replay-proof in code comments or docs.
- No new dependencies — `crypto/rand`, `crypto/ed25519`, stdlib `sync.Mutex`+map for sessions (single-instance deployment, no external store).
- Route path: `/admin/stats` (actual browser address `/#/admin/stats`, hash history). No nav link, no mention in `DesktopShell.vue`.
- Only a `401` from `fetchStats()` clears the stored session; network errors and other non-2xx statuses must not.
- Follow existing patterns exactly: `writeJSONError` (`backend/inbox_handlers.go`) for all JSON error bodies, `compactAddress`/`verifySignedMessage` (`backend/address.go`, `backend/auth.go`) for address/signature handling, `apiUrl()` (`src/services/api.ts`) for every frontend fetch, `nimconnect:` prefix for localStorage keys (see `src/services/desktop-session.ts`).

---

## Task 1: `AdminSessions` core (whitelist, session tokens, expiry)

**Files:**
- Create: `backend/admin.go`
- Test: `backend/admin_test.go`

**Interfaces:**
- Consumes: `compactAddress(address string) string` (`backend/address.go:24`).
- Produces:
  - `parseAdminAddresses(raw string) []string`
  - `type AdminSessions struct { ... }` with fields `now func() time.Time` and `randRead func([]byte) (int, error)` (both exported-package-level injectable for tests, lowercase field names — same package, no need to export).
  - `NewAdminSessions(addresses []string) *AdminSessions`
  - `(s *AdminSessions) IsAdmin(address string) bool`
  - `(s *AdminSessions) Issue() (token string, expiresAt time.Time, err error)`
  - `(s *AdminSessions) Valid(token string) bool`
  - `adminSessionTTL = 24 * time.Hour` (package const)

- [ ] **Step 1: Write the failing tests**

Create `backend/admin_test.go`:

```go
package main

import (
	"errors"
	"testing"
	"time"
)

func TestParseAdminAddresses(t *testing.T) {
	if got := parseAdminAddresses(""); len(got) != 0 {
		t.Fatalf("empty input = %v, want empty", got)
	}
	got := parseAdminAddresses(" NQ01 AAAA , NQ02 BBBB ,, NQ03 CCCC ")
	want := []string{"NQ01 AAAA", "NQ02 BBBB", "NQ03 CCCC"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

func TestAdminSessionsIsAdmin(t *testing.T) {
	s := NewAdminSessions([]string{"NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"})
	if !s.IsAdmin("NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD") {
		t.Fatal("expected compact-form address to match whitelist")
	}
	if !s.IsAdmin("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD") {
		t.Fatal("expected spaced-form address to match whitelist")
	}
	if s.IsAdmin("NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF") {
		t.Fatal("expected non-whitelisted address to be rejected")
	}
}

func TestAdminSessionsIssueValidExpirySweep(t *testing.T) {
	s := NewAdminSessions(nil)
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }

	token, expiresAt, err := s.Issue()
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
	if !expiresAt.Equal(now.Add(adminSessionTTL)) {
		t.Fatalf("expiresAt = %v, want %v", expiresAt, now.Add(adminSessionTTL))
	}
	if !s.Valid(token) {
		t.Fatal("expected freshly issued token to be valid")
	}

	// Advance past expiry.
	now = now.Add(adminSessionTTL + time.Minute)
	if s.Valid(token) {
		t.Fatal("expected expired token to be invalid")
	}

	// Valid()'s sweep must have deleted the expired entry, not left it around.
	s.mu.Lock()
	_, exists := s.tokens[token]
	s.mu.Unlock()
	if exists {
		t.Fatal("expected sweep to delete the expired token")
	}
}

func TestAdminSessionsValidRejectsUnknownAndEmptyToken(t *testing.T) {
	s := NewAdminSessions(nil)
	if s.Valid("") {
		t.Fatal("expected empty token to be invalid")
	}
	if s.Valid("not-a-real-token") {
		t.Fatal("expected unknown token to be invalid")
	}
}

func TestAdminSessionsIssueRandFailure(t *testing.T) {
	s := NewAdminSessions(nil)
	s.randRead = func(b []byte) (int, error) { return 0, errors.New("boom") }
	if _, _, err := s.Issue(); err == nil {
		t.Fatal("expected error when randRead fails")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestParseAdminAddresses|TestAdminSessions' -v`
Expected: FAIL — `parseAdminAddresses`, `NewAdminSessions`, `AdminSessions`, `adminSessionTTL` undefined.

- [ ] **Step 3: Implement `backend/admin.go`**

```go
package main

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

const adminSessionTTL = 24 * time.Hour

// AdminSessions authenticates admins by Nimiq wallet signature (see
// adminLoginHandler) and issues short-lived opaque session tokens for
// whitelisted addresses. In-memory only — fine for a single-instance
// deployment; sessions reset on restart.
type AdminSessions struct {
	mu        sync.Mutex
	whitelist map[string]bool
	now       func() time.Time
	randRead  func([]byte) (int, error)
	tokens    map[string]time.Time
}

func parseAdminAddresses(raw string) []string {
	var out []string
	for _, a := range strings.Split(raw, ",") {
		a = strings.TrimSpace(a)
		if a != "" {
			out = append(out, a)
		}
	}
	return out
}

func NewAdminSessions(addresses []string) *AdminSessions {
	whitelist := make(map[string]bool, len(addresses))
	for _, a := range addresses {
		whitelist[compactAddress(a)] = true
	}
	return &AdminSessions{
		whitelist: whitelist,
		now:       time.Now,
		randRead:  rand.Read,
		tokens:    map[string]time.Time{},
	}
}

func (s *AdminSessions) IsAdmin(address string) bool {
	return s.whitelist[compactAddress(address)]
}

// sweep deletes expired tokens. Caller must hold s.mu.
func (s *AdminSessions) sweep() {
	now := s.now()
	for token, expiry := range s.tokens {
		if !now.Before(expiry) {
			delete(s.tokens, token)
		}
	}
}

func (s *AdminSessions) Issue() (string, time.Time, error) {
	buf := make([]byte, 32)
	if _, err := s.randRead(buf); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(buf)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	expiresAt := s.now().Add(adminSessionTTL)
	s.tokens[token] = expiresAt
	return token, expiresAt, nil
}

func (s *AdminSessions) Valid(token string) bool {
	if token == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	_, ok := s.tokens[token]
	return ok
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestParseAdminAddresses|TestAdminSessions' -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/admin.go backend/admin_test.go
git commit -m "$(cat <<'EOF'
Add AdminSessions: whitelist + in-memory session tokens for admin auth

Core session logic only — no HTTP handler yet. Issue() returns an error
so a crypto/rand failure surfaces as a 500, not a silently-issued bad
token; Valid() sweeps expired entries so unused sessions don't
accumulate.
EOF
)"
```

---

## Task 2: `POST /api/admin/login` handler

**Files:**
- Modify: `backend/admin.go`
- Test: `backend/admin_test.go`

**Interfaces:**
- Consumes: `AdminSessions` (Task 1); `verifySignedMessage(claimedAddress, publicKeyHex, signatureHex, message string) error` (`backend/auth.go:30`); `nimiqSignedMessageHash(message string) [32]byte` (`backend/auth.go:15`); `writeJSONError(w http.ResponseWriter, status int, msg string)` (`backend/inbox_handlers.go:12`).
- Produces:
  - `adminLoginChallenge(address string, timestamp int64) string`
  - `adminLoginHandler(sessions *AdminSessions) http.HandlerFunc`
  - Request body shape: `{"address": string, "publicKey": string, "signature": string, "timestamp": int64}` (timestamp = Unix seconds).
  - Success body: `{"token": string, "expires_at": int64}` (`expires_at` = Unix seconds).

- [ ] **Step 1: Write the failing tests**

Replace the `import (...)` block at the top of `backend/admin_test.go` (from Task 1) with:

```go
import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)
```

Then append below the existing Task 1 tests:

```go
func signAdminLoginChallenge(priv ed25519.PrivateKey, address string, timestamp int64) []byte {
	challenge := adminLoginChallenge(address, timestamp)
	hash := nimiqSignedMessageHash(challenge)
	return ed25519.Sign(priv, hash[:])
}

func adminLoginBody(address, publicKeyHex string, sig []byte, timestamp int64) string {
	return fmt.Sprintf(`{"address":%q,"publicKey":%q,"signature":%q,"timestamp":%d}`,
		address, publicKeyHex, hex.EncodeToString(sig), timestamp)
}

func TestAdminLoginHandlerAcceptsWhitelistedSignature(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	address, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}

	sessions := NewAdminSessions([]string{address})
	fixedNow := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	handler := adminLoginHandler(sessions)

	ts := fixedNow.Unix()
	sig := signAdminLoginChallenge(priv, address, ts)
	body := adminLoginBody(address, hex.EncodeToString(pub), sig, ts)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("got %d, want 200, body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Token     string `json:"token"`
		ExpiresAt int64  `json:"expires_at"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Token == "" {
		t.Fatal("expected non-empty token")
	}
	if !sessions.Valid(resp.Token) {
		t.Fatal("expected returned token to be a valid session")
	}
	if resp.ExpiresAt != fixedNow.Add(adminSessionTTL).Unix() {
		t.Fatalf("expires_at = %d, want %d", resp.ExpiresAt, fixedNow.Add(adminSessionTTL).Unix())
	}
}

func TestAdminLoginHandlerRejectsNonWhitelistedAddress(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	sessions := NewAdminSessions([]string{"NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF"}) // someone else
	fixedNow := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	handler := adminLoginHandler(sessions)

	ts := fixedNow.Unix()
	sig := signAdminLoginChallenge(priv, address, ts)
	body := adminLoginBody(address, hex.EncodeToString(pub), sig, ts)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", w.Code)
	}
}

func TestAdminLoginHandlerRejectsStaleAndFutureTimestamps(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	sessions := NewAdminSessions([]string{address})
	fixedNow := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	handler := adminLoginHandler(sessions)

	cases := map[string]int64{
		"stale":  fixedNow.Add(-10 * time.Minute).Unix(),
		"future": fixedNow.Add(10 * time.Minute).Unix(),
	}
	for name, ts := range cases {
		sig := signAdminLoginChallenge(priv, address, ts)
		body := adminLoginBody(address, hex.EncodeToString(pub), sig, ts)
		req := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(body))
		w := httptest.NewRecorder()
		handler(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s timestamp: got %d, want 401", name, w.Code)
		}
	}
}

func TestAdminLoginHandlerRejectsTamperedSignature(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	sessions := NewAdminSessions([]string{address})
	fixedNow := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	handler := adminLoginHandler(sessions)

	ts := fixedNow.Unix()
	sig := signAdminLoginChallenge(priv, address, ts)
	sig[0] ^= 0xFF // tamper
	body := adminLoginBody(address, hex.EncodeToString(pub), sig, ts)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", w.Code)
	}
}

func TestAdminLoginHandlerRejectsMalformedJSON(t *testing.T) {
	sessions := NewAdminSessions(nil)
	handler := adminLoginHandler(sessions)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader("{not json"))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400", w.Code)
	}
}

func TestAdminLoginHandlerRandFailureIsServerError(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	sessions := NewAdminSessions([]string{address})
	fixedNow := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	sessions.randRead = func(b []byte) (int, error) { return 0, errors.New("boom") }
	handler := adminLoginHandler(sessions)

	ts := fixedNow.Unix()
	sig := signAdminLoginChallenge(priv, address, ts)
	body := adminLoginBody(address, hex.EncodeToString(pub), sig, ts)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("got %d, want 500", w.Code)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run TestAdminLoginHandler -v`
Expected: FAIL — `adminLoginChallenge`, `adminLoginHandler` undefined.

- [ ] **Step 3: Implement the handler in `backend/admin.go`**

Add to `backend/admin.go` (new imports: `encoding/json`, `fmt`, `net/http`):

```go
const adminLoginWindow = 5 * time.Minute

func adminLoginChallenge(address string, timestamp int64) string {
	return fmt.Sprintf("nimconnect-admin-login:v1:%s:%d", compactAddress(address), timestamp)
}

type adminLoginRequest struct {
	Address   string `json:"address"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
	Timestamp int64  `json:"timestamp"`
}

func adminLoginHandler(sessions *AdminSessions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req adminLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}

		skew := sessions.now().Sub(time.Unix(req.Timestamp, 0))
		if skew < 0 {
			skew = -skew
		}
		if skew > adminLoginWindow {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		if !sessions.IsAdmin(req.Address) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		challenge := adminLoginChallenge(req.Address, req.Timestamp)
		if err := verifySignedMessage(req.Address, req.PublicKey, req.Signature, challenge); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		token, expiresAt, err := sessions.Issue()
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "session unavailable")
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"token":      token,
			"expires_at": expiresAt.Unix(),
		})
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -v`
Expected: PASS — all backend tests, including every `TestAdminLoginHandler*` case.

- [ ] **Step 5: Commit**

```bash
git add backend/admin.go backend/admin_test.go
git commit -m "$(cat <<'EOF'
Add POST /api/admin/login: wallet-signed admin authentication

Verifies a Hub-signed challenge (same primitive as backup auth) against
the AdminSessions whitelist, with a 5-minute timestamp freshness window
(not replay-proof — a captured request is still repeatable within that
window; acceptable for a small, HTTPS-only, single-admin deployment).
EOF
)"
```

---

## Task 3: Wire `/api/stats` to `AdminSessions`, CORS header, docs

**Files:**
- Modify: `backend/stats.go`
- Modify: `backend/stats_test.go`
- Modify: `backend/main.go`
- Modify: `backend/cors.go`
- Modify: `backend/cors_test.go`
- Modify: `backend/README.md`
- Modify: `docker-compose.homelab.yml.example`

**Interfaces:**
- Consumes: `AdminSessions`, `adminLoginHandler` (Task 2).
- Produces: `statsHandler(stats *Stats, sessions *AdminSessions) http.HandlerFunc` (replaces the old `(stats *Stats, token string)` signature).

- [ ] **Step 1: Write the failing tests**

Replace `TestStatsHandlerAuth` in `backend/stats_test.go`:

```go
func TestStatsHandlerAuth(t *testing.T) {
	s := NewStats("") // no persistence
	s.RecordWallet("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")

	sessions := NewAdminSessions(nil)
	token, _, err := sessions.Issue()
	if err != nil {
		t.Fatal(err)
	}

	h := statsHandler(s, sessions)

	r := httptest.NewRequest("GET", "/api/stats", nil)
	w := httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no session header: got %d, want 401", w.Code)
	}

	r = httptest.NewRequest("GET", "/api/stats", nil)
	r.Header.Set("X-Admin-Session", token)
	w = httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("with valid session: got %d, want 200", w.Code)
	}

	r = httptest.NewRequest("GET", "/api/stats", nil)
	r.Header.Set("X-Admin-Session", "not-a-real-token")
	w = httptest.NewRecorder()
	h(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("invalid session: got %d, want 401", w.Code)
	}
}
```

Add to `backend/cors_test.go`:

```go
func TestWithCORS_AllowsAdminSessionHeader(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	handler := withCORS("*", next)

	req := httptest.NewRequest(http.MethodOptions, "/api/stats", nil)
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "x-admin-session")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	allowHeaders := strings.ToLower(w.Header().Get("Access-Control-Allow-Headers"))
	if !strings.Contains(allowHeaders, "x-admin-session") {
		t.Errorf("Access-Control-Allow-Headers %q missing x-admin-session", allowHeaders)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestStatsHandlerAuth|TestWithCORS_AllowsAdminSessionHeader' -v`
Expected: FAIL — `statsHandler` still takes a `string` (compile error on the test file), and `TestWithCORS_AllowsAdminSessionHeader` fails the header assertion.

- [ ] **Step 3: Update `backend/stats.go`**

Replace the `statsHandler` function (and drop the now-unused `crypto/subtle` import):

```go
func statsHandler(stats *Stats, sessions *AdminSessions) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessions.Valid(r.Header.Get("X-Admin-Session")) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats.Summary())
	}
}
```

Remove `"crypto/subtle"` from the import block at the top of `backend/stats.go` — it's no longer used now that the constant-time token compare is gone.

- [ ] **Step 4: Update `backend/main.go`**

In the variable block, replace:

```go
	adminToken := os.Getenv("ADMIN_TOKEN")
```

with:

```go
	adminSessions := NewAdminSessions(parseAdminAddresses(getEnv("ADMIN_ADDRESSES", "")))
```

Replace:

```go
	mux.HandleFunc("GET /api/stats", statsHandler(stats, adminToken))
```

with:

```go
	mux.HandleFunc("POST /api/admin/login", adminLoginHandler(adminSessions))
	mux.HandleFunc("GET /api/stats", statsHandler(stats, adminSessions))
```

- [ ] **Step 5: Update `backend/cors.go`**

In `withCORS`, change:

```go
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Inbox-Public-Key, X-Inbox-Signature, X-Inbox-Issued-At")
```

to:

```go
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Inbox-Public-Key, X-Inbox-Signature, X-Inbox-Issued-At, X-Admin-Session")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && go test ./... -v`
Expected: PASS — full backend suite, including the updated `TestStatsHandlerAuth` and new `TestWithCORS_AllowsAdminSessionHeader`.

Also run: `cd backend && go build ./...`
Expected: builds clean (confirms `main.go` wiring compiles).

- [ ] **Step 7: Update docs**

In `backend/README.md`, in the endpoints table, change:

```
| `GET` | `/api/stats` | Usage stats (requires `X-Admin-Token` header) |
```

to:

```
| `POST` | `/api/admin/login` | Wallet-signed admin login → session token |
| `GET` | `/api/stats` | Usage stats (requires `X-Admin-Session` header from `/api/admin/login`) |
```

In the same file, in the configuration table, change:

```
| `ADMIN_TOKEN` | _(unset)_ | Enables `/api/stats`; unset = endpoint returns 401 |
```

to:

```
| `ADMIN_ADDRESSES` | _(unset)_ | Comma-separated Nimiq addresses allowed to sign in at `/api/admin/login`; unset = `/api/stats` always returns 401 |
```

In `docker-compose.homelab.yml.example`, change:

```
      - ADMIN_TOKEN=<pick-a-long-random-token>  # enables GET /api/stats
```

to:

```
      - ADMIN_ADDRESSES=<your Nimiq wallet address>  # enables /api/admin/login + GET /api/stats
```

- [ ] **Step 8: Commit**

```bash
git add backend/stats.go backend/stats_test.go backend/main.go backend/cors.go backend/cors_test.go backend/README.md docker-compose.homelab.yml.example
git commit -m "$(cat <<'EOF'
Gate /api/stats on wallet-issued admin sessions, not a static token

Drops ADMIN_TOKEN in favor of ADMIN_ADDRESSES + /api/admin/login.
Also allows X-Admin-Session through CORS preflight — without it a
cross-origin browser request to /api/stats never gets past preflight,
since the frontend and API are served from separate hosts in
production.
EOF
)"
```

---

## Task 4: Frontend `adminAuth` service

**Files:**
- Create: `src/services/adminAuth.ts`
- Test: `src/services/adminAuth.test.ts`

**Interfaces:**
- Consumes: `chooseHubAddress(): Promise<string>`, `hubSignMessage(message: string, signer: string): Promise<{publicKey: string; signature: string}>` (`src/services/hub.ts`); `apiUrl(path: string): string` (`src/services/api.ts:15`).
- Produces:
  - `class AdminSessionExpiredError extends Error`
  - `login(): Promise<void>`
  - `getSessionToken(): string | null`
  - `logout(): void`
  - `interface DayStats { day: string; wallets: number; opens: number }`
  - `interface StatsSummary { unique_wallets: number; total_opens: number; days: DayStats[] }`
  - `fetchStats(): Promise<StatsSummary>`

- [ ] **Step 1: Write the failing test**

Create `src/services/adminAuth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chooseHubAddress = vi.fn()
const hubSignMessage = vi.fn()

vi.mock('./hub', () => ({ chooseHubAddress, hubSignMessage }))

const address = 'NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD'

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }))
}

describe('adminAuth', () => {
  beforeEach(() => {
    vi.resetModules()
    chooseHubAddress.mockReset()
    hubSignMessage.mockReset()
    globalThis.localStorage?.clear()
    vi.useRealTimers()
  })

  it('login signs the exact challenge string and stores the returned session via apiUrl()', async () => {
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
    chooseHubAddress.mockResolvedValue(address)
    hubSignMessage.mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    mockFetchOnce(200, { token: 'tok-1', expires_at: 1785000000 })

    const { login, getSessionToken } = await import('./adminAuth')
    await login()

    const ts = Math.floor(new Date('2026-07-22T12:00:00Z').getTime() / 1000)
    expect(hubSignMessage).toHaveBeenCalledWith(
      `nimconnect-admin-login:v1:${address.replace(/\s+/g, '')}:${ts}`,
      address,
    )
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/login'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(getSessionToken()).toBe('tok-1')
    vi.useRealTimers()
  })

  it('getSessionToken returns null and clears storage once expired', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'stale', expiresAt: 1 }), // expired long ago
    )
    const { getSessionToken } = await import('./adminAuth')
    expect(getSessionToken()).toBeNull()
    expect(globalThis.localStorage?.getItem('nimconnect:admin-session')).toBeNull()
  })

  it('fetchStats sends the session token in X-Admin-Session', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'tok-2', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    )
    mockFetchOnce(200, { unique_wallets: 3, total_opens: 10, days: [] })

    const { fetchStats } = await import('./adminAuth')
    const summary = await fetchStats()

    expect(summary.unique_wallets).toBe(3)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/stats'),
      expect.objectContaining({ headers: { 'X-Admin-Session': 'tok-2' } }),
    )
  })

  it('fetchStats clears the session and throws AdminSessionExpiredError on 401', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'tok-3', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    )
    mockFetchOnce(401, { error: 'unauthorized' })

    const { fetchStats, AdminSessionExpiredError, getSessionToken } = await import('./adminAuth')
    await expect(fetchStats()).rejects.toBeInstanceOf(AdminSessionExpiredError)
    expect(getSessionToken()).toBeNull()
  })

  it('fetchStats leaves the session intact on a network/5xx failure', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'tok-4', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    )
    mockFetchOnce(500, { error: 'boom' })

    const { fetchStats, getSessionToken } = await import('./adminAuth')
    await expect(fetchStats()).rejects.toThrow()
    expect(getSessionToken()).toBe('tok-4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/adminAuth.test.ts`
Expected: FAIL — cannot find module `./adminAuth`.

- [ ] **Step 3: Implement `src/services/adminAuth.ts`**

```ts
import { apiUrl } from './api'
import { chooseHubAddress, hubSignMessage } from './hub'

const SESSION_KEY = 'nimconnect:admin-session'

interface StoredSession {
  token: string
  expiresAt: number // unix seconds
}

export class AdminSessionExpiredError extends Error {
  constructor() {
    super('admin session expired')
    this.name = 'AdminSessionExpiredError'
  }
}

function compactAddress(address: string): string {
  return address.replace(/\s+/g, '')
}

function adminLoginChallenge(address: string, timestamp: number): string {
  return `nimconnect-admin-login:v1:${compactAddress(address)}:${timestamp}`
}

function readStored(): StoredSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function writeStored(session: StoredSession): void {
  try {
    globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(session))
  } catch { /* best-effort */ }
}

export function logout(): void {
  try {
    globalThis.localStorage?.removeItem(SESSION_KEY)
  } catch { /* best-effort */ }
}

/** Stored session token, or null if missing/expired (clearing storage when expired). */
export function getSessionToken(): string | null {
  const stored = readStored()
  if (!stored) return null
  if (stored.expiresAt * 1000 <= Date.now()) {
    logout()
    return null
  }
  return stored.token
}

/** Hub sign-in flow → POST /api/admin/login → stores the returned session. */
export async function login(): Promise<void> {
  const address = await chooseHubAddress()
  const timestamp = Math.floor(Date.now() / 1000)
  const challenge = adminLoginChallenge(address, timestamp)
  const { publicKey, signature } = await hubSignMessage(challenge, address)

  const res = await fetch(apiUrl('/api/admin/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, publicKey, signature, timestamp }),
  })
  if (!res.ok) throw new Error(`admin login failed (${res.status})`)
  const body = await res.json() as { token: string; expires_at: number }
  writeStored({ token: body.token, expiresAt: body.expires_at })
}

export interface DayStats {
  day: string
  wallets: number
  opens: number
}

export interface StatsSummary {
  unique_wallets: number
  total_opens: number
  days: DayStats[]
}

/** GET /api/stats with the stored session. 401 clears the session; other failures do not. */
export async function fetchStats(): Promise<StatsSummary> {
  const token = getSessionToken()
  const res = await fetch(apiUrl('/api/stats'), {
    headers: token ? { 'X-Admin-Session': token } : {},
  })
  if (res.status === 401) {
    logout()
    throw new AdminSessionExpiredError()
  }
  if (!res.ok) throw new Error(`stats fetch failed (${res.status})`)
  return (await res.json()) as StatsSummary
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/adminAuth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/adminAuth.ts src/services/adminAuth.test.ts
git commit -m "$(cat <<'EOF'
Add adminAuth service: Hub sign-in + session-gated stats fetch

Mirrors cloud-backup.ts's challenge/apiUrl pattern. Only a 401 from
fetchStats() clears the stored session — network errors and other
non-2xx statuses leave it intact so the caller can retry without
forcing another wallet signature.
EOF
)"
```

---

## Task 5: `AdminStatsPage.vue`

**Files:**
- Create: `src/pages/AdminStatsPage.vue`
- Test: `src/pages/AdminStatsPage.test.ts`

**Interfaces:**
- Consumes: `login(): Promise<void>`, `fetchStats(): Promise<StatsSummary>`, `AdminSessionExpiredError`, `getSessionToken(): string | null` (Task 4, `src/services/adminAuth.ts`).
- Produces: default-exported Vue component with three render states — `no-session` (Connect wallet button), `loading`, `loaded` (totals + table), `error` (retryable, session-preserving).

- [ ] **Step 1: Write the failing test**

Create `src/pages/AdminStatsPage.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminStatsPage from './AdminStatsPage.vue'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  fetchStats: vi.fn(),
  getSessionToken: vi.fn(),
}))

vi.mock('../services/adminAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/adminAuth')>()
  return {
    ...actual,
    login: mocks.login,
    fetchStats: mocks.fetchStats,
    getSessionToken: mocks.getSessionToken,
  }
})

const summary = {
  unique_wallets: 12,
  total_opens: 40,
  days: [
    { day: '2026-07-21', wallets: 5, opens: 15 },
    { day: '2026-07-22', wallets: 7, opens: 25 },
  ],
}

describe('AdminStatsPage', () => {
  beforeEach(() => {
    mocks.login.mockReset()
    mocks.fetchStats.mockReset()
    mocks.getSessionToken.mockReset()
  })

  it('shows a connect prompt when there is no session', async () => {
    mocks.getSessionToken.mockReturnValue(null)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.find('[data-connect]').exists()).toBe(true)
    expect(mocks.fetchStats).not.toHaveBeenCalled()
  })

  it('loads and renders stats when a session exists', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    mocks.fetchStats.mockResolvedValue(summary)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('12')
    expect(wrapper.text()).toContain('40')
    expect(wrapper.findAll('[data-day-row]')).toHaveLength(2)
  })

  it('falls back to the connect prompt on AdminSessionExpiredError', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    const { AdminSessionExpiredError } = await import('../services/adminAuth')
    mocks.fetchStats.mockRejectedValue(new AdminSessionExpiredError())
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.find('[data-connect]').exists()).toBe(true)
  })

  it('shows a retryable error and keeps the session on a network/5xx failure', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    mocks.fetchStats.mockRejectedValue(new Error('stats fetch failed (500)'))
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.find('[data-connect]').exists()).toBe(false)
    expect(wrapper.find('[data-retry]').exists()).toBe(true)
  })

  it('connect button calls login() then loads stats', async () => {
    mocks.getSessionToken.mockReturnValue(null)
    mocks.login.mockResolvedValue(undefined)
    mocks.fetchStats.mockResolvedValue(summary)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()

    await wrapper.find('[data-connect]').trigger('click')
    await flushPromises()

    expect(mocks.login).toHaveBeenCalled()
    expect(wrapper.text()).toContain('12')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/AdminStatsPage.test.ts`
Expected: FAIL — cannot find module `./AdminStatsPage.vue`.

- [ ] **Step 3: Implement `src/pages/AdminStatsPage.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AdminSessionExpiredError, fetchStats, getSessionToken, login, type StatsSummary } from '../services/adminAuth'

type ViewState = 'connect' | 'loading' | 'loaded' | 'error'

const state = ref<ViewState>('connect')
const summary = ref<StatsSummary | null>(null)

async function load() {
  state.value = 'loading'
  try {
    summary.value = await fetchStats()
    state.value = 'loaded'
  } catch (err) {
    if (err instanceof AdminSessionExpiredError) {
      state.value = 'connect'
    } else {
      state.value = 'error'
    }
  }
}

async function onConnect() {
  state.value = 'loading'
  try {
    await login()
    await load()
  } catch {
    state.value = 'connect'
  }
}

onMounted(() => {
  if (getSessionToken()) void load()
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Admin · Stats</h1>
      <p>Daily unique wallets and app opens.</p>
    </header>

    <div v-if="state === 'connect'" class="hint">
      <button type="button" class="nq-button" data-connect @click="onConnect">Connect wallet</button>
    </div>

    <p v-else-if="state === 'loading'" class="hint">Loading…</p>

    <div v-else-if="state === 'error'" class="hint">
      <p>Stats are unavailable right now.</p>
      <button type="button" class="nq-button" data-retry @click="load">Retry</button>
    </div>

    <template v-else-if="state === 'loaded' && summary">
      <div class="totals">
        <div class="total-card">
          <span class="total-value">{{ summary.unique_wallets }}</span>
          <span class="total-label">Unique wallets</span>
        </div>
        <div class="total-card">
          <span class="total-value">{{ summary.total_opens }}</span>
          <span class="total-label">Total opens</span>
        </div>
      </div>

      <table class="stats-table">
        <thead>
          <tr><th>Day</th><th>Wallets</th><th>Opens</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in [...summary.days].reverse()" :key="d.day" data-day-row>
            <td>{{ d.day }}</td>
            <td>{{ d.wallets }}</td>
            <td>{{ d.opens }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 88px; max-width: 720px; margin: 0 auto; }
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 4px; }
.header p { margin: 0 0 14px; color: var(--text-2); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; margin: 24px 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.total-card { padding: 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--card); box-shadow: var(--shadow); text-align: center; }
.total-value { display: block; font-size: 22px; font-weight: 700; }
.total-label { display: block; margin-top: 4px; color: var(--text-2); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.stats-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.stats-table th, .stats-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
.stats-table th { color: var(--text-2); font-weight: 700; text-transform: uppercase; font-size: 11px; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/AdminStatsPage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/AdminStatsPage.vue src/pages/AdminStatsPage.test.ts
git commit -m "$(cat <<'EOF'
Add AdminStatsPage: connect/loading/loaded/error states over adminAuth

Retryable error state (network/5xx) is distinct from the expired-session
state (AdminSessionExpiredError) — only the latter drops back to the
connect prompt, matching adminAuth's session-preservation contract.
EOF
)"
```

---

## Task 6: Route registration (unlisted, desktop-shell-recognized)

**Files:**
- Modify: `src/router.ts`
- Modify: `src/config/desktop-portal.ts`

**Interfaces:**
- Consumes: `AdminStatsPage.vue` (Task 5).
- Produces: route `/admin/stats` (hash address `/#/admin/stats`) reachable and rendered inside the desktop shell for a plain desktop browser, with no link anywhere in the UI.

- [ ] **Step 1: Confirm the existing regression check that will cover this change**

`src/config/desktop-portal.test.ts` already loops over every entry in `DESKTOP_PORTAL_ROUTES` and asserts `isDesktopPortalPath` returns `true` for each (`it('allows the desktop portal routes')`). No new test file is needed — adding `/admin/stats` to the exported array in Step 2 extends that loop automatically, so the route is covered without writing a new assertion.

Run: `npx vitest run src/config/desktop-portal.test.ts`
Expected: PASS (current allowlist only — `/admin/stats` isn't in it yet, nothing to fail here; this step is a baseline check before Step 2 changes the array).

- [ ] **Step 2: Add the route**

In `src/router.ts`, add to the `routes` array (before the catch-all `:pathMatch` entry):

```ts
    { path: '/admin/stats', component: () => import('./pages/AdminStatsPage.vue') },
```

In `src/config/desktop-portal.ts`, add `/admin/stats` to the exported array:

```ts
export const DESKTOP_PORTAL_ROUTES = ['/', '/lookup', '/me', '/about', '/admin/stats'] as const
```

- [ ] **Step 3: Run tests to verify everything passes**

Run: `npx vitest run src/config/desktop-portal.test.ts src/App.test.ts`
Expected: PASS — `desktop-portal.test.ts`'s `'allows the desktop portal routes'` loop now also covers `/admin/stats`; `App.test.ts`'s source-level assertions about `isDesktopPortalPath`/`desktopPortalRoute` gating still hold unchanged.

Run the full frontend suite once to confirm no regressions: `npm run test`
Expected: PASS.

Also confirm nothing links to the new route:

Run: `grep -rn "admin/stats" src/components src/pages/desktop/DesktopAboutPage.vue src/components/desktop/DesktopShell.vue 2>/dev/null`
Expected: no output (only `router.ts` and `desktop-portal.ts` reference the path).

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev` (in one terminal) and `cd backend && ADMIN_ADDRESSES="<your test address>" go run .` (in another).
Visit `http://localhost:5173/#/admin/stats` in a desktop browser.
Expected: the admin page renders (not redirected to `/`), shows the "Connect wallet" button; after connecting with the whitelisted address in Nimiq Pay/Hub and signing, the stats table loads. Visiting with a non-whitelisted address should show a 401 → the connect prompt reappears (session cleared).

- [ ] **Step 5: Commit**

```bash
git add src/router.ts src/config/desktop-portal.ts
git commit -m "$(cat <<'EOF'
Register /admin/stats as an unlisted desktop-shell route

Added to DESKTOP_PORTAL_ROUTES so App.vue's desktop-browser redirect
(src/App.vue:203) doesn't bounce a direct visit back to /. No nav link
added anywhere — reachable only by URL (/#/admin/stats).
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** every section of the design doc maps to a task — `AdminSessions`/whitelist (Task 1), login handler + freshness-not-replay framing (Task 2), `/api/stats` gating + CORS + docs (Task 3), `adminAuth.ts` incl. `apiUrl()` and error semantics (Task 4), `AdminStatsPage.vue` incl. retry-vs-reconnect UX (Task 5), router + `DESKTOP_PORTAL_ROUTES` (Task 6).
- **Placeholder scan:** none — every step has runnable code and exact commands. (The one placeholder-looking snippet in Task 6 Step 1 is explicitly called out as "skip it, adds nothing" and not used.)
- **Type consistency:** `StatsSummary`/`DayStats` field names (`unique_wallets`, `total_opens`, `days[].day/wallets/opens`) match the Go `statsSummary`/`daySummary` JSON tags in `backend/stats.go`. `AdminSessions.Issue()`'s three-value return is used identically in Task 1, Task 2, and Task 3's test. `X-Admin-Session` header name matches across `stats.go`, `cors.go`, and `adminAuth.ts`.
