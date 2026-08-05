package main

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var authTestAddress = compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")

func newTestAuthStore(t *testing.T) (*AuthStore, *sql.DB) {
	t.Helper()
	db := withTestDB(t)
	if _, err := db.Exec(`
		TRUNCATE auth_challenges, auth_sessions;
		UPDATE auth_apps SET enabled = true`); err != nil {
		t.Fatal(err)
	}
	return NewAuthStore(db), db
}

func deterministicRand() func([]byte) (int, error) {
	var calls atomic.Uint32
	return func(buf []byte) (int, error) {
		value := byte(calls.Add(1))
		for i := range buf {
			buf[i] = value
		}
		return len(buf), nil
	}
}

func TestAuthStoreValidatesAndCanonicalizesAllowedScopes(t *testing.T) {
	store, _ := newTestAuthStore(t)

	got, err := store.ValidateScopes("nimconnect", []string{"inbox:send", "friends:read", "inbox:send"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"friends:read", "inbox:send"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("canonical scopes = %v, want %v", got, want)
	}

	for _, tc := range []struct {
		name     string
		audience string
		scopes   []string
	}{
		{name: "scope escalation", audience: "nimworld", scopes: []string{"backup:read"}},
		{name: "unknown scope", audience: "nimconnect", scopes: []string{"wallet:spend"}},
		{name: "wildcard", audience: "nimconnect", scopes: []string{"*"}},
		{name: "unknown app", audience: "unknown", scopes: []string{"friends:read"}},
		{name: "empty set", audience: "nimconnect", scopes: nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := store.ValidateScopes(tc.audience, tc.scopes); !errors.Is(err, errAuthScopeNotAllowed) {
				t.Fatalf("got %v, want errAuthScopeNotAllowed", err)
			}
		})
	}
}

func TestAuthStoreCreatesAndConsumesFiveMinuteChallenge(t *testing.T) {
	store, db := newTestAuthStore(t)
	store.randRead = deterministicRand()
	base := time.Now().UTC().Truncate(time.Second)
	store.now = func() time.Time { return base }

	challenge, err := store.CreateChallenge(
		authTestAddress,
		"nimconnect",
		[]string{"inbox:send", "friends:read", "inbox:send"},
		func(nonce string, expiresAt time.Time) string {
			return fmt.Sprintf("nonce=%s expires=%s", nonce, expiresAt.Format(time.RFC3339))
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if challenge.ID == "" || challenge.Nonce == "" || !strings.Contains(challenge.Message, challenge.Nonce) {
		t.Fatalf("incomplete challenge: %+v", challenge)
	}
	if !challenge.CreatedAt.Equal(base) || !challenge.ExpiresAt.Equal(base.Add(5*time.Minute)) {
		t.Fatalf("challenge timestamps = %s..%s", challenge.CreatedAt, challenge.ExpiresAt)
	}
	if !reflect.DeepEqual(challenge.Scopes, []string{"friends:read", "inbox:send"}) {
		t.Fatalf("challenge scopes = %v", challenge.Scopes)
	}

	var storedNonceHash []byte
	var storedMessage string
	if err := db.QueryRow(`SELECT nonce_hash, message FROM auth_challenges WHERE id = $1`, challenge.ID).Scan(&storedNonceHash, &storedMessage); err != nil {
		t.Fatal(err)
	}
	wantHash := sha256.Sum256([]byte(challenge.Nonce))
	if !bytes.Equal(storedNonceHash, wantHash[:]) {
		t.Fatalf("stored nonce hash = %x, want %x", storedNonceHash, wantHash)
	}
	if bytes.Contains(storedNonceHash, []byte(challenge.Nonce)) {
		t.Fatal("plaintext nonce was persisted")
	}
	if storedMessage != challenge.Message {
		t.Fatalf("stored message = %q, want %q", storedMessage, challenge.Message)
	}

	consumed, err := store.ConsumeChallenge(challenge.ID)
	if err != nil {
		t.Fatal(err)
	}
	if consumed.Nonce != "" {
		t.Fatal("consumed challenge must not recover a plaintext nonce")
	}
	if consumed.ID != challenge.ID || consumed.Address != authTestAddress || consumed.Audience != "nimconnect" ||
		consumed.Message != challenge.Message || !reflect.DeepEqual(consumed.Scopes, challenge.Scopes) {
		t.Fatalf("consumed challenge = %+v, want %+v", consumed, challenge)
	}
	if _, err := store.ConsumeChallenge(challenge.ID); !errors.Is(err, errAuthChallengeUnavailable) {
		t.Fatalf("second consume = %v, want errAuthChallengeUnavailable", err)
	}
}

func TestAuthStoreRejectsSecondConcurrentChallengeConsumption(t *testing.T) {
	store, _ := newTestAuthStore(t)
	store.randRead = deterministicRand()
	challenge, err := store.CreateChallenge(authTestAddress, "nimconnect", []string{"friends:read"},
		func(nonce string, _ time.Time) string { return "nonce=" + nonce })
	if err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := store.ConsumeChallenge(challenge.ID)
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	var success, unavailable int
	for err := range results {
		switch {
		case err == nil:
			success++
		case errors.Is(err, errAuthChallengeUnavailable):
			unavailable++
		default:
			t.Fatalf("unexpected consume error: %v", err)
		}
	}
	if success != 1 || unavailable != 1 {
		t.Fatalf("success=%d unavailable=%d, want 1 each", success, unavailable)
	}
}

func TestAuthStoreIssuesAndResolvesHashedSevenDaySession(t *testing.T) {
	store, db := newTestAuthStore(t)
	store.randRead = deterministicRand()
	base := time.Now().UTC().Truncate(time.Second)
	store.now = func() time.Time { return base }

	token, grant, err := store.IssueSession(authTestAddress, "nimconnect", []string{"inbox:send", "friends:read", "inbox:send"})
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || grant.ID == "" {
		t.Fatalf("token/grant ID must be set: token=%q grant=%+v", token, grant)
	}
	if !grant.CreatedAt.Equal(base) || !grant.ExpiresAt.Equal(base.Add(7*24*time.Hour)) {
		t.Fatalf("grant timestamps = %s..%s", grant.CreatedAt, grant.ExpiresAt)
	}
	if !reflect.DeepEqual(grant.Scopes, []string{"friends:read", "inbox:send"}) {
		t.Fatalf("grant scopes = %v", grant.Scopes)
	}

	var storedHash []byte
	var plaintextMatches int
	if err := db.QueryRow(`SELECT token_hash FROM auth_sessions WHERE address = $1`, authTestAddress).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	wantHash := sha256.Sum256([]byte(token))
	if !bytes.Equal(storedHash, wantHash[:]) {
		t.Fatalf("stored token hash = %x, want %x", storedHash, wantHash)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM auth_sessions WHERE encode(token_hash, 'escape') = $1`, token).Scan(&plaintextMatches); err != nil {
		t.Fatal(err)
	}
	if plaintextMatches != 0 {
		t.Fatal("plaintext bearer token was persisted")
	}

	resolved, err := store.ResolveSession(token)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resolved, grant) {
		t.Fatalf("resolved grant = %+v, want %+v", resolved, grant)
	}

	later := base.Add(time.Hour)
	store.now = func() time.Time { return later }
	if err := store.TouchSession(token); err != nil {
		t.Fatal(err)
	}
	var lastUsed, expiresAt time.Time
	if err := db.QueryRow(`SELECT last_used_at, expires_at FROM auth_sessions WHERE token_hash = $1`, storedHash).Scan(&lastUsed, &expiresAt); err != nil {
		t.Fatal(err)
	}
	if !lastUsed.Equal(later) {
		t.Fatalf("last_used_at = %s, want %s", lastUsed, later)
	}
	if !expiresAt.Equal(grant.ExpiresAt) {
		t.Fatalf("touch extended expiry to %s; want fixed %s", expiresAt, grant.ExpiresAt)
	}
}

func TestAuthStoreRevokesOneAndAllWalletSessions(t *testing.T) {
	store, _ := newTestAuthStore(t)
	store.randRead = deterministicRand()

	first, _, err := store.IssueSession(authTestAddress, "nimconnect", []string{"friends:read"})
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := store.IssueSession(authTestAddress, "nimworld", []string{"friends:read"})
	if err != nil {
		t.Fatal(err)
	}
	other, _, err := store.IssueSession("NQ22 BUYER BBBB BBBB BBBB BBBB BBBB BBBB BBBB", "nimconnect", []string{"friends:read"})
	if err != nil {
		t.Fatal(err)
	}

	if err := store.RevokeSession(first); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolveSession(first); !errors.Is(err, errAuthSessionUnavailable) {
		t.Fatalf("revoked session resolve = %v", err)
	}
	if _, err := store.ResolveSession(second); err != nil {
		t.Fatalf("second session unexpectedly revoked: %v", err)
	}

	count, err := store.RevokeAllSessions(authTestAddress)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("newly revoked sessions = %d, want 1", count)
	}
	if _, err := store.ResolveSession(second); !errors.Is(err, errAuthSessionUnavailable) {
		t.Fatalf("wallet session resolve = %v", err)
	}
	if _, err := store.ResolveSession(other); err != nil {
		t.Fatalf("other wallet session unexpectedly revoked: %v", err)
	}
}

func TestAuthStoreRejectsExpiredRevokedAndDisabledAppSessions(t *testing.T) {
	store, db := newTestAuthStore(t)
	store.randRead = deterministicRand()
	base := time.Now().UTC().Truncate(time.Second)
	store.now = func() time.Time { return base }

	t.Run("expired", func(t *testing.T) {
		token, _, err := store.IssueSession(authTestAddress, "nimconnect", []string{"friends:read"})
		if err != nil {
			t.Fatal(err)
		}
		store.now = func() time.Time { return base.Add(7 * 24 * time.Hour) }
		if _, err := store.ResolveSession(token); !errors.Is(err, errAuthSessionUnavailable) {
			t.Fatalf("expired resolve = %v", err)
		}
		store.now = func() time.Time { return base }
	})

	t.Run("revoked", func(t *testing.T) {
		token, _, err := store.IssueSession(authTestAddress, "nimconnect", []string{"friends:read"})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.RevokeSession(token); err != nil {
			t.Fatal(err)
		}
		if _, err := store.ResolveSession(token); !errors.Is(err, errAuthSessionUnavailable) {
			t.Fatalf("revoked resolve = %v", err)
		}
	})

	t.Run("disabled app", func(t *testing.T) {
		token, _, err := store.IssueSession(authTestAddress, "nimworld", []string{"friends:read"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE auth_apps SET enabled = false WHERE audience = 'nimworld'`); err != nil {
			t.Fatal(err)
		}
		if _, err := store.ResolveSession(token); !errors.Is(err, errAuthSessionUnavailable) {
			t.Fatalf("disabled app resolve = %v", err)
		}
	})
}

func TestAuthStoreRejectsExpiredChallenge(t *testing.T) {
	store, db := newTestAuthStore(t)
	store.randRead = deterministicRand()
	challenge, err := store.CreateChallenge(authTestAddress, "nimconnect", []string{"friends:read"},
		func(nonce string, _ time.Time) string { return nonce })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE auth_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, challenge.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ConsumeChallenge(challenge.ID); !errors.Is(err, errAuthChallengeUnavailable) {
		t.Fatalf("expired consume = %v, want errAuthChallengeUnavailable", err)
	}
}
