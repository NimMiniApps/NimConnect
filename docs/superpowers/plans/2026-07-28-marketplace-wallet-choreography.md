# Marketplace Wallet Choreography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect real wallets to the marketplace engine built in the previous plan (`MarketplaceStore`, `EscrowWatcher`, `SettlementWorker` — merged in `f0041cb`): signed listing/purchase intents, an HTTP API that verifies them and drives the trade state machine, wallet choreography that differs between Hub (sign-only, server broadcasts and verifies) and Nimiq Pay (sign-and-send, server independently verifies after the fact), and an ownership watcher that recognizes a valid release/claim from canonical chain history even when it didn't arrive through this API.

**Architecture:** Marketplace intents (listing, purchase) reuse `verifySignedMessage` from `auth.go` exactly as `profiles.go` already does — a domain-separated message string signed with the wallet's key, verified against the claimed address, never an on-chain transaction signature. Release/claim submission is different: the *on-chain transaction itself* is the authorization (the seller's own key signed the `RELEASE`, the buyer's own key signed the `CLAIM`), so those endpoints verify a transaction, not a message. Both wallet paths converge on one verification primitive — `GetTransactionByHash` after either the server broadcasts (Hub) or the client already broadcast (Nimiq Pay) — reusing `parseClaimData`'s existing `IsRelease` field (from the RELEASE plan) rather than a brittle raw-byte comparison, since Hub and Pay encode the same release/claim differently on the wire. Out-of-band recognition falls out of this for free: the ownership watcher never looks at *how* a release or claim arrived, only at what `HandleRegistry.Resolve` says right now — a trade advances the instant chain state matches, regardless of which client sent it.

**Tech Stack:** Go (backend, matching existing `handles_handlers.go`/`profiles.go` conventions), TypeScript (`src/services/hub.ts`).

## Global Constraints

- Marketplace intents (listing, purchase) are message signatures verified via the existing `verifySignedMessage(claimedAddress, publicKeyHex, signatureHex, message)` — do not invent a second verification path.
- A release or claim submission is verified as an on-chain transaction (sender, recipient, and decoded `RELEASE`/`CLAIM` action must match the trade), never trusted from client-reported plain fields alone — always re-fetched via `GetTransactionByHash` after broadcast.
- The Nimiq Pay client's claim that it already sent a transaction is never trusted directly — only the chain lookup result the claimed hash resolves to.
- A canonical, protocol-valid release/claim from the expected party is recognized by the ownership watcher even if it never went through this API's submit-release/submit-claim endpoints.
- Each listing/purchase intent nonce is single-use — the store rejects a reused nonce.
- Deliberately out of scope for this plan (deferred): reservation/release/claim *deadline* enforcement (timing out a stalled trade), rate limiting, push notifications, and the custody-hardening items from the design spec's "Custody controls" section (key isolation service, per-transaction limits, reconciliation job, emergency pause). Each of those is its own follow-up plan.

---

### Task 1: Nonce tracking and signed marketplace intents

**Files:**
- Modify: `backend/marketplace_store.go`
- Create: `backend/marketplace_intents.go`
- Test: `backend/marketplace_store_test.go`, `backend/marketplace_intents_test.go`

**Interfaces:**
- Consumes: `verifySignedMessage` (`auth.go`), `compactAddress` (`address.go`), `errBadRequest`/`errUnauthorized` (`backup.go`).
- Produces: `(*MarketplaceStore) ConsumeNonce(nonce string) error`; `marketplaceListingMessage(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash, nonce string, expiresAt int64) string`; `marketplacePurchaseMessage(handle, buyer, refundAddress, nonce string, expiresAt int64) string`; `verifyListingIntent(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error`; `verifyPurchaseIntent(handle, buyer, refundAddress, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/marketplace_store_test.go`:

```go
func TestConsumeNonce_RejectsReuse(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	if err := s.ConsumeNonce("abc"); err != nil {
		t.Fatal(err)
	}
	if err := s.ConsumeNonce("abc"); err == nil {
		t.Fatal("expected an error reusing a nonce")
	}
	if err := s.ConsumeNonce("def"); err != nil {
		t.Fatal("a different nonce must still succeed")
	}
}

func TestConsumeNonce_PersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "marketplace.json")
	s := NewMarketplaceStore(path)
	s.ConsumeNonce("abc")

	reloaded := NewMarketplaceStore(path)
	if err := reloaded.ConsumeNonce("abc"); err == nil {
		t.Fatal("expected the reloaded store to still reject a previously used nonce")
	}
}
```

Create `backend/marketplace_intents_test.go`:

```go
package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"testing"
	"time"
)

func signMessage(t *testing.T, priv ed25519.PrivateKey, message string) (publicKeyHex, signatureHex string) {
	t.Helper()
	hash := nimiqSignedMessageHash(message)
	sig := ed25519.Sign(priv, hash[:])
	pub := priv.Public().(ed25519.PublicKey)
	return hex.EncodeToString(pub), hex.EncodeToString(sig)
}

func testKeypairAndAddress(t *testing.T) (ed25519.PrivateKey, string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	addr, err := addressFromPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	return priv, addr
}

func TestVerifyListingIntent_AcceptsValidSignature(t *testing.T) {
	priv, seller := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	err := verifyListingIntent("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt, pubHex, sigHex)
	if err != nil {
		t.Fatal(err)
	}
}

func TestVerifyListingIntent_RejectsWrongSellerOrTamperedFields(t *testing.T) {
	priv, seller := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	if err := verifyListingIntent("chuck", seller, 9999, 50, "tx1", "nonce1", expiresAt, pubHex, sigHex); err == nil {
		t.Fatal("expected an error for a tampered price")
	}
	_, otherSeller := testKeypairAndAddress(t)
	if err := verifyListingIntent("chuck", otherSeller, 1000, 50, "tx1", "nonce1", expiresAt, pubHex, sigHex); err == nil {
		t.Fatal("expected an error when the claimed seller doesn't match the signing key")
	}
}

func TestVerifyListingIntent_RejectsExpiredIntent(t *testing.T) {
	priv, seller := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(-time.Minute).Unix()
	message := marketplaceListingMessage("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	if err := verifyListingIntent("chuck", seller, 1000, 50, "tx1", "nonce1", expiresAt, pubHex, sigHex); err == nil {
		t.Fatal("expected an error for an expired intent")
	}
}

func TestVerifyPurchaseIntent_AcceptsValidSignature(t *testing.T) {
	priv, buyer := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplacePurchaseMessage("chuck", buyer, buyer, "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	if err := verifyPurchaseIntent("chuck", buyer, buyer, "nonce1", expiresAt, pubHex, sigHex); err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestConsumeNonce|TestVerifyListingIntent|TestVerifyPurchaseIntent' -v`
Expected: FAIL — none of these exist yet.

- [ ] **Step 3: Implement**

Add to `backend/marketplace_store.go` — extend the struct, snapshot, constructor, and add `ConsumeNonce`:

```go
type MarketplaceStore struct {
	path string
	mu   sync.Mutex

	listings map[string]MarketplaceListing
	trades   map[string]MarketplaceTrade
	byRef    map[string]string
	nonces   map[string]bool
}

type marketplaceSnapshot struct {
	Listings map[string]MarketplaceListing `json:"listings"`
	Trades   map[string]MarketplaceTrade   `json:"trades"`
	Nonces   map[string]bool               `json:"nonces"`
}
```

In `NewMarketplaceStore`, initialize `nonces: map[string]bool{}` and restore it from the snapshot when present (same pattern as `listings`/`trades`). In `persistLocked`, include `Nonces: s.nonces` in the marshaled snapshot.

```go
// ConsumeNonce records a nonce as used, failing if it was already consumed.
// Listing and purchase intents each carry one — this is what makes a
// captured, replayed signed intent inert after its first use.
func (s *MarketplaceStore) ConsumeNonce(nonce string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.nonces[nonce] {
		return fmt.Errorf("nonce %q already used", nonce)
	}
	s.nonces[nonce] = true
	if err := s.persistLocked(); err != nil {
		delete(s.nonces, nonce)
		return err
	}
	return nil
}
```

Create `backend/marketplace_intents.go`:

```go
package main

import (
	"fmt"
	"strconv"
	"time"
)

// marketplaceListingMessage is the domain-separated message a seller signs
// to authorize listing an owned handle. Verified with verifySignedMessage
// exactly like profiles.go's profilePutMessage — a wallet message
// signature, never an on-chain transaction signature.
func marketplaceListingMessage(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash, nonce string, expiresAt int64) string {
	return "nimconnect:marketplace-listing:v1" +
		"\nhandle=" + handle +
		"\nseller=" + compactAddress(seller) +
		"\nprice_luna=" + strconv.FormatUint(priceLuna, 10) +
		"\nfee_luna=" + strconv.FormatUint(feeLuna, 10) +
		"\nownership_epoch_tx_hash=" + ownershipEpochTxHash +
		"\nnonce=" + nonce +
		"\nexpires_at=" + strconv.FormatInt(expiresAt, 10)
}

// marketplacePurchaseMessage is the domain-separated message a buyer signs
// to authorize reserving a listing. It references the listing by handle,
// not by trade ID — the trade doesn't exist yet when the buyer signs this.
func marketplacePurchaseMessage(handle, buyer, refundAddress, nonce string, expiresAt int64) string {
	return "nimconnect:marketplace-purchase:v1" +
		"\nhandle=" + handle +
		"\nbuyer=" + compactAddress(buyer) +
		"\nrefund_address=" + compactAddress(refundAddress) +
		"\nnonce=" + nonce +
		"\nexpires_at=" + strconv.FormatInt(expiresAt, 10)
}

func verifyListingIntent(handle, seller string, priceLuna, feeLuna uint64, ownershipEpochTxHash, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error {
	if time.Now().Unix() > expiresAt {
		return fmt.Errorf("%w: listing intent expired", errBadRequest)
	}
	message := marketplaceListingMessage(handle, seller, priceLuna, feeLuna, ownershipEpochTxHash, nonce, expiresAt)
	if err := verifySignedMessage(seller, publicKeyHex, signatureHex, message); err != nil {
		return fmt.Errorf("%w: %s", errUnauthorized, err)
	}
	return nil
}

func verifyPurchaseIntent(handle, buyer, refundAddress, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error {
	if time.Now().Unix() > expiresAt {
		return fmt.Errorf("%w: purchase intent expired", errBadRequest)
	}
	message := marketplacePurchaseMessage(handle, buyer, refundAddress, nonce, expiresAt)
	if err := verifySignedMessage(buyer, publicKeyHex, signatureHex, message); err != nil {
		return fmt.Errorf("%w: %s", errUnauthorized, err)
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestConsumeNonce|TestVerifyListingIntent|TestVerifyPurchaseIntent' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_store.go backend/marketplace_store_test.go backend/marketplace_intents.go backend/marketplace_intents_test.go
git commit -m "feat: add nonce tracking and signed marketplace intents"
```

---

### Task 2: Broadcast/verify a raw transaction, Hub vs Nimiq Pay choreography primitives

**Files:**
- Modify: `backend/nimiq_rpc.go`
- Create: `backend/marketplace_choreography.go`
- Test: `backend/nimiq_rpc_test.go`, `backend/marketplace_choreography_test.go`

**Interfaces:**
- Consumes: `NimiqRPC.GetTransactionByHash` (existing), `parseClaimData` (existing, returns `*claimAction{Handle string; IsRelease bool}`), `MarketplaceTrade` (Task 1 of the previous plan).
- Produces: `(*NimiqRPC) SendRawTransaction(rawHex string) (string, error)`; `SubmitHubTransaction(rpc *NimiqRPC, rawHex string, verify func(rpcTx) error) (txHash string, err error)`; `SubmitPayTransaction(rpc *NimiqRPC, txHash string, verify func(rpcTx) error) error`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/nimiq_rpc_test.go`:

```go
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
```

Create `backend/marketplace_choreography_test.go`:

```go
package main

import (
	"errors"
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
```

Add these small test helpers to `backend/marketplace_choreography_test.go` as well (they only exist to keep the fixtures above readable):

```go
import (
	"encoding/json"
	"net/http/httptest"
)

func marshalRPCTxJSON(t *testing.T, tx rpcTx) string {
	t.Helper()
	data, err := json.Marshal(tx)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
```

(Merge these imports with the ones already listed above rather than declaring two separate `import` blocks in the same file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestSendRawTransaction|TestSubmitHubTransaction|TestSubmitPayTransaction' -v`
Expected: FAIL — none of these exist yet.

- [ ] **Step 3: Implement**

Add to `backend/nimiq_rpc.go`:

```go
// SendRawTransaction broadcasts an already-signed, serialized transaction —
// used for the Hub choreography path, where the wallet signs but does not
// broadcast. This is the standard Nimiq JSON-RPC method name; unlike
// SendBasicTransactionWithData it works against the ordinary public gateway,
// no dedicated signing node required.
func (c *NimiqRPC) SendRawTransaction(rawHex string) (string, error) {
	var hash string
	if err := c.call("sendRawTransaction", []any{rawHex}, &hash); err != nil {
		return "", err
	}
	return hash, nil
}
```

Create `backend/marketplace_choreography.go`:

```go
package main

// SubmitHubTransaction broadcasts a client-signed, not-yet-sent raw
// transaction (Hub's signTransaction flow), then looks the result back up
// on chain and runs `verify` against what the node actually recorded — the
// server never trusts the client's own account of what it signed.
func SubmitHubTransaction(rpc *NimiqRPC, rawHex string, verify func(rpcTx) error) (string, error) {
	hash, err := rpc.SendRawTransaction(rawHex)
	if err != nil {
		return "", err
	}
	tx, err := rpc.GetTransactionByHash(hash)
	if err != nil {
		return "", err
	}
	if err := verify(*tx); err != nil {
		return "", err
	}
	return hash, nil
}

// SubmitPayTransaction handles the Nimiq Pay flow, where the wallet signs
// and sends in one step and only reports the resulting hash. The hash is a
// lookup key, nothing more — verify runs against the chain's own record of
// that transaction, never the client's claim about it.
func SubmitPayTransaction(rpc *NimiqRPC, txHash string, verify func(rpcTx) error) error {
	tx, err := rpc.GetTransactionByHash(txHash)
	if err != nil {
		return err
	}
	return verify(*tx)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestSendRawTransaction|TestSubmitHubTransaction|TestSubmitPayTransaction' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/nimiq_rpc.go backend/nimiq_rpc_test.go backend/marketplace_choreography.go backend/marketplace_choreography_test.go
git commit -m "feat: add raw-transaction broadcast and Hub/Nimiq Pay choreography primitives"
```

---

### Task 3: Listing and reservation HTTP handlers

**Files:**
- Create: `backend/marketplace_handlers.go`
- Test: `backend/marketplace_handlers_test.go`

**Interfaces:**
- Consumes: `MarketplaceStore.CreateListing`/`ReserveListing`/`ConsumeNonce`/`Resolve` (previous plan + Task 1), `verifyListingIntent`/`verifyPurchaseIntent` (Task 1), `HandleRegistry.Resolve` (existing), `buildTradeReference` (previous plan), `writeJSONError` (existing, `inbox_handlers.go`).
- Produces: `marketplaceListingCreateHandler(store *MarketplaceStore, registry *HandleRegistry, maxFeeBps uint64) http.HandlerFunc`; `marketplaceTradeReserveHandler(store *MarketplaceStore, escrowAddress string) http.HandlerFunc`; `marketplaceTradeGetHandler(store *MarketplaceStore) http.HandlerFunc`; `newTradeID() string`.

- [ ] **Step 1: Write the failing tests**

```go
package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func newTestMarketplaceHandlerDeps(t *testing.T) (*MarketplaceStore, *HandleRegistry) {
	t.Helper()
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	return store, registry
}

func postJSON(t *testing.T, handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(data))
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func TestMarketplaceListingCreateHandler_RequiresChainOwnership(t *testing.T) {
	store, registry := newTestMarketplaceHandlerDeps(t)
	registry.Rebuild([]rpcTx{claimTx("t1", "NQ11 OWNER", "chuck", 5, 0)})

	priv, notOwner := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", notOwner, 1000, 50, "t1", "n1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	handler := marketplaceListingCreateHandler(store, registry, 1000)
	rec := postJSON(t, handler, map[string]any{
		"handle": "chuck", "seller": notOwner, "price_luna": 1000, "fee_luna": 50,
		"ownership_epoch_tx_hash": "t1", "nonce": "n1", "expires_at": expiresAt,
		"public_key": pubHex, "signature": sigHex,
	})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a signer who doesn't currently own the handle, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMarketplaceListingCreateHandler_AcceptsCurrentOwner(t *testing.T) {
	store, registry := newTestMarketplaceHandlerDeps(t)
	priv, owner := testKeypairAndAddress(t)
	registry.Rebuild([]rpcTx{claimTx("t1", owner, "chuck", 5, 0)})

	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceListingMessage("chuck", owner, 1000, 50, "t1", "n1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	handler := marketplaceListingCreateHandler(store, registry, 1000)
	rec := postJSON(t, handler, map[string]any{
		"handle": "chuck", "seller": owner, "price_luna": 1000, "fee_luna": 50,
		"ownership_epoch_tx_hash": "t1", "nonce": "n1", "expires_at": expiresAt,
		"public_key": pubHex, "signature": sigHex,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	listing, ok := store.listings["chuck"]
	if !ok || listing.Status != "active" {
		t.Fatalf("expected an active listing to be created: %+v ok=%v", listing, ok)
	}
}

func TestMarketplaceListingCreateHandler_RejectsFeeAboveMax(t *testing.T) {
	store, registry := newTestMarketplaceHandlerDeps(t)
	priv, owner := testKeypairAndAddress(t)
	registry.Rebuild([]rpcTx{claimTx("t1", owner, "chuck", 5, 0)})

	expiresAt := time.Now().Add(time.Hour).Unix()
	// fee_luna 200 on price_luna 1000 = 2000 bps, over a 1000 bps (10%) cap.
	message := marketplaceListingMessage("chuck", owner, 1000, 200, "t1", "n1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	handler := marketplaceListingCreateHandler(store, registry, 1000)
	rec := postJSON(t, handler, map[string]any{
		"handle": "chuck", "seller": owner, "price_luna": 1000, "fee_luna": 200,
		"ownership_epoch_tx_hash": "t1", "nonce": "n1", "expires_at": expiresAt,
		"public_key": pubHex, "signature": sigHex,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a fee over the configured cap, got %d", rec.Code)
	}
}

func TestMarketplaceTradeReserveHandler_CreatesAFundableTrade(t *testing.T) {
	store, registry := newTestMarketplaceHandlerDeps(t)
	priv, owner := testKeypairAndAddress(t)
	registry.Rebuild([]rpcTx{claimTx("t1", owner, "chuck", 5, 0)})
	store.CreateListing("chuck", owner, 1000, 50, "t1")

	buyerPriv, buyer := testKeypairAndAddress(t)
	_ = priv
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplacePurchaseMessage("chuck", buyer, buyer, "n2", expiresAt)
	pubHex, sigHex := signMessage(t, buyerPriv, message)

	handler := marketplaceTradeReserveHandler(store, "NQ99 ESCROW")
	rec := postJSON(t, handler, map[string]any{
		"handle": "chuck", "buyer": buyer, "refund_address": buyer,
		"nonce": "n2", "expires_at": expiresAt, "public_key": pubHex, "signature": sigHex,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		TradeID       string `json:"trade_id"`
		EscrowAddress string `json:"escrow_address"`
		Reference     string `json:"reference"`
		PriceLuna     uint64 `json:"price_luna"`
	}
	json.NewDecoder(rec.Body).Decode(&resp)
	if resp.TradeID == "" || resp.EscrowAddress != "NQ99 ESCROW" || resp.Reference == "" || resp.PriceLuna != 1000 {
		t.Fatalf("unexpected response: %+v", resp)
	}
	trade, ok := store.Resolve(resp.TradeID)
	if !ok || trade.State != StateAwaitingDeposit {
		t.Fatalf("expected the trade to already be AWAITING_DEPOSIT, got %+v ok=%v", trade, ok)
	}
}

func TestMarketplaceTradeGetHandler_ReturnsTradeStatus(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	trade, _ := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")

	req := httptest.NewRequest(http.MethodGet, "/api/marketplace/trades/"+trade.ID, nil)
	req.SetPathValue("tradeID", trade.ID)
	rec := httptest.NewRecorder()
	marketplaceTradeGetHandler(store)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var got MarketplaceTrade
	json.NewDecoder(rec.Body).Decode(&got)
	if got.ID != trade.ID || got.State != StateReserved {
		t.Fatalf("unexpected trade: %+v", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestMarketplaceListingCreateHandler|TestMarketplaceTradeReserveHandler|TestMarketplaceTradeGetHandler' -v`
Expected: FAIL — none of these handlers exist yet.

- [ ] **Step 3: Implement**

Create `backend/marketplace_handlers.go`:

```go
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
)

func newTradeID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

type marketplaceListingRequest struct {
	Handle               string `json:"handle"`
	Seller               string `json:"seller"`
	PriceLuna            uint64 `json:"price_luna"`
	FeeLuna              uint64 `json:"fee_luna"`
	OwnershipEpochTxHash string `json:"ownership_epoch_tx_hash"`
	Nonce                string `json:"nonce"`
	ExpiresAt            int64  `json:"expires_at"`
	PublicKey            string `json:"public_key"`
	Signature            string `json:"signature"`
}

// marketplaceListingCreateHandler verifies the seller's signed listing
// intent, independently confirms on chain that the seller currently owns
// the handle (never trusting the client's claim), enforces a configured
// fee cap, and creates the listing. maxFeeBps is the maximum fee allowed as
// basis points of price (e.g. 1000 = 10%) — the marketplace's actual fee
// policy is deliberately left as an operator-configured bound, not a fixed
// value baked into this handler.
func marketplaceListingCreateHandler(store *MarketplaceStore, registry *HandleRegistry, maxFeeBps uint64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req marketplaceListingRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if !isValidHandle(req.Handle) || req.PriceLuna == 0 || req.FeeLuna > req.PriceLuna {
			writeJSONError(w, http.StatusBadRequest, "invalid listing fields")
			return
		}
		if req.PriceLuna > 0 && req.FeeLuna*10000/req.PriceLuna > maxFeeBps {
			writeJSONError(w, http.StatusBadRequest, "fee exceeds the maximum allowed")
			return
		}
		if err := verifyListingIntent(req.Handle, req.Seller, req.PriceLuna, req.FeeLuna, req.OwnershipEpochTxHash, req.Nonce, req.ExpiresAt, req.PublicKey, req.Signature); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "invalid listing signature")
			return
		}
		claim, ok := registry.Resolve(req.Handle)
		if !ok || compactAddress(claim.Address) != compactAddress(req.Seller) {
			writeJSONError(w, http.StatusForbidden, "signer does not currently own this handle on chain")
			return
		}
		if claim.TxHash != req.OwnershipEpochTxHash {
			writeJSONError(w, http.StatusConflict, "ownership epoch has moved — re-sign the listing intent")
			return
		}
		if err := store.ConsumeNonce(req.Nonce); err != nil {
			writeJSONError(w, http.StatusConflict, "nonce already used")
			return
		}
		listing, err := store.CreateListing(req.Handle, req.Seller, req.PriceLuna, req.FeeLuna, req.OwnershipEpochTxHash)
		if err != nil {
			writeJSONError(w, http.StatusConflict, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(listing)
	}
}

type marketplaceReserveRequest struct {
	Handle        string `json:"handle"`
	Buyer         string `json:"buyer"`
	RefundAddress string `json:"refund_address"`
	Nonce         string `json:"nonce"`
	ExpiresAt     int64  `json:"expires_at"`
	PublicKey     string `json:"public_key"`
	Signature     string `json:"signature"`
}

// marketplaceTradeReserveHandler verifies the buyer's signed purchase
// intent, reserves the listing, and immediately advances the new trade to
// AWAITING_DEPOSIT so the response can hand the buyer everything needed to
// pay: the escrow address and their trade's unique deposit reference.
func marketplaceTradeReserveHandler(store *MarketplaceStore, escrowAddress string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req marketplaceReserveRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if !isValidHandle(req.Handle) || !isValidNimiqAddress(req.Buyer) || !isValidNimiqAddress(req.RefundAddress) {
			writeJSONError(w, http.StatusBadRequest, "invalid reservation fields")
			return
		}
		if err := verifyPurchaseIntent(req.Handle, req.Buyer, req.RefundAddress, req.Nonce, req.ExpiresAt, req.PublicKey, req.Signature); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "invalid purchase signature")
			return
		}
		if err := store.ConsumeNonce(req.Nonce); err != nil {
			writeJSONError(w, http.StatusConflict, "nonce already used")
			return
		}
		tradeID := newTradeID()
		reference := buildTradeReference()
		trade, err := store.ReserveListing(req.Handle, tradeID, reference, req.Buyer)
		if err != nil {
			writeJSONError(w, http.StatusConflict, err.Error())
			return
		}
		if err := store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil); err != nil {
			log.Printf("marketplace reserve: failed to advance to AWAITING_DEPOSIT err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "marketplace unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"trade_id":       trade.ID,
			"escrow_address": escrowAddress,
			"reference":      reference,
			"price_luna":     trade.PriceLuna,
			"fee_luna":       trade.FeeLuna,
		})
	}
}

func marketplaceTradeGetHandler(store *MarketplaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		trade, ok := store.Resolve(r.PathValue("tradeID"))
		if !ok {
			writeJSONError(w, http.StatusNotFound, "no such trade")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(trade)
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestMarketplaceListingCreateHandler|TestMarketplaceTradeReserveHandler|TestMarketplaceTradeGetHandler' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_handlers.go backend/marketplace_handlers_test.go
git commit -m "feat: add marketplace listing and reservation HTTP handlers"
```

---

### Task 4: Release and claim submission handlers

**Files:**
- Modify: `backend/marketplace_handlers.go`
- Test: `backend/marketplace_handlers_test.go`

**Interfaces:**
- Consumes: `SubmitHubTransaction`/`SubmitPayTransaction` (Task 2), `parseClaimData` (existing), `MarketplaceStore.Transition` (previous plan).
- Produces: `marketplaceTradeReleaseHandler(store *MarketplaceStore, rpc *NimiqRPC, registryAddress string) http.HandlerFunc`; `marketplaceTradeClaimHandler(store *MarketplaceStore, rpc *NimiqRPC, registryAddress string) http.HandlerFunc`.

- [ ] **Step 1: Write the failing tests**

```go
func TestMarketplaceTradeReleaseHandler_HubPath_VerifiesBeforeAdvancing(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	trade, _ := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	store.Transition(trade.ID, StateAwaitingDeposit, StateDepositFinalizing, nil)
	store.Transition(trade.ID, StateDepositFinalizing, StateFunded, nil)
	store.Transition(trade.ID, StateFunded, StateAwaitingRelease, nil)

	releaseData := hex.EncodeToString([]byte(makeReleasePayload("chuck")))
	tx := rpcTx{Hash: "r1", Sender: "NQ11 SELLER", Recipient: "NQ77 REGISTRY", Data: releaseData}
	srv := choreographyServer(t, "r1", &tx)
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	handler := marketplaceTradeReleaseHandler(store, rpc, "NQ77 REGISTRY")
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(mustJSON(t, map[string]any{
		"kind": "hub", "raw_hex": "deadbeef",
	})))
	req.SetPathValue("tradeID", trade.ID)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got, _ := store.Resolve(trade.ID)
	if got.ReleaseTxHash != "r1" || got.State != StateReleaseConfirming {
		t.Fatalf("expected RELEASE_CONFIRMING with hash r1, got %+v", got)
	}
}

func TestMarketplaceTradeReleaseHandler_RejectsWrongSender(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	trade, _ := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	store.Transition(trade.ID, StateAwaitingDeposit, StateDepositFinalizing, nil)
	store.Transition(trade.ID, StateDepositFinalizing, StateFunded, nil)
	store.Transition(trade.ID, StateFunded, StateAwaitingRelease, nil)

	releaseData := hex.EncodeToString([]byte(makeReleasePayload("chuck")))
	tx := rpcTx{Hash: "r1", Sender: "NQ99 IMPOSTOR", Recipient: "NQ77 REGISTRY", Data: releaseData}
	srv := choreographyServer(t, "r1", &tx)
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	handler := marketplaceTradeReleaseHandler(store, rpc, "NQ77 REGISTRY")
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(mustJSON(t, map[string]any{
		"kind": "hub", "raw_hex": "deadbeef",
	})))
	req.SetPathValue("tradeID", trade.ID)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a release not sent by the trade's seller, got %d", rec.Code)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease {
		t.Fatalf("trade must not advance on a rejected release, got %s", got.State)
	}
}

func TestMarketplaceTradeClaimHandler_PayPath_IndependentlyVerifies(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	trade, _ := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	store.Transition(trade.ID, StateAwaitingDeposit, StateDepositFinalizing, nil)
	store.Transition(trade.ID, StateDepositFinalizing, StateFunded, nil)
	store.Transition(trade.ID, StateFunded, StateAwaitingRelease, nil)
	store.Transition(trade.ID, StateAwaitingRelease, StateReleaseConfirming, nil)
	store.Transition(trade.ID, StateReleaseConfirming, StateAwaitingClaim, nil)

	claimData := hex.EncodeToString([]byte(makeClaimPayload("chuck")))
	tx := rpcTx{Hash: "c1", Sender: "NQ22 BUYER", Recipient: "NQ77 REGISTRY", Data: claimData}
	srv := choreographyServer(t, "", &tx) // Pay path: no sendRawTransaction call expected
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	handler := marketplaceTradeClaimHandler(store, rpc, "NQ77 REGISTRY")
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(mustJSON(t, map[string]any{
		"kind": "pay", "tx_hash": "c1",
	})))
	req.SetPathValue("tradeID", trade.ID)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	got, _ := store.Resolve(trade.ID)
	if got.ClaimTxHash != "c1" || got.State != StateClaimConfirming {
		t.Fatalf("expected CLAIM_CONFIRMING with hash c1, got %+v", got)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestMarketplaceTradeReleaseHandler|TestMarketplaceTradeClaimHandler' -v`
Expected: FAIL — these handlers don't exist yet.

- [ ] **Step 3: Implement**

Add to `backend/marketplace_handlers.go`:

```go
type marketplaceSubmitRequest struct {
	Kind   string `json:"kind"` // "hub" or "pay"
	RawHex string `json:"raw_hex,omitempty"`
	TxHash string `json:"tx_hash,omitempty"`
}

func verifyReleaseTx(tx rpcTx, trade MarketplaceTrade, registryAddress string) error {
	if compactAddress(normalizeAddress(tx.sender())) != compactAddress(trade.Seller) {
		return fmt.Errorf("sender does not match the trade's seller")
	}
	if compactAddress(tx.recipient()) != compactAddress(registryAddress) {
		return fmt.Errorf("recipient is not the handle registry")
	}
	action := parseClaimData(tx.data())
	if action == nil || !action.IsRelease || action.Handle != trade.Handle {
		return fmt.Errorf("transaction is not a release of %q", trade.Handle)
	}
	return nil
}

func verifyClaimTx(tx rpcTx, trade MarketplaceTrade, registryAddress string) error {
	if compactAddress(normalizeAddress(tx.sender())) != compactAddress(trade.Buyer) {
		return fmt.Errorf("sender does not match the trade's buyer")
	}
	if compactAddress(tx.recipient()) != compactAddress(registryAddress) {
		return fmt.Errorf("recipient is not the handle registry")
	}
	action := parseClaimData(tx.data())
	if action == nil || action.IsRelease || action.Handle != trade.Handle {
		return fmt.Errorf("transaction is not a claim of %q", trade.Handle)
	}
	return nil
}

// marketplaceTradeReleaseHandler accepts either a Hub-style not-yet-broadcast
// raw transaction or a Nimiq-Pay-style already-sent tx hash, verifies it
// against the trade, and advances AWAITING_RELEASE -> RELEASE_CONFIRMING.
// Finality and further progression is the ownership watcher's job — this
// handler only confirms the transaction exists and says what it claims to.
func marketplaceTradeReleaseHandler(store *MarketplaceStore, rpc *NimiqRPC, registryAddress string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		trade, ok := store.Resolve(r.PathValue("tradeID"))
		if !ok {
			writeJSONError(w, http.StatusNotFound, "no such trade")
			return
		}
		if trade.State != StateAwaitingRelease {
			writeJSONError(w, http.StatusConflict, "trade is not awaiting a release")
			return
		}
		var req marketplaceSubmitRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		verify := func(tx rpcTx) error { return verifyReleaseTx(tx, trade, registryAddress) }
		var txHash string
		var err error
		switch req.Kind {
		case "hub":
			txHash, err = SubmitHubTransaction(rpc, req.RawHex, verify)
		case "pay":
			err = SubmitPayTransaction(rpc, req.TxHash, verify)
			txHash = req.TxHash
		default:
			writeJSONError(w, http.StatusBadRequest, "kind must be \"hub\" or \"pay\"")
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid release transaction: "+err.Error())
			return
		}
		if err := store.Transition(trade.ID, StateAwaitingRelease, StateReleaseConfirming, func(t *MarketplaceTrade) {
			t.ReleaseTxHash = txHash
		}); err != nil {
			log.Printf("marketplace release: failed to advance trade err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "marketplace unavailable")
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

// marketplaceTradeClaimHandler is the buyer-side mirror of the release
// handler: verifies the submitted claim transaction and advances
// AWAITING_CLAIM -> CLAIM_CONFIRMING. It does not itself decide whether the
// buyer actually won the handle — that's a registry-replay question the
// ownership watcher answers from canonical chain history.
func marketplaceTradeClaimHandler(store *MarketplaceStore, rpc *NimiqRPC, registryAddress string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		trade, ok := store.Resolve(r.PathValue("tradeID"))
		if !ok {
			writeJSONError(w, http.StatusNotFound, "no such trade")
			return
		}
		if trade.State != StateAwaitingClaim {
			writeJSONError(w, http.StatusConflict, "trade is not awaiting a claim")
			return
		}
		var req marketplaceSubmitRequest
		r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		verify := func(tx rpcTx) error { return verifyClaimTx(tx, trade, registryAddress) }
		var txHash string
		var err error
		switch req.Kind {
		case "hub":
			txHash, err = SubmitHubTransaction(rpc, req.RawHex, verify)
		case "pay":
			err = SubmitPayTransaction(rpc, req.TxHash, verify)
			txHash = req.TxHash
		default:
			writeJSONError(w, http.StatusBadRequest, "kind must be \"hub\" or \"pay\"")
			return
		}
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid claim transaction: "+err.Error())
			return
		}
		if err := store.Transition(trade.ID, StateAwaitingClaim, StateClaimConfirming, func(t *MarketplaceTrade) {
			t.ClaimTxHash = txHash
		}); err != nil {
			log.Printf("marketplace claim: failed to advance trade err=%q", err)
			writeJSONError(w, http.StatusInternalServerError, "marketplace unavailable")
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}
```

Add `"fmt"` to `backend/marketplace_handlers.go`'s imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestMarketplaceTradeReleaseHandler|TestMarketplaceTradeClaimHandler' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_handlers.go backend/marketplace_handlers_test.go
git commit -m "feat: add marketplace release and claim submission handlers"
```

---

### Task 5: Ownership watcher — out-of-band recognition and settlement trigger

**Files:**
- Create: `backend/marketplace_ownership_watcher.go`
- Test: `backend/marketplace_ownership_watcher_test.go`

**Interfaces:**
- Consumes: `HandleRegistry.Resolve` (existing), `NimiqRPC.GetLastMacroBlockNumber` (previous plan), `MarketplaceStore.TradesInState`/`Transition` (previous plan + this one), `SettlementWorker.Settle`/`Refund` (previous plan).
- Produces: `NewOwnershipWatcher(rpc *NimiqRPC, store *MarketplaceStore, registry *HandleRegistry, settlement *SettlementWorker) *OwnershipWatcher`; `(*OwnershipWatcher) Sweep() error`.

- [ ] **Step 1: Write the failing tests**

```go
package main

import (
	"path/filepath"
	"testing"
)

func ownershipFixture(t *testing.T, macroHeight uint64) (*MarketplaceStore, *HandleRegistry, *fakeSigner, *OwnershipWatcher, MarketplaceTrade) {
	t.Helper()
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	registry := NewHandleRegistry(filepath.Join(t.TempDir(), "handles.json"), map[string]bool{}, 0)
	ledger, _ := OpenEscrowLedger(filepath.Join(t.TempDir(), "ledger.jsonl"))
	signer := newFakeSigner()
	settlement := NewSettlementWorker(store, ledger, signer, "NQ99 ESCROW")

	srv := escrowSweepServer(t, macroHeight, nil)
	t.Cleanup(srv.Close)
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	trade, _ := store.ReserveListing("chuck", "trade-1", "ref-1", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)
	store.Transition(trade.ID, StateAwaitingDeposit, StateDepositFinalizing, nil)
	store.Transition(trade.ID, StateDepositFinalizing, StateFunded, nil)
	store.Transition(trade.ID, StateFunded, StateAwaitingRelease, nil)

	watcher := NewOwnershipWatcher(rpc, store, registry, settlement)
	trade, _ = store.Resolve(trade.ID)
	return store, registry, signer, watcher, trade
}

func TestOwnershipWatcher_SettlesWhenBuyerIsFinalizedOwner(t *testing.T) {
	store, registry, signer, watcher, trade := ownershipFixture(t, 100)
	registry.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 SELLER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 SELLER", "chuck", 10, 0),
	})
	registry.releaseActivationHeight = 0
	registry.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 SELLER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 SELLER", "chuck", 10, 0),
		claimTx("t3", "NQ22 BUYER", "chuck", 20, 0), // block 20, well before macro height 100
	})

	if err := watcher.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateSettled {
		t.Fatalf("expected SETTLED, got %s (%+v)", got.State, got)
	}
	if len(signer.calls) != 1 || signer.calls[0].recipient != "NQ11 SELLER" {
		t.Fatalf("expected one payout call to the seller, got %+v", signer.calls)
	}
}

func TestOwnershipWatcher_WaitsForFinalityBeforeSettling(t *testing.T) {
	store, registry, signer, watcher, trade := ownershipFixture(t, 5) // macro height behind the claim's block
	registry.releaseActivationHeight = 0
	registry.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 SELLER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 SELLER", "chuck", 10, 0),
		claimTx("t3", "NQ22 BUYER", "chuck", 20, 0), // block 20 > macro height 5
	})

	watcher.Sweep()
	got, _ := store.Resolve(trade.ID)
	if got.State == StateSettled {
		t.Fatal("must not settle before the winning claim is macro-finalized")
	}
	if len(signer.calls) != 0 {
		t.Fatal("must not call the signer before finality")
	}
	_ = trade
}

func TestOwnershipWatcher_RefundsWhenSniped(t *testing.T) {
	store, registry, signer, watcher, trade := ownershipFixture(t, 100)
	registry.releaseActivationHeight = 0
	registry.Rebuild([]rpcTx{
		claimTx("t1", "NQ11 SELLER", "chuck", 5, 0),
		releaseTx("t2", "NQ11 SELLER", "chuck", 10, 0),
		claimTx("t3", "NQ99 SNIPER", "chuck", 20, 0), // a third party won it, not the trade's buyer
	})

	if err := watcher.Sweep(); err != nil {
		t.Fatal(err)
	}
	got, _ := store.Resolve(trade.ID)
	if got.State != StateRefunded {
		t.Fatalf("expected REFUNDED after a snipe, got %s", got.State)
	}
	if len(signer.calls) != 1 || signer.calls[0].recipient != "NQ22 BUYER" {
		t.Fatalf("expected one refund call to the buyer, got %+v", signer.calls)
	}
	_ = trade
}

func TestOwnershipWatcher_LeavesTradeAloneWhileSellerStillOwns(t *testing.T) {
	store, registry, signer, watcher, trade := ownershipFixture(t, 100)
	registry.releaseActivationHeight = 0
	registry.Rebuild([]rpcTx{claimTx("t1", "NQ11 SELLER", "chuck", 5, 0)}) // no release yet

	watcher.Sweep()
	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease {
		t.Fatalf("expected the trade to remain AWAITING_RELEASE, got %s", got.State)
	}
	if len(signer.calls) != 0 {
		t.Fatal("must not call the signer while no release has happened")
	}
	_ = trade
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run TestOwnershipWatcher -v`
Expected: FAIL — `OwnershipWatcher` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `backend/marketplace_ownership_watcher.go`:

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// settlementChain is the linear post-funding sequence a trade walks through.
// The ownership watcher may advance a trade through several of these states
// within a single sweep if it wasn't running when earlier events landed —
// that costs UI granularity, never correctness: every hop is still
// validated by the store's transition table.
var settlementChain = []TradeState{
	StateAwaitingRelease, StateReleaseConfirming, StateAwaitingClaim, StateClaimConfirming, StateSettlementPending,
}

func chainIndex(state TradeState) int {
	for i, s := range settlementChain {
		if s == state {
			return i
		}
	}
	return -1
}

func walkChainTo(store *MarketplaceStore, tradeID string, target TradeState, mutate func(*MarketplaceTrade)) error {
	for {
		trade, ok := store.Resolve(tradeID)
		if !ok {
			return fmt.Errorf("no trade %q", tradeID)
		}
		if trade.State == target {
			return nil
		}
		i := chainIndex(trade.State)
		if i < 0 || i+1 >= len(settlementChain) {
			return fmt.Errorf("trade %q (state %s) cannot reach %s along the settlement chain", tradeID, trade.State, target)
		}
		next := settlementChain[i+1]
		var m func(*MarketplaceTrade)
		if next == target {
			m = mutate
		}
		if err := store.Transition(tradeID, trade.State, next, m); err != nil {
			return err
		}
	}
}

// walkChainToFailure moves a trade to FAILED_AFTER_RELEASE. That state is
// only reachable from RELEASE_CONFIRMING onward, so a trade still sitting
// in AWAITING_RELEASE is walked one step first.
func walkChainToFailure(store *MarketplaceStore, tradeID string) error {
	trade, ok := store.Resolve(tradeID)
	if !ok {
		return fmt.Errorf("no trade %q", tradeID)
	}
	if trade.State == StateAwaitingRelease {
		if err := store.Transition(tradeID, StateAwaitingRelease, StateReleaseConfirming, nil); err != nil {
			return err
		}
		trade, _ = store.Resolve(tradeID)
	}
	return store.Transition(tradeID, trade.State, StateFailedAfterRelease, nil)
}

const ownershipSweepCooldown = 5 * time.Second

// OwnershipWatcher recognizes a valid release-then-claim purely from
// HandleRegistry's resolved state — it never inspects how a release or
// claim arrived, so a protocol-valid transaction sent outside this API is
// recognized exactly the same as one submitted through
// marketplaceTradeReleaseHandler/marketplaceTradeClaimHandler.
type OwnershipWatcher struct {
	rpc        *NimiqRPC
	store      *MarketplaceStore
	registry   *HandleRegistry
	settlement *SettlementWorker
	mu         sync.Mutex
	lastSweep  time.Time
}

func NewOwnershipWatcher(rpc *NimiqRPC, store *MarketplaceStore, registry *HandleRegistry, settlement *SettlementWorker) *OwnershipWatcher {
	return &OwnershipWatcher{rpc: rpc, store: store, registry: registry, settlement: settlement}
}

func (w *OwnershipWatcher) Sweep() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if time.Since(w.lastSweep) < ownershipSweepCooldown {
		return nil
	}
	macroHeight, err := w.rpc.GetLastMacroBlockNumber()
	if err != nil {
		return err
	}
	w.lastSweep = time.Now()

	for _, state := range settlementChain[:len(settlementChain)-1] {
		for _, trade := range w.store.TradesInState(state) {
			claim, ok := w.registry.Resolve(trade.Handle)
			if !ok || claim.BlockHeight > macroHeight {
				continue // no resolvable owner yet, or not yet macro-finalized
			}
			switch compactAddress(claim.Address) {
			case compactAddress(trade.Buyer):
				if err := walkChainTo(w.store, trade.ID, StateSettlementPending, func(t *MarketplaceTrade) {
					t.ClaimTxHash = claim.TxHash
				}); err != nil {
					continue
				}
				w.settlement.Settle(trade.ID)
			case compactAddress(trade.Seller):
				continue // seller still owns it — no release observed yet
			default:
				if err := walkChainToFailure(w.store, trade.ID); err != nil {
					continue
				}
				if err := w.store.Transition(trade.ID, StateFailedAfterRelease, StateRefundPending, nil); err != nil {
					continue
				}
				w.settlement.Refund(trade.ID)
			}
		}
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run TestOwnershipWatcher -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_ownership_watcher.go backend/marketplace_ownership_watcher_test.go
git commit -m "feat: add ownership watcher for out-of-band release/claim recognition"
```

---

### Task 6: Wire into `main.go` and add Hub signing helpers

**Files:**
- Modify: `backend/main.go`
- Modify: `src/services/hub.ts`
- Test: `src/services/hub.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5, plus `NewMarketplaceStore`, `NewEscrowWatcher`, `OpenEscrowLedger`, `NewSettlementWorker` (previous plan).
- Produces: wired HTTP routes and background sweep loops in `main.go`; `hubSignReleaseTransaction(handle, sender: string): Promise<{rawHex: string, hash: string}>` and `hubSignClaimTransaction(handle, sender: string): Promise<{rawHex: string, hash: string}>` in `hub.ts`.

- [ ] **Step 1: Wire the backend (no new Go tests — this step is server bootstrap, exercised by the existing handler/watcher tests plus a manual smoke run)**

In `backend/main.go`, inside the `if registryAddress != "off"` block (after the existing handle routes), add:

```go
		escrowAddress := getEnv("ESCROW_ADDRESS", "")
		if escrowAddress != "" {
			marketplaceStore := NewMarketplaceStore(getEnv("MARKETPLACE_FILE", "/data/marketplace.json"))
			ledger, err := OpenEscrowLedger(getEnv("MARKETPLACE_LEDGER_FILE", "/data/marketplace_ledger.jsonl"))
			if err != nil {
				log.Fatalf("failed to open escrow ledger: %v", err)
			}
			escrowSignerRPC := NewNimiqRPC(httpClient, getEnv("ESCROW_SIGNER_RPC_URL", getEnv("NIMIQ_RPC_URL", "https://rpc-mainnet.nimiqscan.com")))
			settlement := NewSettlementWorker(marketplaceStore, ledger, escrowSignerRPC, escrowAddress)
			escrowWatcher := NewEscrowWatcher(rpc, marketplaceStore, escrowAddress)
			ownershipWatcher := NewOwnershipWatcher(rpc, marketplaceStore, registry, settlement)
			go runSweepLoop(2*time.Minute, escrowWatcher.Sweep)
			go runSweepLoop(2*time.Minute, ownershipWatcher.Sweep)

			maxFeeBps := parseActivationHeight(getEnv("MARKETPLACE_MAX_FEE_BPS", "1000")) // default 10%, reuses the same fail-safe uint parser
			mux.HandleFunc("POST /api/marketplace/listings", marketplaceListingCreateHandler(marketplaceStore, registry, maxFeeBps))
			mux.HandleFunc("POST /api/marketplace/trades", marketplaceTradeReserveHandler(marketplaceStore, escrowAddress))
			mux.HandleFunc("GET /api/marketplace/trades/{tradeID}", marketplaceTradeGetHandler(marketplaceStore))
			mux.HandleFunc("POST /api/marketplace/trades/{tradeID}/release", marketplaceTradeReleaseHandler(marketplaceStore, rpc, registryAddress))
			mux.HandleFunc("POST /api/marketplace/trades/{tradeID}/claim", marketplaceTradeClaimHandler(marketplaceStore, rpc, registryAddress))
		}
```

Note: `parseActivationHeight` is reused here purely because it already implements "parse a `uint64` from an env var, fail closed to a safe default on empty/invalid input" — reusing it for the fee-cap default avoids writing a near-identical parser. If this reads confusingly in review, renaming it to something like `parseUintEnv(v string, failClosed uint64) uint64` is a reasonable follow-up; it isn't done here to keep this task's diff to the wiring it actually needs.

Add the small shared sweep-loop helper (`main.go` currently only has `syncer.Run`, which is specific to `HandleSyncer` — the two new watchers need the same "sweep on an interval, log failures, don't crash the process" behavior without duplicating it):

```go
// runSweepLoop calls sweep on a fixed interval until the process exits,
// logging (not panicking on) failures — the same shape as HandleSyncer.Run,
// generalized for the escrow and ownership watchers.
func runSweepLoop(interval time.Duration, sweep func() error) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := sweep(); err != nil {
			log.Printf("marketplace sweep failed err=%q", err)
		}
		<-ticker.C
	}
}
```

- [ ] **Step 2: Verify the backend still builds and every test still passes**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 3: Write the failing frontend test**

Add to `src/services/hub.test.ts` (check the existing file first for its mocking pattern for `HubApi` and follow it exactly rather than introducing a new one):

```ts
it('hubSignReleaseTransaction signs without broadcasting and returns raw hex + hash', async () => {
  const { hubSignReleaseTransaction } = await import('./hub')
  // Follow this file's existing HubApi mock setup here — signTransaction
  // should resolve { serializedTx: '...', hash: '...' } and the test should
  // assert the function's return value matches those fields directly.
})

it('hubSignClaimTransaction signs without broadcasting and returns raw hex + hash', async () => {
  const { hubSignClaimTransaction } = await import('./hub')
  // Same shape as the release test above, using buildHandleClaimPayload's
  // recipient/extraDataBytes instead of buildHandleReleasePayload's.
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd . && npx vitest run src/services/hub.test.ts`
Expected: FAIL — `hubSignReleaseTransaction`/`hubSignClaimTransaction` are not exported.

- [ ] **Step 5: Implement the Hub signing helpers**

Add to `src/services/hub.ts`:

```ts
import { buildHandleClaimPayload, buildHandleReleasePayload } from '@nimconnect/profile-client'

/**
 * Signs a transaction with Hub WITHOUT broadcasting it (unlike
 * hubCheckoutClaim, which sends immediately) — the caller posts the
 * returned raw hex to the backend, which broadcasts and independently
 * verifies it before advancing a marketplace trade.
 */
async function hubSignTransaction(opts: {
  recipient: string
  extraData: Uint8Array
  sender: string
  validityStartHeight: number
}): Promise<{ rawHex: string; hash: string }> {
  const signed = await getHub().signTransaction({
    appName: APP_NAME,
    sender: opts.sender,
    recipient: opts.recipient,
    value: 0,
    extraData: opts.extraData,
    validityStartHeight: opts.validityStartHeight,
  })
  return { rawHex: signed.serializedTx, hash: signed.hash }
}

/** Signs (but does not send) the transaction that releases an owned handle. */
export async function hubSignReleaseTransaction(
  handle: string,
  sender: string,
  validityStartHeight: number,
): Promise<{ rawHex: string; hash: string }> {
  const { recipient, extraDataBytes } = buildHandleReleasePayload(handle)
  return hubSignTransaction({ recipient, extraData: extraDataBytes, sender, validityStartHeight })
}

/** Signs (but does not send) the transaction that claims a released handle. */
export async function hubSignClaimTransaction(
  handle: string,
  sender: string,
  validityStartHeight: number,
): Promise<{ rawHex: string; hash: string }> {
  const { recipient, extraDataBytes } = buildHandleClaimPayload(handle)
  return hubSignTransaction({ recipient, extraData: extraDataBytes, sender, validityStartHeight })
}
```

`validityStartHeight` is a required parameter here (not defaulted internally) because Hub's `signTransaction` — unlike `checkout` — requires the caller to supply it explicitly; the marketplace API's release/claim submission flow should hand the current chain height to the client alongside the request to sign, so this stays fresh relative to when the seller/buyer actually acts, not when the trade was created.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/services/hub.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full frontend suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/main.go src/services/hub.ts src/services/hub.test.ts
git commit -m "feat: wire marketplace routes/watchers into main and add Hub release/claim signing"
```

---

## Self-Review Notes

- **Spec coverage:** Covers "Signed marketplace intents" (Task 1), the API surface implied by "Trade flow" steps 1-2-5-6 (Tasks 3-4), "Hub and Nimiq Pay have different signing behavior" (Task 2 + Task 4), and the out-of-band recognition rule under "Client choreography is not the registry truth" (Task 5). **Not covered**, deliberately deferred per this plan's Global Constraints: reservation/release/claim deadlines and their timeout-triggered refunds, rate limiting, notifications, and every item under the design spec's "Custody controls" section (key isolation, per-transaction limits, reconciliation, emergency pause) — each is real, separate follow-up work, not silently dropped.
- **Placeholder scan:** No TBDs. Step 3 and Step 5 of Task 6 leave two things intentionally open rather than papering over them: the frontend test's exact `HubApi` mock shape (deferred to whatever pattern `hub.test.ts` already established — copying an assumed-wrong mock shape would be worse than pointing at the real one) and a note that reusing `parseActivationHeight` for the fee-cap default is a naming smell worth a follow-up rename, not a hidden bug.
- **Type consistency:** `verifyReleaseTx`/`verifyClaimTx`'s signature (`func(rpcTx) error` closed over `trade`/`registryAddress`) matches exactly what `SubmitHubTransaction`/`SubmitPayTransaction` expect from Task 2. `marketplaceSubmitRequest{Kind, RawHex, TxHash}` is the one shape both the release and claim handlers decode. `OwnershipWatcher` calls `SettlementWorker.Settle`/`Refund` with the exact signatures defined in the previous plan (`func(tradeID string) error`), and `MarketplaceTrade`/`TradeState` field and constant names match the previous plan's Task 1 throughout.
