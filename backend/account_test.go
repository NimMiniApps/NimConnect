package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

const (
	testOwner   = "NQ23 AS8D J6RE V397 3QXH 2UEG T6V1 L11M 2579"
	testHTLC    = "NQ03 064C F89U 6LT7 6PDT R1PJ XJ99 368N 1LKH"
	testCatalog = "NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y"
)

// htlcChainRPC fakes the two RPC views the syncer needs: the catalog's tx
// list (a claim sent FROM the HTLC) and the HTLC's account/creation data.
// When pruned is true, getAccountByAddress no longer reports the htlc type,
// forcing the tx-history fallback.
func htlcChainRPC(t *testing.T, pruned bool) *NimiqRPC {
	t.Helper()
	claim := rpcTx{
		Hash: "t1", Sender: testHTLC, FromType: 2, Recipient: testCatalog,
		Data:        hexOfString(makeClaimPayload("androiddev")),
		BlockNumber: 5,
	}
	creation := rpcTx{
		Hash: "t0", Sender: testOwner, Recipient: testHTLC, ToType: 2,
		BlockNumber: 4,
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Method string `json:"method"`
			Params []any  `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		addr, _ := req.Params[0].(string)
		var result any
		switch {
		case req.Method == "getTransactionsByAddress" && compactAddress(addr) == compactAddress(testCatalog):
			result = []rpcTx{claim}
		case req.Method == "getTransactionsByAddress" && compactAddress(addr) == compactAddress(testHTLC):
			result = []rpcTx{creation, claim}
		case req.Method == "getAccountByAddress":
			if pruned {
				result = map[string]any{"address": addr, "type": "basic"}
			} else {
				result = map[string]any{"address": addr, "type": "htlc", "sender": testOwner}
			}
		default:
			result = []rpcTx{}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": result})
	}))
	t.Cleanup(srv.Close)
	return NewNimiqRPC(srv.Client(), srv.URL)
}

func hexOfString(s string) string {
	const hexDigits = "0123456789abcdef"
	out := make([]byte, 0, len(s)*2)
	for i := 0; i < len(s); i++ {
		out = append(out, hexDigits[s[i]>>4], hexDigits[s[i]&0x0f])
	}
	return string(out)
}

func testSweepAttributesToOwner(t *testing.T, pruned bool) {
	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "h.json"), nil)
	syncer := NewHandleSyncer(htlcChainRPC(t, pruned), registry, testCatalog)
	if err := syncer.Sweep(); err != nil {
		t.Fatal(err)
	}

	claim, ok := registry.Resolve("androiddev")
	if !ok || compactAddress(claim.Address) != compactAddress(testOwner) {
		t.Fatalf("claim should be attributed to the HTLC creator: %+v ok=%v", claim, ok)
	}
	if _, ok := registry.ResolveAddress(testOwner); !ok {
		t.Fatal("reverse lookup by owner wallet should hit directly")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/handles/by-address/{address}", handleByAddressHandler(registry))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/handles/by-address/"+compactAddress(testOwner), nil))
	if rec.Code != 200 {
		t.Fatalf("by-address owner: want 200, got %d: %s", rec.Code, rec.Body)
	}
	var body HandleClaim
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Handle != "androiddev" || compactAddress(body.Address) != compactAddress(testOwner) {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestSweepAttributesHTLCClaimToCreator(t *testing.T) {
	testSweepAttributesToOwner(t, false) // live HTLC: account state carries sender
}

func TestSweepAttributesPrunedHTLCViaTxHistory(t *testing.T) {
	testSweepAttributesToOwner(t, true) // pruned HTLC: creation tx fallback
}
