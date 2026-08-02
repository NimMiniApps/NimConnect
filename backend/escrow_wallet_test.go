package main

import (
	"testing"
	"time"
)

func TestSetupEscrowWallet_ImportsAndUnlocksFreshAccount(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"isConsensusEstablished": "true",
		"listAccounts":           "[]",
		"importRawKey":           `"NQ11 ESCROW"`,
		"isAccountUnlocked":      "false",
		"unlockAccount":          "true",
	})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	if err := SetupEscrowWallet(rpc, "deadbeef", "NQ11 ESCROW", time.Second, time.Millisecond); err != nil {
		t.Fatal(err)
	}
}

func TestSetupEscrowWallet_SkipsImportAndUnlockWhenAlreadyDone(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"isConsensusEstablished": "true",
		"listAccounts":           `["NQ11 ESCROW"]`,
		"isAccountUnlocked":      "true",
		// No importRawKey/unlockAccount entries — a call to either fails the
		// "null" default result, so this proves neither is invoked.
	})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	if err := SetupEscrowWallet(rpc, "deadbeef", "NQ11 ESCROW", time.Second, time.Millisecond); err != nil {
		t.Fatal(err)
	}
}

func TestSetupEscrowWallet_RejectsKeyMismatch(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"isConsensusEstablished": "true",
		"listAccounts":           "[]",
		"importRawKey":           `"NQ99 WRONG"`,
	})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	err := SetupEscrowWallet(rpc, "deadbeef", "NQ11 ESCROW", 20*time.Millisecond, time.Millisecond)
	if err == nil {
		t.Fatal("expected an error when the imported key doesn't match ESCROW_ADDRESS")
	}
}

func TestSetupEscrowWallet_RetriesUntilConsensusEstablished(t *testing.T) {
	calls := 0
	srv := fakeRPCFunc(t, func(method string) string {
		calls++
		switch method {
		case "isConsensusEstablished":
			if calls < 3 {
				return "false"
			}
			return "true"
		case "listAccounts":
			return `["NQ11 ESCROW"]`
		case "isAccountUnlocked":
			return "true"
		default:
			return "null"
		}
	})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	if err := SetupEscrowWallet(rpc, "deadbeef", "NQ11 ESCROW", time.Second, time.Millisecond); err != nil {
		t.Fatal(err)
	}
	if calls < 3 {
		t.Fatalf("expected retries until consensus was established, got %d calls", calls)
	}
}

func TestSetupEscrowWallet_TimesOutIfNeverReady(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"isConsensusEstablished": "false",
	})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	err := SetupEscrowWallet(rpc, "deadbeef", "NQ11 ESCROW", 15*time.Millisecond, 5*time.Millisecond)
	if err == nil {
		t.Fatal("expected a timeout error")
	}
}
