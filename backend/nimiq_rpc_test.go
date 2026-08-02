package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// fakeRPC answers JSON-RPC calls with canned results keyed by method.
func fakeRPC(t *testing.T, results map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		result, ok := results[req.Method]
		if !ok {
			result = `null`
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + result + `}`))
	}))
}

// fakeRPCFunc is fakeRPC's dynamic counterpart: result is computed per call
// (keyed by method name) instead of fixed, for tests that need behavior to
// change across retries.
func fakeRPCFunc(t *testing.T, result func(method string) string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":` + result(req.Method) + `}`))
	}))
}

func TestWithBasicAuthSendsCredentialsOnEveryCall(t *testing.T) {
	var gotUser, gotPass string
	var gotOK bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser, gotPass, gotOK = r.BasicAuth()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"h1"}`))
	}))
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL).WithBasicAuth("escrow-user", "s3cret")
	if _, err := rpc.SendRawTransaction("deadbeef"); err != nil {
		t.Fatal(err)
	}
	if !gotOK || gotUser != "escrow-user" || gotPass != "s3cret" {
		t.Fatalf("expected basic auth escrow-user:s3cret, got ok=%v user=%q pass=%q", gotOK, gotUser, gotPass)
	}
}

func TestWithoutBasicAuthSendsNoCredentials(t *testing.T) {
	var gotOK bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _, gotOK = r.BasicAuth()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"h1"}`))
	}))
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	if _, err := rpc.SendRawTransaction("deadbeef"); err != nil {
		t.Fatal(err)
	}
	if gotOK {
		t.Fatal("expected no basic auth header when WithBasicAuth was never called")
	}
}

func TestGetTransactionsByAddressUnwrapsDataEnvelope(t *testing.T) {
	// PoS RPC wraps results as {"data": ..., "metadata": ...}; field names vary.
	srv := fakeRPC(t, map[string]string{
		"getTransactionsByAddress": `{"data":[
			{"hash":"aa","from":"NQ11","to":"NQ22","recipientData":"0102","blockNumber":7,"transactionIndex":1},
			{"hash":"bb","sender":"NQ33","recipient":"NQ44","data":"0304","blockNumber":8,"transactionIndex":0}
		],"metadata":{"blockNumber":8}}`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	txs, err := rpc.GetTransactionsByAddress("NQ22", 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(txs) != 2 {
		t.Fatalf("want 2 txs, got %d", len(txs))
	}
	if txs[0].sender() != "NQ11" || txs[0].recipient() != "NQ22" || txs[0].data() != "0102" {
		t.Errorf("from/to/recipientData variant not normalized: %+v", txs[0])
	}
	if txs[1].sender() != "NQ33" || txs[1].data() != "0304" {
		t.Errorf("sender/recipient/data variant not normalized: %+v", txs[1])
	}
}

func TestGetTransactionByHash(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getTransactionByHash": `{"data":{"hash":"cc","sender":"NQ55","recipient":"NQ66","data":"","blockNumber":9,"transactionIndex":2},"metadata":null}`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	tx, err := rpc.GetTransactionByHash("cc")
	if err != nil {
		t.Fatal(err)
	}
	if tx.Hash != "cc" || tx.BlockNumber != 9 || tx.TransactionIndex != 2 {
		t.Errorf("unexpected tx: %+v", tx)
	}
}

func TestRPCErrorSurfaces(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"nope"}}`))
	}))
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	if _, err := rpc.GetTransactionByHash("cc"); err == nil {
		t.Fatal("expected error from RPC error response")
	}
}

func TestGetLastMacroBlockNumber(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getLastMacroBlock": `{"number": 4200}`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	got, err := rpc.GetLastMacroBlockNumber()
	if err != nil {
		t.Fatal(err)
	}
	if got != 4200 {
		t.Fatalf("want 4200, got %d", got)
	}
}

func TestSendBasicTransactionWithData(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"sendBasicTransactionWithData": `"deadbeef"`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	hash, err := rpc.SendBasicTransactionWithData("NQ11 ESCROW", "NQ22 SELLER", 950, "")
	if err != nil {
		t.Fatal(err)
	}
	if hash != "deadbeef" {
		t.Fatalf("want deadbeef, got %q", hash)
	}
}

func TestSendRawTransaction(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"sendRawTransaction": `"cafebabe"`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	hash, err := rpc.SendRawTransaction("deadbeef")
	if err != nil {
		t.Fatal(err)
	}
	if hash != "cafebabe" {
		t.Fatalf("want cafebabe, got %q", hash)
	}
}

func TestGetBalance(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getAccountByAddress": `{"data":{"address":"NQ77 ESCROW","balance":123456,"type":"basic"},"metadata":null}`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	got, err := rpc.GetBalance("NQ77 ESCROW")
	if err != nil {
		t.Fatal(err)
	}
	if got != 123456 {
		t.Fatalf("want 123456, got %d", got)
	}
}

func TestGetBlockNumber(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getBlockNumber": `4321`,
	})
	defer srv.Close()

	rpc := NewNimiqRPC(srv.Client(), srv.URL)
	got, err := rpc.GetBlockNumber()
	if err != nil {
		t.Fatal(err)
	}
	if got != 4321 {
		t.Fatalf("want 4321, got %d", got)
	}
}
