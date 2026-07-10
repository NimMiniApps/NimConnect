package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

const nimiqSignedMessagePrefix = "\x16Nimiq Signed Message:\n"

// nimiqSignedMessageHash matches Nimiq Pay / Keyguard signMessage (UTF-8 string messages).
func nimiqSignedMessageHash(message string) [32]byte {
	var b strings.Builder
	b.WriteString(nimiqSignedMessagePrefix)
	b.WriteString(strconv.Itoa(len(message)))
	b.WriteString(message)
	return sha256.Sum256([]byte(b.String()))
}

func decodeHexKeyMaterial(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "0x")
	return hex.DecodeString(value)
}

func verifySignedMessage(claimedAddress string, publicKeyHex string, signatureHex string, message string) error {
	pubBytes, err := decodeHexKeyMaterial(publicKeyHex)
	if err != nil {
		return fmt.Errorf("invalid public key hex")
	}
	sigBytes, err := decodeHexKeyMaterial(signatureHex)
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
	if compactAddress(derived) != compactAddress(claimedAddress) {
		return fmt.Errorf("public key does not match address")
	}
	hash := nimiqSignedMessageHash(message)
	if !ed25519.Verify(ed25519.PublicKey(pubBytes), hash[:], sigBytes) {
		return fmt.Errorf("invalid signature")
	}
	return nil
}

func verifyBackupAuth(pathAddress string, publicKeyHex string, signatureHex string, exportedAt int64) error {
	return verifySignedMessage(pathAddress, publicKeyHex, signatureHex, backupChallenge(pathAddress, exportedAt))
}
