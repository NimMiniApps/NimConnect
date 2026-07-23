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
