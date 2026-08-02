package main

import (
	"errors"
	"fmt"
	"time"
)

// SetupEscrowWallet imports and unlocks the escrow key on our own,
// locally-run Nimiq node — never a public gateway, which exposes no wallet
// RPCs and which we'd never want holding this key regardless. The node may
// still be syncing to consensus when the backend starts, so this retries
// with backoff up to timeout rather than failing on the first attempt.
func SetupEscrowWallet(rpc *NimiqRPC, walletKeyHex, expectedAddress string, timeout, retryInterval time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		if lastErr = trySetupEscrowWallet(rpc, walletKeyHex, expectedAddress); lastErr == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("escrow wallet not ready after %s: %w", timeout, lastErr)
		}
		time.Sleep(retryInterval)
	}
}

func trySetupEscrowWallet(rpc *NimiqRPC, walletKeyHex, expectedAddress string) error {
	established, err := rpc.IsConsensusEstablished()
	if err != nil {
		return fmt.Errorf("checking consensus: %w", err)
	}
	if !established {
		return errors.New("consensus not established yet")
	}

	address, err := ensureImported(rpc, walletKeyHex, expectedAddress)
	if err != nil {
		return fmt.Errorf("importing escrow key: %w", err)
	}
	if compactAddress(address) != compactAddress(expectedAddress) {
		return fmt.Errorf("imported escrow key resolves to %s, expected ESCROW_ADDRESS %s", address, expectedAddress)
	}

	unlocked, err := rpc.IsAccountUnlocked(address)
	if err != nil {
		return fmt.Errorf("checking unlock state: %w", err)
	}
	if !unlocked {
		if err := rpc.UnlockAccount(address, "", 0); err != nil {
			return fmt.Errorf("unlocking escrow account: %w", err)
		}
	}
	return nil
}

// ensureImported returns the node's existing account matching
// expectedAddress if the key was imported on a previous run (importing the
// same key twice is otherwise harmless, but this avoids relying on that),
// otherwise imports walletKeyHex fresh.
func ensureImported(rpc *NimiqRPC, walletKeyHex, expectedAddress string) (string, error) {
	if accounts, err := rpc.ListAccounts(); err == nil {
		for _, a := range accounts {
			if compactAddress(a) == compactAddress(expectedAddress) {
				return a, nil
			}
		}
	}
	return rpc.ImportRawKey(walletKeyHex, "")
}
