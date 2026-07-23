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
