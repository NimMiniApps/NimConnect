package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"testing"
	"time"
)

func signMessage(t *testing.T, priv ed25519.PrivateKey, message string) (publicKeyHex, signatureHex string) {
	t.Helper()
	hash := nimiqSignedMessageHash(message)
	sig := ed25519.Sign(priv, hash[:])
	pub := priv.Public().(ed25519.PublicKey)
	return hex.EncodeToString(pub), hex.EncodeToString(sig)
}

func testKeypairAndAddress(t *testing.T) (ed25519.PrivateKey, string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	addr, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	return priv, addr
}

func TestVerifyListingIntent_AcceptsValidSignature(t *testing.T) {
	priv, seller := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	err := verifyListingIntent("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt, pubHex, sigHex)
	if err != nil {
		t.Fatal(err)
	}
}

func TestVerifyListingIntent_RejectsWrongSellerOrTamperedFields(t *testing.T) {
	priv, seller := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	if err := verifyListingIntent("chuck", seller, 9999, 50, "tx1", "nonce1", expiresAt, pubHex, sigHex); err == nil {
		t.Fatal("expected an error for a tampered price")
	}
	_, otherSeller := testKeypairAndAddress(t)
	if err := verifyListingIntent("chuck", otherSeller, 1000, 50, "tx1", "nonce1", expiresAt, pubHex, sigHex); err == nil {
		t.Fatal("expected an error when the claimed seller doesn't match the signing key")
	}
}

func TestVerifyListingIntent_RejectsExpiredIntent(t *testing.T) {
	priv, seller := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(-time.Minute).Unix()
	message := marketplaceListingMessage("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	if err := verifyListingIntent("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt, pubHex, sigHex); err == nil {
		t.Fatal("expected an error for an expired intent")
	}
}

func TestVerifyPurchaseIntent_AcceptsValidSignature(t *testing.T) {
	priv, buyer := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplacePurchaseMessage("chuck", buyer, buyer, "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	if err := verifyPurchaseIntent("chuck", buyer, buyer, "nonce1", expiresAt, pubHex, sigHex); err != nil {
		t.Fatal(err)
	}
}
