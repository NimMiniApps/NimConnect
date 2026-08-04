# Friends Social Graph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship opt-in mutual friends with user-only session auth in NimConnect, expose it via `@nimconnect/profile-client`, and wire NimBomber as the first consumer.

**Architecture:** Wallet signs once → `POST /api/session` issues `X-NimConnect-Session` → friends CRUD against Postgres `friendships` (see `backend/migrations/001_init.sql`). Local contacts stay private. Public profile/handle reads unchanged. Design: `docs/plans/2026-08-04-friends-social-graph-design.md`.

**Tech Stack:** Go backend, Vue 3 NimConnect Mini App, `@nimconnect/profile-client` (TS/Vitest), NimBomber Vue frontend

---

### Task 1: User session store + challenge

**Files:**
- Create: `backend/user_session.go`
- Create: `backend/user_session_test.go`

**Step 1: Write the failing test**

```go
package main

import (
	"testing"
	"time"
)

func TestUserSessionsIssueLookupRevoke(t *testing.T) {
	s := NewUserSessions()
	s.now = func() time.Time { return time.Unix(1_700_000_000, 0) }

	token, exp, err := s.Issue("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")
	if err != nil {
		t.Fatal(err)
	}
	if exp.Unix() != 1_700_000_000+int64(userSessionTTL.Seconds()) {
		t.Fatalf("unexpected expiry %v", exp)
	}
	addr, ok := s.AddressFor(token)
	if !ok || compactAddress(addr) != compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD") {
		t.Fatalf("lookup failed: %q %v", addr, ok)
	}
	s.Revoke(token)
	if _, ok := s.AddressFor(token); ok {
		t.Fatal("expected revoked token to miss")
	}
}

func TestUserSessionChallenge(t *testing.T) {
	got := userSessionChallenge("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD", 1700000000)
	want := "nimconnect-session:v1:NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD:1700000000"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test -run TestUserSession -count=1`

Expected: FAIL — `NewUserSessions` undefined

**Step 3: Minimal implementation**

```go
// backend/user_session.go
package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

const userSessionTTL = 24 * time.Hour
const userSessionLoginWindow = 5 * time.Minute

type UserSessions struct {
	mu       sync.Mutex
	now      func() time.Time
	randRead func([]byte) (int, error)
	tokens   map[string]userSessionEntry
}

type userSessionEntry struct {
	address   string
	expiresAt time.Time
}

func NewUserSessions() *UserSessions {
	return &UserSessions{
		now:      time.Now,
		randRead: rand.Read,
		tokens:   map[string]userSessionEntry{},
	}
}

func userSessionChallenge(address string, expiresAtUnix int64) string {
	return fmt.Sprintf("nimconnect-session:v1:%s:%d", compactAddress(address), expiresAtUnix)
}

func (s *UserSessions) sweepLocked() {
	now := s.now()
	for token, e := range s.tokens {
		if !now.Before(e.expiresAt) {
			delete(s.tokens, token)
		}
	}
}

func (s *UserSessions) Issue(address string) (string, time.Time, error) {
	buf := make([]byte, 32)
	if _, err := s.randRead(buf); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(buf)
	expiresAt := s.now().Add(userSessionTTL)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	s.tokens[token] = userSessionEntry{address: compactAddress(address), expiresAt: expiresAt}
	return token, expiresAt, nil
}

func (s *UserSessions) AddressFor(token string) (string, bool) {
	if token == "" {
		return "", false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked()
	e, ok := s.tokens[token]
	if !ok {
		return "", false
	}
	return e.address, true
}

func (s *UserSessions) Revoke(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tokens, token)
}
```

**Step 4: Run tests**

Run: `cd backend && go test -run TestUserSession -count=1`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/user_session.go backend/user_session_test.go
git commit -m "feat(backend): add user session store for friends auth"
```

---

### Task 2: Session HTTP handlers

**Files:**
- Create: `backend/user_session_handlers.go`
- Create: `backend/user_session_handlers_test.go`
- Modify: `backend/main.go` (wire `NewUserSessions`, register routes)

**Step 1: Write failing handler tests**

Mirror `admin_test.go` / `adminLoginHandler` patterns:

- Valid signed `POST /api/session` with `expiresAt` within login window → 200 `{token, expires_at}`
- Bad signature → 401
- Expired challenge window → 401
- `DELETE /api/session` with valid header revokes token
- Helper `requireUserSession(sessions, r) (address, ok)` used by later friends handlers

Challenge message must be `userSessionChallenge(address, expiresAt)` where `expiresAt` is the body field the client signed (unix seconds), and server checks `|now - expiresAt|` is not the right check — instead: `expiresAt` must be in the future and within `userSessionLoginWindow` of `now+TTL` OR simpler: client signs `timestamp` like admin login.

**Align with design + admin pattern (simpler):**

Request body:
```json
{ "address", "publicKey", "signature", "timestamp" }
```
Challenge: `nimconnect-session:v1:{compactAddress}:{timestamp}`  
Window: ±5 minutes (same as admin).  
Issued session TTL: 24h.

Update design challenge wording in implementation if needed — prefer timestamp (admin-compatible) over client-chosen expiresAt to avoid clock skew tricks.

**Step 2: Run tests — expect FAIL**

**Step 3: Implement handlers + wire in `main.go`**

```go
mux.HandleFunc("POST /api/session", userSessionLoginHandler(userSessions))
mux.HandleFunc("DELETE /api/session", userSessionLogoutHandler(userSessions))
```

**Step 4: Tests PASS**

**Step 5: Commit**

```bash
git add backend/user_session_handlers.go backend/user_session_handlers_test.go backend/user_session.go backend/main.go
git commit -m "feat(backend): add POST/DELETE /api/session for user wallets"
```

---

### Task 3: Friends store state machine

**Files:**
- Create: `backend/friends_store.go`
- Create: `backend/friends_store_test.go`

**Step 1: Failing tests covering**

- `SendRequest(from, to)` creates `pending`
- Self-friend → error
- Duplicate pending/accepted → conflict error
- Re-request after declined → new pending OK
- `Accept(id, actor)` only recipient; sets `accepted`
- `Decline(id, actor)` only recipient
- `Remove(actor, other)` either side deletes accepted edge
- `ListFriends(actor)` / `ListRequests(actor)` return only that user's edges
- Persistence round-trip against Postgres (test DB via `pgtest` helper)

**Step 2: Run — FAIL**

**Step 3: Implement `FriendStore`**

```go
type FriendshipStatus string

const (
	FriendshipPending  FriendshipStatus = "pending"
	FriendshipAccepted FriendshipStatus = "accepted"
	FriendshipDeclined FriendshipStatus = "declined"
)

type Friendship struct {
	ID               string           `json:"id"`
	RequesterAddress string           `json:"requester_address"`
	RecipientAddress string           `json:"recipient_address"`
	Status           FriendshipStatus `json:"status"`
	CreatedAt        int64            `json:"created_at"`
	UpdatedAt        int64            `json:"updated_at"`
}
```

SQL against `friendships` via `*sql.DB` — same table/constraints as
`001_init.sql`. Use transactions for state transitions; tests use the shared
Postgres test helper (`pgtest_test.go`).

**Step 4: Tests PASS**

**Step 5: Commit**

```bash
git add backend/friends_store.go backend/friends_store_test.go
git commit -m "feat(backend): add friends graph store and state machine"
```

---

### Task 4: Friends HTTP API + enrichment

**Files:**
- Create: `backend/friends_handlers.go`
- Create: `backend/friends_handlers_test.go`
- Modify: `backend/main.go`
- Modify: `backend/README.md` (endpoint table)

**Routes:**

```text
GET    /api/friends
GET    /api/friends/requests
POST   /api/friends/requests            body: { "to": "<handle|address>" }
POST   /api/friends/requests/{id}/accept
POST   /api/friends/requests/{id}/decline
DELETE /api/friends/{address}
```

All require `X-NimConnect-Session`. Resolve `to` via registry when it looks like a handle; else treat as address. Enrich responses with handle + `display_name` from registry/profiles when available.

Rate-limit: simple in-memory per-address counter on `POST .../requests` (e.g. 30/hour).

**Step 1: Handler tests with httptest + fake session + temp store**

**Step 2: FAIL → implement → PASS**

**Step 3: Document endpoints in `backend/README.md` and `docs/api/friends.md` (new short API doc)**

**Step 4: Commit**

```bash
git add backend/friends_handlers.go backend/friends_handlers_test.go backend/main.go backend/README.md docs/api/friends.md
git commit -m "feat(backend): expose authenticated friends HTTP API"
```

---

### Task 5: profile-client session + friends methods

**Files:**
- Modify: `packages/profile-client/src/types.ts`
- Modify: `packages/profile-client/src/client.ts`
- Modify: `packages/profile-client/src/index.ts`
- Create: `packages/profile-client/src/friends.ts` (optional split)
- Create: `packages/profile-client/src/friends.test.ts`
- Create: `packages/profile-client/src/session.ts`
- Create: `packages/profile-client/src/session.test.ts`
- Modify: `packages/profile-client/README.md`
- Bump: `packages/profile-client/package.json` minor (`0.5.0` → `0.6.0`)

**API surface:**

```ts
type SignMessageFn = (message: string) => Promise<{
  publicKey: string
  signature: string
}>

interface FriendEntry {
  address: string
  handle?: string
  displayName?: string
  status: 'accepted' | 'pending_out' | 'pending_in'
  friendshipId: string
}

interface ProfileClient {
  // existing reads...
  createSession(args: {
    address: string
    signMessage: SignMessageFn
  }): Promise<{ token: string; expiresAt: number }>
  clearSession(): void
  getSessionToken(): string | null
  listFriends(): Promise<FriendEntry[]>
  listFriendRequests(): Promise<FriendEntry[]>
  sendFriendRequest(to: string): Promise<FriendEntry>
  acceptFriendRequest(id: string): Promise<void>
  declineFriendRequest(id: string): Promise<void>
  removeFriend(address: string): Promise<void>
}
```

Session token held on the client instance after `createSession`; all friends calls send `X-NimConnect-Session`. Tests mock `fetch`.

**Steps:** failing tests → implement → `npm test` in package → build → commit

```bash
git add packages/profile-client
git commit -m "feat(profile-client): add session auth and friends methods"
```

---

### Task 6: NimConnect Friends UI

**Files:**
- Create: `src/pages/FriendsPage.vue`
- Create: `src/pages/FriendsPage.test.ts` (smoke)
- Create: `src/services/friends.ts` (wraps profile-client + Hub/Pay sign)
- Modify: `src/router.ts` — add `/friends`
- Modify: `src/App.vue` — nav item Friends (near Contacts)
- Modify: `src/pages/ContactsPage.vue` or Settings privacy blurb — one line distinguishing Friends vs Contacts
- Optional: Add friend CTA on `PublicProfilePage` / `ProfileView`

**Behavior:**
1. Enter `/friends` → if no session, prompt wallet sign → `createSession`
2. Show accepted / incoming / outgoing
3. Add form: handle or address → `sendFriendRequest`
4. Accept / Decline / Remove

**Steps:** component test for empty + list rendering with mocked service → implement → commit

```bash
git add src/pages/FriendsPage.vue src/pages/FriendsPage.test.ts src/services/friends.ts src/router.ts src/App.vue
git commit -m "feat(ui): add Friends page with session-gated mutual requests"
```

---

### Task 7: Publish client + NimBomber consumer

**NimConnect side (if npm publish is part of workflow):**
- Publish `@nimconnect/profile-client@0.6.0` OR temporarily link via local path / GitHub package for Bomber

**NimBomber files** (repo: `/home/maestro/Documents/projects/NimBomber`):
- Modify: `apps/frontend/package.json` — bump `@nimconnect/profile-client`
- Modify: `apps/frontend/src/services/ecosystemProfile.ts` — export shared client + session helpers
- Create: `apps/frontend/src/services/friends.ts`
- Create: `apps/frontend/src/services/friends.test.ts`
- Modify: `apps/frontend/src/views/LobbyView.vue` — Add friend on other human players
- Modify: `apps/frontend/src/views/LeaderboardView.vue` — Add friend when handle/address known
- Modify: `apps/frontend/src/views/ProfileView.vue` — Friends section (accepted + pending)

**Behavior:**
- After Bomber wallet auth, lazily `createSession` on first Friends/Add action (not every page load if unused)
- Disable Add when self / already friends / pending
- Clear errors for 401 (re-sign once) and 409

**Commit in NimBomber:**

```bash
git add apps/frontend
git commit -m "feat: add NimConnect friends from lobby, leaderboard, and profile"
```

**Commit docs cross-link in NimConnect:**

```bash
git commit -m "docs: note NimBomber as first friends consumer"
```

---

### Task 8: Verification checklist

**NimConnect backend**

```bash
cd backend && go test ./...
```

**profile-client**

```bash
cd packages/profile-client && npm test && npm run build
```

**NimConnect UI**

```bash
npm test -- --run FriendsPage
```

**Manual smoke**
1. Two wallets: A sends request to B's handle
2. B accepts in NimConnect Friends
3. Both see each other under accepted
4. In NimBomber (wallet A): session + see B; Add from lobby for a third player C

**Update design follow-up note** if timestamp challenge was chosen over expiresAt — amend design doc in same PR if needed.

---

## Execution notes

- Do not sync or read IndexedDB contacts for this feature
- Do not add friends routes that accept a target user's address as a path for listing *their* friends
- Prefer small commits per task
- NimWorld Social Club wiring is explicitly out of this plan

## Handoff

After Task 8, optional follow-up plan: `2026-08-XX-nimworld-friends-adapter.md` replacing NimWorld mock friends.
