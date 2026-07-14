package main

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsValidHandle(t *testing.T) {
	valid := []string{"chuck", "a_1", "abc", strings.Repeat("x", 31)} // NimFeed max
	for _, h := range valid {
		if !isValidHandle(h) {
			t.Errorf("expected %q valid", h)
		}
	}
	invalid := []string{"", "ab", "Chuck", "chü", "has space", strings.Repeat("x", 32), "dash-ed"}
	for _, h := range invalid {
		if isValidHandle(h) {
			t.Errorf("expected %q invalid", h)
		}
	}
}

// nimfeedClaim builds the raw binary PROFILE_CLAIM payload NimFeed's Hub
// flow puts on chain: "NF" 0x01 0x01 username [0x00 displayName].
func nimfeedClaim(username, displayName string) []byte {
	payload := append([]byte{0x4e, 0x46, 0x01, 0x01}, []byte(username)...)
	if displayName != "" {
		payload = append(payload, 0x00)
		payload = append(payload, []byte(displayName)...)
	}
	return payload
}

func TestParseClaimData(t *testing.T) {
	hexOf := func(b []byte) string { return hex.EncodeToString(b) }

	cases := []struct {
		name   string
		data   string
		handle string
	}{
		{"raw binary, username only", hexOf(nimfeedClaim("chuck", "")), "chuck"},
		{"raw binary with display name", hexOf(nimfeedClaim("chuck", "Chuck V")), "chuck"},
		{"NFH text envelope (Nimiq Pay)", hexOf([]byte("NFH:" + hexOf(nimfeedClaim("chuck", "")))), "chuck"},
		{"our own envelope round-trips", hexOf([]byte(makeClaimPayload("a_1"))), "a_1"},
		{"0x prefix tolerated", "0x" + hexOf(nimfeedClaim("chuck", "")), "chuck"},
	}
	for _, c := range cases {
		got := parseClaimData(c.data)
		if got == nil || got.Handle != c.handle {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}

	rejected := []string{
		"",                          // empty
		"zz-not-hex",                // not hex
		hexOf([]byte("hello")),      // unrelated payload
		hexOf([]byte{0x4e, 0x46}),   // truncated header
		hexOf([]byte{0x4e, 0x46, 0x02, 0x01, 'c', 'h', 'u', 'c', 'k'}), // unknown version
		hexOf([]byte{0x4e, 0x46, 0x01, 0x02, 'c', 'h', 'u', 'c', 'k'}), // POST_INLINE, not a claim
		hexOf(nimfeedClaim("Chuck", "")),  // bad casing
		hexOf(nimfeedClaim("ab", "")),     // too short
		hexOf([]byte("NFH:zznothex")),     // envelope with bad inner hex
		hexOf([]byte("NCC:v1:claim:old")), // our retired text format
	}
	for _, data := range rejected {
		if got := parseClaimData(data); got != nil {
			t.Errorf("expected nil for %q, got %+v", data, got)
		}
	}
}

func TestClaimPayloadFitsNimiqPayTextLimit(t *testing.T) {
	// 26 chars is the longest username claimable from inside Nimiq Pay.
	longest := makeClaimPayload(strings.Repeat("x", 26))
	if len(longest) > 64 {
		t.Errorf("payload %q is %d chars, exceeds Nimiq Pay 64-char text limit", longest, len(longest))
	}
}

func TestLoadReservedHandles(t *testing.T) {
	// Missing file -> builtin defaults.
	set := loadReservedHandles(filepath.Join(t.TempDir(), "missing.json"))
	if !set["nimiq"] || !set["admin"] {
		t.Fatalf("builtin reserved set missing expected entries: %v", set)
	}

	// File overrides builtins entirely.
	path := filepath.Join(t.TempDir(), "reserved.json")
	os.WriteFile(path, []byte(`["OnlyThis"]`), 0o600)
	set = loadReservedHandles(path)
	if !set["onlythis"] || set["nimiq"] {
		t.Fatalf("file should replace builtins (lowercased): %v", set)
	}
}
