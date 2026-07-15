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
		{"Nimiq Pay on-chain double hex (androiddev claim)", "34653436343833613334363533343336333033313330333133363331333636353336333433373332333636363336333933363334333633343336333533373336", "androiddev"},
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

func TestClaimantAddressHTLC(t *testing.T) {
	// Real mainnet claim tx 9fa2ecc0… — sent from an HTLC (Nimiq Pay swap).
	// EarlyResolve proof: the FIRST signature proof is the HTLC recipient
	// (the user); the second is the swap provider's refund key.
	earlyResolveProof := "010091b21f4b100273bd7034f6369c29d1f7ba72dba7de6720ad3cd8b8191621891300e066464061ee77c5847bd4f77faaeedb861836a62674019da2ec1069fe9f054e8be5fd4a04109a33cbc5080e1bd8f3518c1ce0a7f9c14b9496e60c593e98be0300b50660d8a11c6143211ef7554d16bc8be45aa55553a0643f83d9a5c3815201e2005f69f34b0280be6f4144447350c3d295605ea452f74848b50b6b005ea13c44aaa0810096f56cf1387061d803395630058e268c220bc9baaa94a05ee12857cd06"

	tx := rpcTx{Sender: "NQ03 064C F89U 6LT7 6PDT R1PJ XJ99 368N 1LKH", FromType: 2, Proof: earlyResolveProof}
	if got := claimantAddress(tx); got != "NQ14 LU5R UH54 92SH GEN4 U63C SV4V 7N49 YYU4" {
		t.Fatalf("EarlyResolve claimant: got %q", got)
	}

	// RegularTransfer: signature proof sits after type+algo+depth+root+preimage.
	pubKey := earlyResolveProof[4 : 4+64] // reuse the user's pubkey hex from above
	regular := "00" + "01" + "01" + strings.Repeat("00", 64) + "00" + pubKey
	tx = rpcTx{Sender: "NQ03 HTLC", FromType: 2, Proof: regular}
	if got := claimantAddress(tx); got != "NQ14 LU5R UH54 92SH GEN4 U63C SV4V 7N49 YYU4" {
		t.Fatalf("RegularTransfer claimant: got %q", got)
	}

	// Non-HTLC senders pass through untouched.
	tx = rpcTx{Sender: "NQ11 OWNER", FromType: 0, Proof: earlyResolveProof}
	if got := claimantAddress(tx); got != "NQ11 OWNER" {
		t.Fatalf("basic sender: got %q", got)
	}

	// Unparseable proof falls back to the raw sender.
	tx = rpcTx{Sender: "NQ03 HTLC", FromType: 2, Proof: "zz"}
	if got := claimantAddress(tx); got != "NQ03 HTLC" {
		t.Fatalf("garbage proof fallback: got %q", got)
	}
	tx = rpcTx{Sender: "NQ03 HTLC", FromType: 2, Proof: "09" + pubKey}
	if got := claimantAddress(tx); got != "NQ03 HTLC" {
		t.Fatalf("unknown proof type fallback: got %q", got)
	}
}
