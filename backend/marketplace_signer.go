package main

// TransactionSigner sends a value transaction signed by a wallet the
// implementation controls. Production must use a dedicated, access-restricted
// node with the escrow key imported and unlocked.
type TransactionSigner interface {
	SendBasicTransactionWithData(sender, recipient string, valueLuna uint64, dataHex string) (txHash string, err error)
}

type fakeSignerCall struct {
	sender, recipient string
	valueLuna         uint64
	dataHex           string
}

// fakeSigner is a TransactionSigner test double which records sends without
// using a network connection or key material.
type fakeSigner struct {
	calls []fakeSignerCall
	next  int
}

func newFakeSigner() *fakeSigner {
	return &fakeSigner{}
}

func (f *fakeSigner) SendBasicTransactionWithData(sender, recipient string, valueLuna uint64, dataHex string) (string, error) {
	f.calls = append(f.calls, fakeSignerCall{sender, recipient, valueLuna, dataHex})
	f.next++
	return fakeTxHash(f.next), nil
}

func fakeTxHash(n int) string {
	const hex = "0123456789abcdef"
	b := make([]byte, 8)
	for i := range b {
		b[i] = hex[n%16]
		n /= 16
	}
	return string(b)
}
