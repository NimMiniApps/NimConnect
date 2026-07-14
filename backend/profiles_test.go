package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

// testSigner creates a keypair and returns (address, publicKeyHex, sign(message) -> signatureHex).
func testSigner(t *testing.T) (string, string, func(string) string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	address, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	sign := func(message string) string {
		hash := nimiqSignedMessageHash(message)
		return hex.EncodeToString(ed25519.Sign(priv, hash[:]))
	}
	return address, hex.EncodeToString(pub), sign
}

func validProfileJSON() string {
	return `{"display_name":"Chuck","bio":"Nimiq builder","tags":["friend"]}`
}

func putReq(t *testing.T, updatedAt int64, profile string) (ProfilePutRequest, string) {
	t.Helper()
	address, pubHex, sign := testSigner(t)
	return ProfilePutRequest{
		Address:   address,
		UpdatedAt: updatedAt,
		Profile:   profile,
		PublicKey: pubHex,
		Signature: sign(profilePutMessage(address, updatedAt, sha256Hex(profile))),
	}, address
}

func TestProfilePutGetRoundTrip(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	req, address := putReq(t, 1000, validProfileJSON())
	if err := store.Put(req); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	if got.Profile != validProfileJSON() || got.UpdatedAt != 1000 {
		t.Fatalf("round trip mismatch: %+v", got)
	}
}

func TestProfilePutRejectsBadSignature(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	req, _ := putReq(t, 1000, validProfileJSON())
	req.Profile = `{"display_name":"Tampered"}` // signature no longer matches
	if err := store.Put(req); !errors.Is(err, errUnauthorized) {
		t.Fatalf("want errUnauthorized, got %v", err)
	}
}

func TestProfilePutRejectsReplay(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	address, pubHex, sign := testSigner(t)
	mkReq := func(updatedAt int64, profile string) ProfilePutRequest {
		return ProfilePutRequest{
			Address: address, UpdatedAt: updatedAt, Profile: profile, PublicKey: pubHex,
			Signature: sign(profilePutMessage(address, updatedAt, sha256Hex(profile))),
		}
	}
	if err := store.Put(mkReq(2000, validProfileJSON())); err != nil {
		t.Fatal(err)
	}
	// Same timestamp and an older timestamp must both be rejected.
	if err := store.Put(mkReq(2000, `{"bio":"replayed"}`)); !errors.Is(err, errConflict) {
		t.Fatalf("want errConflict for same updated_at, got %v", err)
	}
	if err := store.Put(mkReq(1000, `{"bio":"older"}`)); !errors.Is(err, errConflict) {
		t.Fatalf("want errConflict for older updated_at, got %v", err)
	}
	// Newer is fine.
	if err := store.Put(mkReq(3000, `{"bio":"newer"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestProfilePayloadValidation(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	bad := []string{
		`not json`,
		`[]`,                                     // not an object
		`{"unknown_key":"x"}`,                    // unknown key
		`{"display_name":123}`,                   // wrong type
		`{"bio":"` + strings.Repeat("x", 400) + `"}`, // over cap
		`{"tags":["a","b","c","d","e","f","g","h","i"]}`, // too many tags
		`{"tags":[1]}`,                           // non-string tag
		`{"website":"javascript:alert(1)"}`,      // non-http(s) scheme -> XSS via href
		`{"website":"data:text/html,x"}`,         // non-http(s) scheme
		`{"website":"https://"}`,                 // no host
	}
	for _, profile := range bad {
		req, _ := putReq(t, 1000, profile)
		if err := store.Put(req); !errors.Is(err, errBadRequest) {
			t.Errorf("profile %q: want errBadRequest, got %v", profile, err)
		}
	}
}

func TestProfileDelete(t *testing.T) {
	store := NewProfileStore(t.TempDir())
	address, pubHex, sign := testSigner(t)
	put := ProfilePutRequest{
		Address: address, UpdatedAt: 1000, Profile: validProfileJSON(), PublicKey: pubHex,
		Signature: sign(profilePutMessage(address, 1000, sha256Hex(validProfileJSON()))),
	}
	if err := store.Put(put); err != nil {
		t.Fatal(err)
	}
	// Delete needs a NEWER updated_at, signed.
	if err := store.Delete(address, 2000, pubHex, sign(profileDeleteMessage(address, 2000))); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(address); !errors.Is(err, errNotFound) {
		t.Fatalf("want errNotFound after delete, got %v", err)
	}
}
