package main

import "testing"

func TestFakeSignerRecordsCalls(t *testing.T) {
	signer := newFakeSigner()
	hash, err := signer.SendBasicTransactionWithData("NQ11 ESCROW", "NQ22 SELLER", 950, "")
	if err != nil {
		t.Fatal(err)
	}
	if hash == "" {
		t.Fatal("expected a non-empty fake tx hash")
	}
	if len(signer.calls) != 1 || signer.calls[0].recipient != "NQ22 SELLER" || signer.calls[0].valueLuna != 950 {
		t.Fatalf("expected recorded call, got %+v", signer.calls)
	}
}
