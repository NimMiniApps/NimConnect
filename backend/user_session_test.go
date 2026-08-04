package main

import (
	"testing"
	"time"
)

func TestUserSessionsIssueLookupRevoke(t *testing.T) {
	s := NewUserSessions()
	s.now = func() time.Time { return time.Unix(1_700_000_000, 0) }

	token, exp, err := s.Issue("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD", "nimworld")
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
	gotAddr, audience, ok := s.SessionFor(token)
	if !ok || compactAddress(gotAddr) != compactAddress("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD") || audience != "nimworld" {
		t.Fatalf("SessionFor failed: addr=%q audience=%q ok=%v", gotAddr, audience, ok)
	}
	s.Revoke(token)
	if _, ok := s.AddressFor(token); ok {
		t.Fatal("expected revoked token to miss")
	}
}

func TestUserSessionChallengeV1(t *testing.T) {
	got := userSessionChallengeV1("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD", 1700000000)
	want := "nimconnect-session:v1:NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD:1700000000"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestUserSessionChallengeV2(t *testing.T) {
	got := userSessionChallenge("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD", 1700000000, "nimworld")
	want := "nimconnect-session:v2:NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD:1700000000:nimworld"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
