package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"strings"
)

func verifyBackupAuth(pathAddress string, publicKeyHex string, signatureHex string, exportedAt int64) error {
	pubBytes, err := hex.DecodeString(strings.TrimSpace(publicKeyHex))
	if err != nil {
		return fmt.Errorf("invalid public key hex")
	}
	sigBytes, err := hex.DecodeString(strings.TrimSpace(signatureHex))
	if err != nil {
		return fmt.Errorf("invalid signature hex")
	}
	if len(pubBytes) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key length")
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return fmt.Errorf("invalid signature length")
	}

	derived, err := addressFromPublicKey(pubBytes)
	if err != nil {
		return err
	}
	if compactAddress(derived) != compactAddress(pathAddress) {
		return fmt.Errorf("public key does not match address")
	}

	msg := []byte(backupChallenge(pathAddress, exportedAt))
	if !ed25519.Verify(ed25519.PublicKey(pubBytes), msg, sigBytes) {
		return fmt.Errorf("invalid signature")
	}
	return nil
}
