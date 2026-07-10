package main

import (
	"strings"
	"testing"
)

func TestInboxSendMessageCanonicalFormat(t *testing.T) {
	got := inboxSendMessage("NQ11 AAAA", "nq22 bbbb", 42, "abc", "obj-1", "deadbeef")
	want := "nimconnect:inbox:send:v1\nsender=NQ11AAAA\nrecipient=NQ22BBBB\nsentAt=42\nnonce=abc\nobjectId=obj-1\npayloadHash=deadbeef"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestInboxReadMessageCanonicalFormat(t *testing.T) {
	got := inboxReadMessage("nq22 bbbb", 7)
	if got != "nimconnect:inbox:read:v1\naddress=NQ22BBBB\nissuedAt=7" {
		t.Fatalf("got %q", got)
	}
}

func TestIsValidNimiqAddress(t *testing.T) {
	pub := make([]byte, 32)
	valid, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]bool{
		valid:                                  true,
		strings.ToLower(valid):                 true,
		"NQ00 0000 0000 0000 0000 0000 0000 0000 0000": false, // bad checksum
		"../../etc/passwd":                     false,
		"":                                     false,
		valid + "A":                            false,
	}
	for addr, want := range cases {
		if got := isValidNimiqAddress(addr); got != want {
			t.Errorf("isValidNimiqAddress(%q) = %v, want %v", addr, got, want)
		}
	}
}

func TestNonceAndMessageIDFormats(t *testing.T) {
	if !isInboxNonce("0123456789abcdef0123456789abcdef") {
		t.Fatal("valid nonce rejected")
	}
	for _, bad := range []string{"", "xyz", strings.Repeat("A", 32), strings.Repeat("a", 31), strings.Repeat("a", 33)} {
		if isInboxNonce(bad) {
			t.Fatalf("bad nonce accepted: %q", bad)
		}
	}
	id := newMessageID()
	if !isMessageID(id) {
		t.Fatalf("generated id fails own validation: %q", id)
	}
	if isMessageID("../../x") || isMessageID("") {
		t.Fatal("path-traversal id accepted")
	}
}

func TestSha256Hex(t *testing.T) {
	if sha256Hex("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatal("sha256Hex wrong")
	}
}
