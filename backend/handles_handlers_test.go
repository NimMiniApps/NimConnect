package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
)

// handlesTestMux wires the handlers exactly as main.go will.
func handlesTestMux(t *testing.T, registry *HandleRegistry, profiles *ProfileStore, syncer *HandleSyncer) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/resolve/{handle}", resolveHandler(registry))
	mux.HandleFunc("GET /api/profile/{address}", profileGetHandler(profiles))
	mux.HandleFunc("PUT /api/profile/{address}", profilePutHandler(profiles))
	mux.HandleFunc("DELETE /api/profile/{address}", profileDeleteHandler(profiles))
	mux.HandleFunc("GET /api/handles/check", handleCheckHandler(registry))
	mux.HandleFunc("GET /api/handles/by-address/{address}", handleByAddressHandler(registry))
	if syncer != nil {
		mux.HandleFunc("GET /api/pay/resolve/{handle}", paymentResolveHandler(syncer, registry))
		mux.HandleFunc("POST /api/handles/claims", claimSubmitHandler(syncer, registry))
	}
	return mux
}

func seededRegistry(t *testing.T) *HandleRegistry {
	t.Helper()
	r := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{"nimiq": true}, 0)
	r.Rebuild([]rpcTx{{
		Hash: "t1", Sender: "NQ11 OWNER", Recipient: "NQ77 REGISTRY",
		Data: hex.EncodeToString([]byte(makeClaimPayload("chuck"))), BlockNumber: 5,
	}})
	return r
}

func TestResolveHandler(t *testing.T) {
	mux := handlesTestMux(t, seededRegistry(t), NewProfileStore(withTestDB(t)), nil)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resolve/chuck", nil))
	if rec.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("ETag") == "" || rec.Header().Get("Cache-Control") == "" {
		t.Error("missing cache headers")
	}
	var claim HandleClaim
	json.Unmarshal(rec.Body.Bytes(), &claim)
	if claim.Handle != "chuck" || compactAddress(claim.Address) != "NQ11OWNER" {
		t.Fatalf("unexpected claim: %+v", claim)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resolve/ghost", nil))
	if rec.Code != 404 {
		t.Fatalf("unknown handle: want 404, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/resolve/NOPE", nil))
	if rec.Code != 400 {
		t.Fatalf("invalid handle: want 400, got %d", rec.Code)
	}
}

func TestPaymentResolveHandlerRefreshesBeforeResolving(t *testing.T) {
	var calls atomic.Int64
	srv := syncTestServer(t, &calls)
	defer srv.Close()

	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")
	mux := handlesTestMux(t, registry, NewProfileStore(withTestDB(t)), syncer)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/pay/resolve/chuck", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body)
	}
	if calls.Load() != 1 {
		t.Fatalf("want an on-demand registry sweep, got %d RPC calls", calls.Load())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("want Cache-Control no-store, got %q", got)
	}
	var claim HandleClaim
	if err := json.Unmarshal(rec.Body.Bytes(), &claim); err != nil {
		t.Fatal(err)
	}
	if claim.Handle != "chuck" || compactAddress(claim.Address) != "NQ11OWNER" {
		t.Fatalf("unexpected claim: %+v", claim)
	}
}

func TestPaymentResolveHandlerDoesNotServeStaleDataWhenRefreshFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
	}))
	defer srv.Close()

	registry := seededRegistry(t)
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")
	mux := handlesTestMux(t, registry, NewProfileStore(withTestDB(t)), syncer)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/pay/resolve/chuck", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 instead of stale claim, got %d: %s", rec.Code, rec.Body)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("want failures to be non-cacheable, got %q", got)
	}
}

func TestPaymentResolveHandlerValidatesAndReportsUnknownHandles(t *testing.T) {
	var calls atomic.Int64
	srv := syncTestServer(t, &calls)
	defer srv.Close()

	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")
	mux := handlesTestMux(t, registry, NewProfileStore(withTestDB(t)), syncer)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/pay/resolve/NOPE", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid handle: want 400, got %d", rec.Code)
	}
	if calls.Load() != 0 {
		t.Fatal("invalid handles must not trigger an RPC sweep")
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/pay/resolve/ghost", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown handle: want 404, got %d", rec.Code)
	}
}

func TestProfilePutGetDeleteOverHTTP(t *testing.T) {
	profiles := NewProfileStore(withTestDB(t))
	mux := handlesTestMux(t, seededRegistry(t), profiles, nil)

	address, pubHex, sign := testSigner(t)
	profile := validProfileJSON()
	body, _ := json.Marshal(ProfilePutRequest{
		Address: address, UpdatedAt: 1000, Profile: profile, PublicKey: pubHex,
		Signature: sign(profilePutMessage(address, 1000, sha256Hex(profile))),
	})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/profile/"+compactAddress(address), bytes.NewReader(body)))
	if rec.Code != 204 {
		t.Fatalf("put: want 204, got %d: %s", rec.Code, rec.Body)
	}

	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/profile/"+compactAddress(address), nil))
	if rec.Code != 200 {
		t.Fatalf("get: want 200, got %d", rec.Code)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	var got struct {
		Address   string          `json:"address"`
		UpdatedAt int64           `json:"updated_at"`
		Profile   json.RawMessage `json:"profile"`
	}
	json.Unmarshal(rec.Body.Bytes(), &got)
	if string(got.Profile) != profile {
		t.Fatalf("profile should be embedded raw: %s", got.Profile)
	}

	// Conditional GET -> 304.
	req := httptest.NewRequest("GET", "/api/profile/"+compactAddress(address), nil)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 304 {
		t.Fatalf("conditional get: want 304, got %d", rec.Code)
	}

	// Signed delete.
	req = httptest.NewRequest("DELETE", "/api/profile/"+compactAddress(address), nil)
	req.Header.Set("X-Profile-Updated-At", "2000")
	req.Header.Set("X-Profile-Public-Key", pubHex)
	req.Header.Set("X-Profile-Signature", sign(profileDeleteMessage(address, 2000)))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 204 {
		t.Fatalf("delete: want 204, got %d: %s", rec.Code, rec.Body)
	}
}

func TestProfilePutAddressMismatch(t *testing.T) {
	mux := handlesTestMux(t, seededRegistry(t), NewProfileStore(withTestDB(t)), nil)
	address, pubHex, sign := testSigner(t)
	profile := validProfileJSON()
	body, _ := json.Marshal(ProfilePutRequest{
		Address: address, UpdatedAt: 1000, Profile: profile, PublicKey: pubHex,
		Signature: sign(profilePutMessage(address, 1000, sha256Hex(profile))),
	})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/profile/NQ110000000000000000000000000000000X", bytes.NewReader(body)))
	if rec.Code != 400 {
		t.Fatalf("path/body address mismatch: want 400, got %d", rec.Code)
	}
}

func TestHandleCheckAdvisory(t *testing.T) {
	mux := handlesTestMux(t, seededRegistry(t), NewProfileStore(withTestDB(t)), nil)
	cases := map[string]string{
		"chuck":    `{"handle":"chuck","available":false,"reason":"taken"}`,
		"nimiq":    `{"handle":"nimiq","available":false,"reason":"reserved"}`,
		"free_one": `{"handle":"free_one","available":true}`,
	}
	for handle, want := range cases {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/handles/check?h="+handle, nil))
		if rec.Code != 200 {
			t.Fatalf("%s: want 200, got %d", handle, rec.Code)
		}
		var got, expected map[string]any
		json.Unmarshal(rec.Body.Bytes(), &got)
		json.Unmarshal([]byte(want), &expected)
		if got["available"] != expected["available"] || got["reason"] != expected["reason"] {
			t.Errorf("%s: got %v want %v", handle, got, expected)
		}
	}
}

func TestClaimSubmitHandler_BroadcastsHubRawHex(t *testing.T) {
	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	txJSON, _ := json.Marshal(rpcTx{Hash: "h1", Sender: "NQ11 OWNER", Recipient: "NQ77 REGISTRY", Data: hex.EncodeToString([]byte(makeClaimPayload("chuck")))})
	txsJSON, _ := json.Marshal([]rpcTx{{
		Hash: "h1", Sender: "NQ11 OWNER", Recipient: "NQ77 REGISTRY",
		Data:        hex.EncodeToString([]byte(makeClaimPayload("chuck"))),
		BlockNumber: 5,
	}})
	srv := fakeRPC(t, map[string]string{
		"sendRawTransaction":       `"h1"`,
		"getTransactionByHash":     string(txJSON),
		"getTransactionsByAddress": string(txsJSON),
	})
	defer srv.Close()
	syncer := NewHandleSyncer(NewNimiqRPC(srv.Client(), srv.URL), registry, "NQ77 REGISTRY")
	mux := handlesTestMux(t, registry, NewProfileStore(withTestDB(t)), syncer)

	body, _ := json.Marshal(map[string]string{"kind": "hub", "raw_hex": "deadbeef"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/handles/claims", bytes.NewReader(body)))
	if rec.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body)
	}
	var got struct {
		Status string      `json:"status"`
		Claim  HandleClaim `json:"claim"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != "indexed" || got.Claim.Handle != "chuck" {
		t.Fatalf("unexpected response: %+v", got)
	}
}

func TestClaimSubmitHandler_RejectsEmptyRequest(t *testing.T) {
	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	syncer := NewHandleSyncer(NewNimiqRPC(nil, ""), registry, "NQ77 REGISTRY")
	mux := handlesTestMux(t, registry, NewProfileStore(withTestDB(t)), syncer)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/handles/claims", bytes.NewReader([]byte(`{}`))))
	if rec.Code != 400 {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body)
	}
}

func TestHandleByAddress(t *testing.T) {
	mux := handlesTestMux(t, seededRegistry(t), NewProfileStore(withTestDB(t)), nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/handles/by-address/NQ11OWNER", nil))
	if rec.Code != 200 {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var claim HandleClaim
	json.Unmarshal(rec.Body.Bytes(), &claim)
	if claim.Handle != "chuck" {
		t.Fatalf("unexpected claim: %+v", claim)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/handles/by-address/NQ11000000000000000000000000000000AB", nil))
	if rec.Code != 404 && rec.Code != 400 {
		t.Fatalf("unknown address: want 404 (or 400 for invalid), got %d", rec.Code)
	}
}
