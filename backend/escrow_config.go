package main

import (
	"fmt"
	"strings"
)

// requireEscrowSignerAuth fails closed when escrow is enabled: both RPC
// username and password must be non-empty so a missing env value cannot
// silently leave the unlocked signer unauthenticated (SEC-003).
func requireEscrowSignerAuth(user, password string) (string, string, error) {
	user = strings.TrimSpace(user)
	password = strings.TrimSpace(password)
	if user == "" {
		return "", "", fmt.Errorf("ESCROW_ADDRESS is set but ESCROW_SIGNER_RPC_USER is empty — refusing to start escrow without RPC authentication")
	}
	if password == "" {
		return "", "", fmt.Errorf("ESCROW_ADDRESS is set but ESCROW_SIGNER_RPC_PASSWORD is empty — refusing to start escrow without RPC authentication")
	}
	return user, password, nil
}
