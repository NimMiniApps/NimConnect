package main

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

func signUserSessionChallenge(priv ed25519.PrivateKey, address string, timestamp int64) []byte {
	challenge := userSessionChallenge(address, timestamp)
	hash := nimiqSignedMessageHash(challenge)
	return ed25519.Sign(priv, hash[:])
}

func userSessionLoginBody(address, publicKeyHex string, sig []byte, timestamp int64) string {
	return fmt.Sprintf(`{"address":%q,"publicKey":%q,"signature":%q,"timestamp":%d}`,
		address, publicKeyHex, hex.EncodeToString(sig), timestamp)
}

func TestUserSessionLoginHandlerAcceptsValidSignature(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	address, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}

	sessions := NewUserSessions()
	fixedNow := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	handler := userSessionLoginHandler(sessions)

	ts := fixedNow.Unix()
	sig := signUserSessionChallenge(priv, address, ts)
	body := userSessionLoginBody(address, hex.EncodeToString(pub), sig, ts)

	req := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(body))
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
	addr, ok := sessions.AddressFor(resp.Token)
	if !ok || compactAddress(addr) != compactAddress(address) {
		t.Fatalf("expected token to map to address, got %q ok=%v", addr, ok)
	}
	if resp.ExpiresAt != fixedNow.Add(userSessionTTL).Unix() {
		t.Fatalf("expires_at = %d, want %d", resp.ExpiresAt, fixedNow.Add(userSessionTTL).Unix())
	}
}

func TestUserSessionLoginHandlerRejectsBadSignature(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	sessions := NewUserSessions()
	fixedNow := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	handler := userSessionLoginHandler(sessions)

	ts := fixedNow.Unix()
	sig := signUserSessionChallenge(priv, address, ts)
	sig[0] ^= 0xFF
	body := userSessionLoginBody(address, hex.EncodeToString(pub), sig, ts)

	req := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", w.Code)
	}
}

func TestUserSessionLoginHandlerRejectsExpiredChallengeWindow(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	sessions := NewUserSessions()
	fixedNow := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	handler := userSessionLoginHandler(sessions)

	cases := map[string]int64{
		"stale":  fixedNow.Add(-10 * time.Minute).Unix(),
		"future": fixedNow.Add(10 * time.Minute).Unix(),
	}
	for name, ts := range cases {
		sig := signUserSessionChallenge(priv, address, ts)
		body := userSessionLoginBody(address, hex.EncodeToString(pub), sig, ts)
		req := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(body))
		w := httptest.NewRecorder()
		handler(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s timestamp: got %d, want 401", name, w.Code)
		}
	}
}

func TestUserSessionLogoutHandlerRevokesToken(t *testing.T) {
	sessions := NewUserSessions()
	fixedNow := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }

	token, _, err := sessions.Issue("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")
	if err != nil {
		t.Fatal(err)
	}

	handler := userSessionLogoutHandler(sessions)
	req := httptest.NewRequest(http.MethodDelete, "/api/session", nil)
	req.Header.Set("X-NimConnect-Session", token)
	w := httptest.NewRecorder()
	handler(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204", w.Code)
	}
	if _, ok := sessions.AddressFor(token); ok {
		t.Fatal("expected revoked token to miss")
	}
}

func TestRequireUserSession(t *testing.T) {
	sessions := NewUserSessions()
	fixedNow := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }

	token, _, err := sessions.Issue("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/friends", nil)
	req.Header.Set("X-NimConnect-Session", token)
	addr, ok := requireUserSession(sessions, req)
	if !ok || compactAddress(addr) != compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD") {
		t.Fatalf("lookup failed: %q %v", addr, ok)
	}

	bad := httptest.NewRequest(http.MethodGet, "/api/friends", nil)
	if _, ok := requireUserSession(sessions, bad); ok {
		t.Fatal("expected missing header to fail")
	}
}

func TestUserSessionLoginHandlerRejectsMalformedJSON(t *testing.T) {
	handler := userSessionLoginHandler(NewUserSessions())
	req := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader("{not json"))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400", w.Code)
	}
}

func TestUserSessionLoginHandlerRandFailureIsServerError(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	sessions := NewUserSessions()
	fixedNow := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	sessions.now = func() time.Time { return fixedNow }
	sessions.randRead = func(b []byte) (int, error) { return 0, errors.New("boom") }
	handler := userSessionLoginHandler(sessions)

	ts := fixedNow.Unix()
	sig := signUserSessionChallenge(priv, address, ts)
	body := userSessionLoginBody(address, hex.EncodeToString(pub), sig, ts)

	req := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(body))
	w := httptest.NewRecorder()
	handler(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("got %d, want 500", w.Code)
	}
}
