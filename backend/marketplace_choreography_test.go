package main

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
)

func choreographyServer(t *testing.T, sendResultHash string, tx *rpcTx) *httptest.Server {
	t.Helper()
	results := map[string]string{}
	if sendResultHash != "" {
		results["sendRawTransaction"] = `"` + sendResultHash + `"`
	}
	if tx != nil {
		results["getTransactionByHash"] = marshalRPCTxJSON(t, *tx)
	}
	return fakeRPC(t, results)
}

func marshalRPCTxJSON(t *testing.T, tx rpcTx) string {
	t.Helper()
	data, err := json.Marshal(tx)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestSubmitHubTransaction_BroadcastsThenVerifies(t *testing.T) {
	tx := rpcTx{Hash: "h1", Sender: "NQ11 SELLER", Recipient: "NQ77 REGISTRY", Data: "aa"}
	srv := choreographyServer(t, "h1", &tx)
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	verifyCalled := false
	hash, err := SubmitHubTransaction(rpc, "deadbeef", func(got rpcTx) error {
		verifyCalled = true
		if got.Hash != "h1" {
			t.Fatalf("expected the broadcast tx to be looked up, got %+v", got)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if hash != "h1" || !verifyCalled {
		t.Fatalf("expected hash h1 and verify called, got hash=%q verifyCalled=%v", hash, verifyCalled)
	}
}

func TestSubmitHubTransaction_PropagatesVerifyFailure(t *testing.T) {
	tx := rpcTx{Hash: "h1", Sender: "NQ99 WRONG", Recipient: "NQ77 REGISTRY"}
	srv := choreographyServer(t, "h1", &tx)
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	wantErr := errors.New("sender mismatch")
	_, err := SubmitHubTransaction(rpc, "deadbeef", func(rpcTx) error { return wantErr })
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected verify's error to propagate, got %v", err)
	}
}

func TestSubmitPayTransaction_NeverTrustsClientClaimWithoutChainLookup(t *testing.T) {
	tx := rpcTx{Hash: "h1", Sender: "NQ11 BUYER", Recipient: "NQ77 REGISTRY"}
	srv := choreographyServer(t, "", &tx)
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	verifyCalled := false
	err := SubmitPayTransaction(rpc, "h1", func(got rpcTx) error {
		verifyCalled = true
		if got.Sender != "NQ11 BUYER" {
			t.Fatalf("expected the looked-up tx, got %+v", got)
		}
		return nil
	})
	if err != nil || !verifyCalled {
		t.Fatalf("expected success with verify called, got err=%v verifyCalled=%v", err, verifyCalled)
	}
}
