package main

import (
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const (
	testAddrA = "NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD"
	testAddrB = "NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF"
)

type friendsTestEnv struct {
	mux      *http.ServeMux
	sessions *UserSessions
	store    *FriendStore
	tokenA   string
	tokenB   string
}

func newFriendsTestEnv(t *testing.T) *friendsTestEnv {
	t.Helper()
	db := withTestDB(t)

	if _, err := db.Exec(`
		INSERT INTO handle_claims (handle, address, tx_hash, block_height, tx_index, claimed_at)
		VALUES
			('alice', $1, 't-alice', 1, 0, 0),
			('bob', $2, 't-bob', 1, 0, 0)`,
		compactAddress(testAddrA), compactAddress(testAddrB),
	); err != nil {
		t.Fatal(err)
	}
	registry := NewHandleRegistry(db, map[string]bool{}, 0)

	if _, err := db.Exec(`
		INSERT INTO profiles (address, payload, updated_at, public_key, signature)
		VALUES ($1, $2, 1, '00', '00')`,
		compactAddress(testAddrB), `{"display_name":"Bob Nice"}`,
	); err != nil {
		t.Fatal(err)
	}
	profiles := NewProfileStore(db)

	sessions := NewUserSessions()
	fixedNow := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }

	store := NewFriendStore(db)
	store.now = func() time.Time { return fixedNow }

	limiter := newFriendRequestLimiter(30, time.Hour)
	limiter.now = func() time.Time { return fixedNow }

	mux := http.NewServeMux()
	registerFriendsRoutes(mux, sessions, store, registry, profiles, limiter)

	tokenA, _, err := sessions.Issue(testAddrA, defaultAudience)
	if err != nil {
		t.Fatal(err)
	}
	tokenB, _, err := sessions.Issue(testAddrB, defaultAudience)
	if err != nil {
		t.Fatal(err)
	}

	return &friendsTestEnv{mux: mux, sessions: sessions, store: store, tokenA: tokenA, tokenB: tokenB}
}

func (e *friendsTestEnv) do(method, path, token, body string) *httptest.ResponseRecorder {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, path, nil)
	}
	if token != "" {
		r.Header.Set("X-NimConnect-Session", token)
	}
	w := httptest.NewRecorder()
	e.mux.ServeHTTP(w, r)
	return w
}

func TestFriendsHandlersRequireSession(t *testing.T) {
	e := newFriendsTestEnv(t)
	w := e.do(http.MethodGet, "/api/friends", "", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", w.Code)
	}
}

func TestFriendsSendRequestByHandleAndList(t *testing.T) {
	e := newFriendsTestEnv(t)

	w := e.do(http.MethodPost, "/api/friends/requests", e.tokenA, `{"to":"bob"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("send: got %d body=%s", w.Code, w.Body.String())
	}
	var created friendEntry
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Address != compactAddress(testAddrB) {
		t.Fatalf("address = %q", created.Address)
	}
	if created.Handle != "bob" || created.DisplayName != "Bob Nice" {
		t.Fatalf("enrichment = %+v", created)
	}
	if created.Status != "pending_out" || created.FriendshipID == "" {
		t.Fatalf("created = %+v", created)
	}

	w = e.do(http.MethodGet, "/api/friends/requests", e.tokenA, "")
	if w.Code != http.StatusOK {
		t.Fatalf("list out: %d", w.Code)
	}
	var out []friendEntry
	json.Unmarshal(w.Body.Bytes(), &out)
	if len(out) != 1 || out[0].Status != "pending_out" {
		t.Fatalf("outgoing = %+v", out)
	}

	w = e.do(http.MethodGet, "/api/friends/requests", e.tokenB, "")
	json.Unmarshal(w.Body.Bytes(), &out)
	if len(out) != 1 || out[0].Status != "pending_in" || out[0].Address != compactAddress(testAddrA) {
		t.Fatalf("incoming = %+v", out)
	}
	if out[0].Handle != "alice" {
		t.Fatalf("incoming handle = %q", out[0].Handle)
	}
}

func TestFriendsAcceptDeclineRemove(t *testing.T) {
	e := newFriendsTestEnv(t)

	w := e.do(http.MethodPost, "/api/friends/requests", e.tokenA, `{"to":"`+testAddrB+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("send: %d %s", w.Code, w.Body.String())
	}
	var created friendEntry
	json.Unmarshal(w.Body.Bytes(), &created)

	w = e.do(http.MethodPost, "/api/friends/requests/"+created.FriendshipID+"/accept", e.tokenA, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("requester accept: got %d", w.Code)
	}

	w = e.do(http.MethodPost, "/api/friends/requests/"+created.FriendshipID+"/accept", e.tokenB, "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("accept: got %d %s", w.Code, w.Body.String())
	}

	w = e.do(http.MethodGet, "/api/friends", e.tokenA, "")
	var friends []friendEntry
	json.Unmarshal(w.Body.Bytes(), &friends)
	if len(friends) != 1 || friends[0].Status != "accepted" || friends[0].DisplayName != "Bob Nice" {
		t.Fatalf("friends = %+v", friends)
	}

	w = e.do(http.MethodDelete, "/api/friends/"+compactAddress(testAddrB), e.tokenA, "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("remove: got %d %s", w.Code, w.Body.String())
	}
	w = e.do(http.MethodGet, "/api/friends", e.tokenA, "")
	json.Unmarshal(w.Body.Bytes(), &friends)
	if len(friends) != 0 {
		t.Fatalf("expected empty after remove, got %+v", friends)
	}
}

func TestFriendsDecline(t *testing.T) {
	e := newFriendsTestEnv(t)
	w := e.do(http.MethodPost, "/api/friends/requests", e.tokenA, `{"to":"bob"}`)
	var created friendEntry
	json.Unmarshal(w.Body.Bytes(), &created)

	w = e.do(http.MethodPost, "/api/friends/requests/"+created.FriendshipID+"/decline", e.tokenB, "")
	if w.Code != http.StatusNoContent {
		t.Fatalf("decline: got %d", w.Code)
	}
	w = e.do(http.MethodGet, "/api/friends/requests", e.tokenB, "")
	var reqs []friendEntry
	json.Unmarshal(w.Body.Bytes(), &reqs)
	if len(reqs) != 0 {
		t.Fatalf("expected no pending after decline, got %+v", reqs)
	}
}

func TestFriendsDuplicateConflictAndSelf(t *testing.T) {
	e := newFriendsTestEnv(t)
	w := e.do(http.MethodPost, "/api/friends/requests", e.tokenA, `{"to":"bob"}`)
	if w.Code != http.StatusOK {
		t.Fatal(w.Body.String())
	}
	w = e.do(http.MethodPost, "/api/friends/requests", e.tokenA, `{"to":"bob"}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("duplicate: got %d", w.Code)
	}
	w = e.do(http.MethodPost, "/api/friends/requests", e.tokenA, `{"to":"alice"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("self: got %d", w.Code)
	}
}

func TestFriendsUnknownHandle(t *testing.T) {
	e := newFriendsTestEnv(t)
	w := e.do(http.MethodPost, "/api/friends/requests", e.tokenA, `{"to":"nobody"}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404", w.Code)
	}
}

func TestFriendsRequestRateLimit(t *testing.T) {
	db := withTestDB(t)
	sessions := NewUserSessions()
	fixedNow := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	store := NewFriendStore(db)
	limiter := newFriendRequestLimiter(2, time.Hour)
	limiter.now = func() time.Time { return fixedNow }

	mux := http.NewServeMux()
	registerFriendsRoutes(mux, sessions, store, nil, nil, limiter)
	token, _, _ := sessions.Issue(testAddrA, defaultAudience)

	targets := make([]string, 3)
	for i := range targets {
		pub, _, err := ed25519.GenerateKey(nil)
		if err != nil {
			t.Fatal(err)
		}
		addr, err := addressFromPublicKey(pub)
		if err != nil {
			t.Fatal(err)
		}
		targets[i] = addr
	}

	codes := []int{}
	for _, to := range targets {
		req := httptest.NewRequest(http.MethodPost, "/api/friends/requests", strings.NewReader(`{"to":"`+to+`"}`))
		req.Header.Set("X-NimConnect-Session", token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		codes = append(codes, w.Code)
	}

	if codes[0] != http.StatusOK || codes[1] != http.StatusOK {
		t.Fatalf("first two should succeed: %v", codes)
	}
	if codes[2] != http.StatusTooManyRequests {
		t.Fatalf("third should 429, got %v", codes)
	}
}
