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
