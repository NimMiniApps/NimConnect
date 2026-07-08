package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func signNimiqBackupChallenge(priv ed25519.PrivateKey, address string, exportedAt int64) []byte {
	challenge := backupChallenge(address, exportedAt)
	hash := nimiqSignedMessageHash(challenge)
	return ed25519.Sign(priv, hash[:])
}

func TestNimiqSignedMessageHashMatchesJsLength(t *testing.T) {
	// JS signMessage uses string .length (code units); ASCII challenges match Go len().
	challenge := backupChallenge("NQ07 0000 0000 0000 0000 0000 0000 0000 0000", 1710000000000)
	if len(challenge) != len([]rune(challenge)) {
		t.Fatal("test challenge should be ASCII")
	}
	_ = nimiqSignedMessageHash(challenge)
}

func TestVerifyBackupAuthRoundTrip(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	address, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	exportedAt := int64(1710000000000)
	sig := signNimiqBackupChallenge(priv, address, exportedAt)
	if err := verifyBackupAuth(address, hex.EncodeToString(pub), hex.EncodeToString(sig), exportedAt); err != nil {
		t.Fatalf("expected valid auth, got %v", err)
	}
}

func TestVerifyBackupAuthRejectsWrongAddress(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	exportedAt := int64(1710000000000)
	sig := signNimiqBackupChallenge(priv, "NQ07 0000 0000 0000 0000 0000 0000 0000 0000", exportedAt)
	if err := verifyBackupAuth("NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF", hex.EncodeToString(pub), hex.EncodeToString(sig), exportedAt); err == nil {
		t.Fatal("expected auth failure for wrong address")
	}
}

func TestVerifyBackupAuthRejectsRawMessageSignature(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	exportedAt := int64(1710000000000)
	rawSig := ed25519.Sign(priv, []byte(backupChallenge(address, exportedAt)))
	if err := verifyBackupAuth(address, hex.EncodeToString(pub), hex.EncodeToString(rawSig), exportedAt); err == nil {
		t.Fatal("expected rejection of non-Nimiq-prefixed signature")
	}
}

func TestBackupStorePutGetConflict(t *testing.T) {
	dir := t.TempDir()
	store := NewBackupStore(dir)

	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	address, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}

	makeReq := func(exportedAt int64) BackupPutRequest {
		sig := signNimiqBackupChallenge(priv, address, exportedAt)
		return BackupPutRequest{
			ExportedAt: exportedAt,
			Salt:       "c2FsdA==",
			Ciphertext: "Y2lwaGVydGV4dA==",
			PublicKey:  hex.EncodeToString(pub),
			Signature:  hex.EncodeToString(sig),
		}
	}

	if err := store.Put(address, makeReq(200)); err != nil {
		t.Fatalf("put failed: %v", err)
	}
	rec, err := store.Get(address)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if rec.ExportedAt != 200 {
		t.Fatalf("expected exported_at 200, got %d", rec.ExportedAt)
	}

	if err := store.Put(address, makeReq(100)); err != errConflict {
		t.Fatalf("expected conflict, got %v", err)
	}
	if err := store.Put(address, makeReq(300)); err != nil {
		t.Fatalf("newer put failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(dir, compactAddress(address)+".json")); err != nil {
		t.Fatalf("backup file missing: %v", err)
	}
}

func TestBackupHTTPHandlers(t *testing.T) {
	dir := t.TempDir()
	store := NewBackupStore(dir)
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	exportedAt := int64(500)
	sig := signNimiqBackupChallenge(priv, address, exportedAt)

	body := `{"exported_at":500,"salt":"c2FsdA==","ciphertext":"Y2k=","public_key":"` + hex.EncodeToString(pub) + `","signature":"` + hex.EncodeToString(sig) + `"}`
	putReq := httptest.NewRequest(http.MethodPut, "/api/backup/x", strings.NewReader(body))
	putReq.SetPathValue("address", address)
	putRec := httptest.NewRecorder()
	backupPutHandler(store)(putRec, putReq)
	if putRec.Code != http.StatusOK {
		t.Fatalf("put status %d body %s", putRec.Code, putRec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/backup/x", nil)
	getReq.SetPathValue("address", address)
	getRec := httptest.NewRecorder()
	backupGetHandler(store)(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status %d", getRec.Code)
	}
}
