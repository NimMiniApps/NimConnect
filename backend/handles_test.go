package main

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestIsValidHandle(t *testing.T) {
	valid := []string{"chuck", "a_1", "abc", "x2345678901234567890123456"} // 26 chars
	for _, h := range valid {
		if !isValidHandle(h) {
			t.Errorf("expected %q valid", h)
		}
	}
	invalid := []string{"", "ab", "Chuck", "chü", "has space", "x23456789012345678901234567", "dash-ed"}
	for _, h := range invalid {
		if isValidHandle(h) {
			t.Errorf("expected %q invalid", h)
		}
	}
}

func TestParseClaimData(t *testing.T) {
	hexOf := func(s string) string { return hex.EncodeToString([]byte(s)) }

	cases := []struct {
		name   string
		data   string
		verb   string
		handle string
	}{
		{"claim", hexOf("NCC:v1:claim:chuck"), "claim", "chuck"},
		{"release", hexOf("NCC:v1:release:chuck"), "release", "chuck"},
		{"0x prefix tolerated", "0x" + hexOf("NCC:v1:claim:chuck"), "claim", "chuck"},
		{"round trip", hexOf(makeClaimPayload("claim", "a_1")), "claim", "a_1"},
	}
	for _, c := range cases {
		got := parseClaimData(c.data)
		if got == nil || got.Verb != c.verb || got.Handle != c.handle {
			t.Errorf("%s: got %+v", c.name, got)
		}
	}

	rejected := []string{
		"",                                  // empty
		"zz-not-hex",                        // not hex
		hexOf("hello world"),                // unrelated payload
		hexOf("NFH:0102"),                   // NimFeed payload
		hexOf("NCC:v1:claim:Chuck"),         // bad handle casing
		hexOf("NCC:v1:claim:ab"),            // too short
		hexOf("NCC:v1:transfer:chuck"),      // unknown verb -> ignored (forward compat)
		hexOf("NCC:v2:claim:chuck"),         // unknown version
		hexOf("NCC:v1:claim"),               // missing handle
	}
	for _, data := range rejected {
		if got := parseClaimData(data); got != nil {
			t.Errorf("expected nil for %q, got %+v", data, got)
		}
	}
}

func TestClaimPayloadFitsNimiqPayTextLimit(t *testing.T) {
	longest := makeClaimPayload("release", "x2345678901234567890123456")
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
