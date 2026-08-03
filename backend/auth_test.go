package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
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

func signNimiqBackupChallengeV2(priv ed25519.PrivateKey, address string, exportedAt int64, salt, ciphertextB64 string) []byte {
	raw, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		panic(err)
	}
	sum := sha256.Sum256(raw)
	challenge := backupChallengeV2(address, exportedAt, salt, hex.EncodeToString(sum[:]))
	hash := nimiqSignedMessageHash(challenge)
	return ed25519.Sign(priv, hash[:])
}

func backupPutReq(priv ed25519.PrivateKey, pub ed25519.PublicKey, address string, exportedAt int64, salt, ciphertext string) BackupPutRequest {
	sig := signNimiqBackupChallengeV2(priv, address, exportedAt, salt, ciphertext)
	return BackupPutRequest{
		ExportedAt: exportedAt,
		Salt:       salt,
		Ciphertext: ciphertext,
		PublicKey:  hex.EncodeToString(pub),
		Signature:  hex.EncodeToString(sig),
	}
}

func TestNimiqSignedMessageHashMatchesJsLength(t *testing.T) {
	// JS signMessage uses string .length (code units); ASCII challenges match Go len().
	challenge := backupChallenge("NQ07 0000 0000 0000 0000 0000 0000 0000 0000", 1710000000000)
	if len(challenge) != len([]rune(challenge)) {
		t.Fatal("test challenge should be ASCII")
	}
	_ = nimiqSignedMessageHash(challenge)
}

func TestVerifySignedMessageAcceptsValidAndRejectsTampered(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	addr, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	msg := "nimconnect:inbox:send:v1\nsender=X\nrecipient=Y\nsentAt=1\nnonce=a\nobjectId=b\npayloadHash=c"
	hash := nimiqSignedMessageHash(msg)
	sig := ed25519.Sign(priv, hash[:])

	if err := verifySignedMessage(addr, hex.EncodeToString(pub), hex.EncodeToString(sig), msg); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	if err := verifySignedMessage(addr, hex.EncodeToString(pub), hex.EncodeToString(sig), msg+"x"); err == nil {
		t.Fatal("tampered message accepted")
	}
	if err := verifySignedMessage("NQ07 0000 0000 0000 0000 0000 0000 0000 0000", hex.EncodeToString(pub), hex.EncodeToString(sig), msg); err == nil {
		t.Fatal("wrong address accepted")
	}
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

	salt := "c2FsdA=="
	ct := "Y2lwaGVydGV4dA=="
	makeReq := func(exportedAt int64) BackupPutRequest {
		return backupPutReq(priv, pub, address, exportedAt, salt, ct)
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

func TestBackupStoreRejectsEqualTimestampReplacement(t *testing.T) {
	dir := t.TempDir()
	store := NewBackupStore(dir)
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	first := backupPutReq(priv, pub, address, 200, "c2FsdA==", "Y2lwaGVydGV4dA==")
	if err := store.Put(address, first); err != nil {
		t.Fatal(err)
	}
	// Same timestamp, different ciphertext — classic SEC-001 exploit shape with a fresh v2 sig.
	second := backupPutReq(priv, pub, address, 200, "c2FsdA==", "YXR0YWNrZXI=")
	if err := store.Put(address, second); err != errConflict {
		t.Fatalf("expected conflict for equal-timestamp replacement, got %v", err)
	}
	rec, _ := store.Get(address)
	if rec.Ciphertext != first.Ciphertext {
		t.Fatal("existing ciphertext was replaced")
	}
}

func TestBackupStoreRejectsModifiedSaltOrCiphertextWithV1Sig(t *testing.T) {
	dir := t.TempDir()
	store := NewBackupStore(dir)
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)

	salt := "c2FsdA=="
	ct := "Y2lwaGVydGV4dA=="
	if err := store.Put(address, backupPutReq(priv, pub, address, 200, salt, ct)); err != nil {
		t.Fatal(err)
	}

	// Harvested v1 signature must not authorize a write.
	v1Sig := signNimiqBackupChallenge(priv, address, 300)
	v1Req := BackupPutRequest{
		ExportedAt: 300,
		Salt:       "bmV3c2FsdA==",
		Ciphertext: "YXR0YWNrZXI=",
		PublicKey:  hex.EncodeToString(pub),
		Signature:  hex.EncodeToString(v1Sig),
	}
	if err := store.Put(address, v1Req); err != errUnauthorized {
		t.Fatalf("expected unauthorized for v1 signature, got %v", err)
	}
}

func TestBackupStoreIdempotentExactRetry(t *testing.T) {
	dir := t.TempDir()
	store := NewBackupStore(dir)
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	req := backupPutReq(priv, pub, address, 200, "c2FsdA==", "Y2lwaGVydGV4dA==")
	if err := store.Put(address, req); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(address, req); err != nil {
		t.Fatalf("exact retry should be idempotent, got %v", err)
	}
}

func TestBackupStoreRejectsMalformedBase64(t *testing.T) {
	dir := t.TempDir()
	store := NewBackupStore(dir)
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	req := BackupPutRequest{
		ExportedAt: 200,
		Salt:       "c2FsdA==",
		Ciphertext: "%%%not-base64%%%",
		PublicKey:  hex.EncodeToString(pub),
		Signature:  hex.EncodeToString(signNimiqBackupChallengeV2(priv, address, 200, "c2FsdA==", "Y2lwaGVydGV4dA==")),
	}
	if err := store.Put(address, req); err != errBadRequest {
		t.Fatalf("expected bad request for malformed base64, got %v", err)
	}
}

func TestBackupHTTPHandlers(t *testing.T) {
	dir := t.TempDir()
	store := NewBackupStore(dir)
	pub, priv, _ := ed25519.GenerateKey(nil)
	address, _ := addressFromPublicKey(pub)
	exportedAt := int64(500)
	salt := "c2FsdA=="
	ct := "Y2k="
	sig := signNimiqBackupChallengeV2(priv, address, exportedAt, salt, ct)

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

func TestBackupHTTPRejectsOversizedBody(t *testing.T) {
	dir := t.TempDir()
	store := NewBackupStore(dir)
	huge := strings.Repeat("A", backupPutMaxBodyBytes+1024)
	body := `{"exported_at":1,"salt":"c2FsdA==","ciphertext":"` + huge + `","public_key":"aa","signature":"bb"}`
	putReq := httptest.NewRequest(http.MethodPut, "/api/backup/x", strings.NewReader(body))
	putReq.SetPathValue("address", "NQ07 0000 0000 0000 0000 0000 0000 0000 0000")
	putRec := httptest.NewRecorder()
	backupPutHandler(store)(putRec, putReq)
	if putRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized body, got %d", putRec.Code)
	}
}
