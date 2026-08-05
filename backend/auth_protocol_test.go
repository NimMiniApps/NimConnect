package main

import (
	"testing"
	"time"
)

func TestAuthorizationMessageCanonical(t *testing.T) {
	expires := time.Date(2026, 8, 12, 12, 0, 0, 0, time.UTC)
	got, scopes, err := buildAuthorizationMessage(
		"NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD",
		"nimworld",
		[]string{ScopeInboxRead, ScopeFriendsWrite, ScopeFriendsRead},
		expires,
		"AbCdEfGhIjKlMnOpQrStUw",
	)
	if err != nil {
		t.Fatal(err)
	}
	want := "NimConnect authorization v3\n" +
		"App: nimworld\n" +
		"Address: NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD\n" +
		"Access: friends:read, friends:write, inbox:read\n" +
		"Expires: 2026-08-12T12:00:00Z\n" +
		"Nonce: AbCdEfGhIjKlMnOpQrStUw"
	if got != want {
		t.Fatalf("message mismatch\n got: %q\nwant: %q", got, want)
	}
	if len(scopes) != 3 || scopes[0] != ScopeFriendsRead || scopes[2] != ScopeInboxRead {
		t.Fatalf("unexpected canonical scopes: %v", scopes)
	}
}

func TestAuthorizationMessageRejectsInvalidScopesAndAudience(t *testing.T) {
	expires := time.Now().UTC().Add(time.Hour)
	for _, tc := range []struct {
		name     string
		audience string
		scopes   []string
	}{
		{"duplicate", "nimconnect", []string{ScopeFriendsRead, ScopeFriendsRead}},
		{"unknown", "nimconnect", []string{"wallet:spend"}},
		{"bad audience", "Bad App", []string{ScopeFriendsRead}},
		{"empty", "nimconnect", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := buildAuthorizationMessage("NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD", tc.audience, tc.scopes, expires, "nonce"); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}
