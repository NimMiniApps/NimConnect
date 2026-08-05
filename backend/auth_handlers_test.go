package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScopedAuthorizationChallengeExchangeAndReplay(t *testing.T) {
	db := withTestDB(t)
	store := NewAuthStore(db)
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	challengeReq := httptest.NewRequest(http.MethodPost, "/api/auth/challenges", strings.NewReader(
		`{"address":"`+address+`","audience":"nimworld","scopes":["friends:read"]}`))
	challengeReq.Header.Set("Origin", "https://nimworld.nimiqminiapps.com")
	challengeRec := httptest.NewRecorder()
	createAuthChallengeHandler(store)(challengeRec, challengeReq)
	if challengeRec.Code != http.StatusOK {
		t.Fatalf("challenge: %d %s", challengeRec.Code, challengeRec.Body.String())
	}
	var challenge struct {
		ChallengeID string `json:"challenge_id"`
		Message     string `json:"message"`
		ExpiresAt   int64  `json:"expires_at"`
	}
	if err := json.Unmarshal(challengeRec.Body.Bytes(), &challenge); err != nil {
		t.Fatal(err)
	}
	if challenge.ChallengeID == "" || challenge.Message == "" {
		t.Fatalf("bad challenge: %+v", challenge)
	}

	hash := nimiqSignedMessageHash(challenge.Message)
	sig := ed25519.Sign(priv, hash[:])
	body := `{"challenge_id":"` + challenge.ChallengeID + `","public_key":"` + hex.EncodeToString(pub) + `","signature":"` + hex.EncodeToString(sig) + `"}`
	exchangeReq := httptest.NewRequest(http.MethodPost, "/api/auth/sessions", strings.NewReader(body))
	exchangeRec := httptest.NewRecorder()
	createAuthSessionHandler(store)(exchangeRec, exchangeReq)
	if exchangeRec.Code != http.StatusOK {
		t.Fatalf("exchange: %d %s", exchangeRec.Code, exchangeRec.Body.String())
	}
	var session struct {
		Token, Address, Audience string
		Scopes                   []string
		ExpiresAt                int64 `json:"expires_at"`
	}
	if err := json.Unmarshal(exchangeRec.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	if session.Token == "" || compactAddress(session.Address) != compactAddress(address) || session.Audience != "nimworld" {
		t.Fatalf("bad session: %+v", session)
	}

	replayRec := httptest.NewRecorder()
	createAuthSessionHandler(store)(replayRec, httptest.NewRequest(http.MethodPost, "/api/auth/sessions", strings.NewReader(body)))
	if replayRec.Code != http.StatusUnauthorized {
		t.Fatalf("replay got %d", replayRec.Code)
	}
}

func TestInvalidSignatureDoesNotConsumeChallenge(t *testing.T) {
	db := withTestDB(t)
	store := NewAuthStore(db)
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	challenge, err := store.CreateChallenge(address, "nimconnect", []string{ScopeFriendsRead}, func(n string, exp time.Time) string {
		msg, _, _ := buildAuthorizationMessage(address, "nimconnect", []string{ScopeFriendsRead}, exp, n)
		return msg
	})
	if err != nil {
		t.Fatal(err)
	}
	badBody := `{"challenge_id":"` + challenge.ID + `","public_key":"` + hex.EncodeToString(pub) + `","signature":"` + strings.Repeat("00", 64) + `"}`
	badRec := httptest.NewRecorder()
	createAuthSessionHandler(store)(badRec, httptest.NewRequest(http.MethodPost, "/api/auth/sessions", strings.NewReader(badBody)))
	if badRec.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature got %d", badRec.Code)
	}
	hash := nimiqSignedMessageHash(challenge.Message)
	goodBody := `{"challenge_id":"` + challenge.ID + `","public_key":"` + hex.EncodeToString(pub) + `","signature":"` + hex.EncodeToString(ed25519.Sign(priv, hash[:])) + `"}`
	goodRec := httptest.NewRecorder()
	createAuthSessionHandler(store)(goodRec, httptest.NewRequest(http.MethodPost, "/api/auth/sessions", strings.NewReader(goodBody)))
	if goodRec.Code != http.StatusOK {
		t.Fatalf("valid after invalid: %d %s", goodRec.Code, goodRec.Body.String())
	}
}
