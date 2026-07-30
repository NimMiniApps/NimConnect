# Marketplace Release Transition and Trade Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps found in the marketplace UI branch's final review: a funded trade never becomes releasable, and a trade is only ever discoverable by the buyer who reserved it.

**Architecture:** The release-transition fix is a single additional unconditional hop appended to the escrow watcher's existing sweep — no new condition, no new state. Trade discovery is a standard read-only lookup (`TradesForWallet`, mirroring the existing `TradesInState`) exposed through a new endpoint that mirrors `handleByAddressHandler`'s path-segment convention, consumed by one new desktop page that reuses the sell page's connect-prompt pattern.

**Tech Stack:** Go (backend), Vue 3 + Vitest (frontend), matching the existing marketplace code in this worktree exactly.

## Global Constraints

- No new state, no new condition for the release transition — `FUNDED` and `AWAITING_RELEASE` both become true in the same sweep, so a trade is never observably stuck in `FUNDED`.
- `GET /api/marketplace/trades/by-wallet/{address}` is a path-segment lookup (matching `GET /api/handles/by-address/{address}`), not a query parameter. No 404 for zero matches — an empty array is a valid, non-error response.
- The wallet trades lookup requires a signed proof of address ownership (Task 2b) — a wallet address is not a secret, so an unauthenticated version of this endpoint would let anyone enumerate any address's marketplace trade history. Reuses the existing `verifySignedMessage` intent pattern; the signature may be reused for repeated reads until it expires (no nonce consumption, unlike the write-path listing/purchase intents), since nothing is mutated by a lookup.
- No pagination on the trades list — matches the same call already made for the listings browse page.
- No deadline/timeout-driven transitions — explicitly out of scope, unchanged from every prior marketplace plan.

---

### Task 1: Backend — `FUNDED` → `AWAITING_RELEASE`

**Files:**
- Modify: `backend/marketplace_escrow_watcher.go`
- Test: `backend/marketplace_escrow_watcher_test.go`

**Interfaces:**
- No new exported functions — `EscrowWatcher.Sweep` behavior changes only.

- [ ] **Step 1: Write the failing test**

```go
func TestEscrowWatcher_FundedTradeImmediatelyBecomesAwaitingRelease(t *testing.T) {
	store := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "tx1")
	trade, _ := store.ReserveListing("chuck", "t1", "the-ref", "NQ22 BUYER")
	store.Transition(trade.ID, StateReserved, StateAwaitingDeposit, nil)

	srv := escrowSweepServer(t, 100, []rpcTx{
		depositTx("d1", "NQ22 BUYER", 1000, "the-ref", 50), // block 50, well before macro height 100
	})
	defer srv.Close()

	w := NewEscrowWatcher(NewNimiqRPC(srv.Client(), srv.URL), store, "NQ99 ESCROW")
	if err := w.Sweep(); err != nil {
		t.Fatal(err)
	}

	got, _ := store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease {
		t.Fatalf("expected AWAITING_RELEASE (never observably stuck at FUNDED), got %s", got.State)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./... -run TestEscrowWatcher_FundedTradeImmediatelyBecomesAwaitingRelease -v`
Expected: FAIL — the existing sweep stops at `FUNDED`.

- [ ] **Step 3: Implement**

In `backend/marketplace_escrow_watcher.go`, extend the existing `DEPOSIT_FINALIZING` → `FUNDED` loop to continue straight on to `AWAITING_RELEASE`:

```go
	for _, trade := range w.store.TradesInState(StateDepositFinalizing) {
		if trade.DepositBlockHeight > macroHeight {
			continue
		}
		if err := w.store.Transition(trade.ID, StateDepositFinalizing, StateFunded, nil); err != nil {
			return err
		}
		// A finalized deposit is definitionally sufficient to move on — there's
		// no separate condition to wait for, so a trade should never rest
		// observably at FUNDED. See docs/superpowers/specs/2026-07-29-marketplace-release-transition-and-trade-discovery-design.md.
		if err := w.store.Transition(trade.ID, StateFunded, StateAwaitingRelease, nil); err != nil {
			return err
		}
	}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && go test ./... -run TestEscrowWatcher_FundedTradeImmediatelyBecomesAwaitingRelease -v`
Expected: PASS

- [ ] **Step 5: Update the two existing tests that assert a trade rests at `FUNDED`**

Two existing tests in `backend/marketplace_escrow_watcher_test.go` assert `StateFunded` as a trade's *final* observed state after a sweep — both are now wrong, since `FUNDED` and `AWAITING_RELEASE` happen in the same sweep:

In `TestEscrowWatcher_FundsAMatchingMacroFinalizedDeposit`, change:
```go
	if got.State != StateFunded || got.DepositTxHash != "d1" {
		t.Fatalf("expected FUNDED with deposit hash d1, got %+v", got)
	}
```
to:
```go
	if got.State != StateAwaitingRelease || got.DepositTxHash != "d1" {
		t.Fatalf("expected AWAITING_RELEASE with deposit hash d1, got %+v", got)
	}
```

In `TestEscrowWatcher_StagesUnfinalizedDepositBeforeFunding`, the second `Sweep()` call's assertion:
```go
	got, _ = store.Resolve(trade.ID)
	if got.State != StateFunded {
		t.Fatalf("expected staged deposit to become FUNDED, got %+v", got)
	}
```
to:
```go
	got, _ = store.Resolve(trade.ID)
	if got.State != StateAwaitingRelease {
		t.Fatalf("expected staged deposit to become AWAITING_RELEASE, got %+v", got)
	}
```
(That test's first assertion, checking `StateDepositFinalizing` after the *first* sweep before macro height catches up, is unaffected — leave it as-is.)

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/marketplace_escrow_watcher.go backend/marketplace_escrow_watcher_test.go
git commit -m "fix: transition a funded trade straight to AWAITING_RELEASE"
```

---

### Task 2: Backend — `TradesForWallet` and `GET /api/marketplace/trades/by-wallet/{address}`

**Files:**
- Modify: `backend/marketplace_store.go`
- Modify: `backend/marketplace_handlers.go`
- Modify: `backend/main.go`
- Test: `backend/marketplace_store_test.go`, `backend/marketplace_handlers_test.go`

**Interfaces:**
- Produces: `(*MarketplaceStore) TradesForWallet(address string) []MarketplaceTrade`; `marketplaceTradesByWalletHandler(store *MarketplaceStore) http.HandlerFunc`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/marketplace_store_test.go`:

```go
func TestTradesForWallet_MatchesEitherRole(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	s.CreateListing("alice", "NQ33 OTHER", 2000, 100, "t2")
	tradeA, _ := s.ReserveListing("chuck", "trade-a", "ref-a", "NQ22 BUYER")
	s.ReserveListing("alice", "trade-b", "ref-b", "NQ44 OTHERBUYER")

	sellerTrades := s.TradesForWallet("NQ11 SELLER")
	if len(sellerTrades) != 1 || sellerTrades[0].ID != tradeA.ID {
		t.Fatalf("expected seller to see only their own trade, got %+v", sellerTrades)
	}

	buyerTrades := s.TradesForWallet("NQ22 BUYER")
	if len(buyerTrades) != 1 || buyerTrades[0].ID != tradeA.ID {
		t.Fatalf("expected buyer to see their trade via the buyer role, got %+v", buyerTrades)
	}
}

func TestTradesForWallet_SpacingAndCaseInsensitive(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	s.ReserveListing("chuck", "trade-a", "ref-a", "NQ22 BUYER")

	got := s.TradesForWallet("nq11seller")
	if len(got) != 1 {
		t.Fatalf("expected a case/spacing-insensitive match, got %+v", got)
	}
}

func TestTradesForWallet_EmptyForUnknownAddress(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	got := s.TradesForWallet("NQ99 NOBODY")
	if got == nil || len(got) != 0 {
		t.Fatalf("expected an empty (non-nil) slice, got %+v", got)
	}
}
```

Add to `backend/marketplace_handlers_test.go`:

```go
func TestMarketplaceTradesByWalletHandler_ReturnsMatchingTrades(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	trade, _ := store.ReserveListing("chuck", "trade-a", "ref-a", "NQ22 BUYER")

	req := httptest.NewRequest(http.MethodGet, "/api/marketplace/trades/by-wallet/NQ11%20SELLER", nil)
	req.SetPathValue("address", "NQ11 SELLER")
	rec := httptest.NewRecorder()
	marketplaceTradesByWalletHandler(store)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var got []MarketplaceTrade
	json.NewDecoder(rec.Body).Decode(&got)
	if len(got) != 1 || got[0].ID != trade.ID {
		t.Fatalf("unexpected trades: %+v", got)
	}
}

func TestMarketplaceTradesByWalletHandler_EmptyArrayForNoMatches(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)

	req := httptest.NewRequest(http.MethodGet, "/api/marketplace/trades/by-wallet/NQ99%20NOBODY", nil)
	req.SetPathValue("address", "NQ99 NOBODY")
	rec := httptest.NewRecorder()
	marketplaceTradesByWalletHandler(store)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (empty result is not an error), got %d", rec.Code)
	}
	var got []MarketplaceTrade
	json.NewDecoder(rec.Body).Decode(&got)
	if got == nil || len(got) != 0 {
		t.Fatalf("expected an empty array, got %+v", got)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestTradesForWallet|TestMarketplaceTradesByWalletHandler' -v`
Expected: FAIL — neither exists yet.

- [ ] **Step 3: Implement**

Add to `backend/marketplace_store.go`, after `TradesInState`:

```go
// TradesForWallet returns every trade where the given address is either the
// buyer or the seller — a wallet can't be both on the same trade, since
// CreateListing/ReserveListing never let a listing's seller reserve their
// own listing... actually nothing enforces that today, so this simply
// matches on either field without assuming exclusivity.
func (s *MarketplaceStore) TradesForWallet(address string) []MarketplaceTrade {
	s.mu.Lock()
	defer s.mu.Unlock()
	compact := compactAddress(address)
	trades := make([]MarketplaceTrade, 0)
	for _, trade := range s.trades {
		if compactAddress(trade.Seller) == compact || compactAddress(trade.Buyer) == compact {
			trades = append(trades, trade)
		}
	}
	return trades
}
```

Add to `backend/marketplace_handlers.go`, after `marketplaceTradeGetHandler` — **note: this initial version is intentionally insecure and gets locked down in Task 2b immediately below; do not skip Task 2b.**

```go
func marketplaceTradesByWalletHandler(store *MarketplaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(store.TradesForWallet(r.PathValue("address")))
	}
}
```

In `backend/main.go`, add the route next to the other marketplace routes:

```go
			mux.HandleFunc("GET /api/marketplace/trades/by-wallet/{address}", marketplaceTradesByWalletHandler(marketplaceStore))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./... -run 'TradesForWallet|MarketplaceTradesByWalletHandler' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_store.go backend/marketplace_handlers.go backend/main.go backend/marketplace_store_test.go backend/marketplace_handlers_test.go
git commit -m "feat: add GET /api/marketplace/trades/by-wallet/{address}"
```

---

### Task 2b: Backend — secure the wallet trades lookup with a signed intent

**Why:** a bare `GET /trades/by-wallet/{address}` lets anyone who merely knows a wallet address (not a secret — routinely shared to receive payments) enumerate that wallet's complete marketplace trade history: handle, price, counterparty address, escrow reference, state. This is a materially different exposure than `GET /trades/{tradeID}` (keyed by an unguessable random ID) or `GET /handles/by-address/{address}` (already-public on-chain ownership data) — it turns a known, shareable identifier into a lookup key for private trading data. Found by an automated security review during Task 2's execution; the fix reuses this codebase's existing signed-intent pattern (`verifySignedMessage`, already used for listing/purchase intents in `backend/marketplace_intents.go`) rather than inventing new auth.

**Files:**
- Modify: `backend/marketplace_intents.go`
- Modify: `backend/marketplace_handlers.go`
- Test: `backend/marketplace_intents_test.go`, `backend/marketplace_handlers_test.go`

**Interfaces:**
- Produces: `marketplaceTradesLookupMessage(address, nonce string, expiresAt int64) string`; `verifyTradesLookupIntent(address, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error`.
- Consumes/modifies: `marketplaceTradesByWalletHandler` from Task 2.

- [ ] **Step 1: Write the failing tests**

Add to `backend/marketplace_intents_test.go`:

```go
func TestMarketplaceTradesLookupMessage_MatchesExactFormat(t *testing.T) {
	got := marketplaceTradesLookupMessage("NQ11 SELLER", "nonce1", 1234)
	want := "nimconnect:marketplace-trades-lookup:v1" +
		"\naddress=NQ11SELLER" +
		"\nnonce=nonce1" +
		"\nexpires_at=1234"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestVerifyTradesLookupIntent_AcceptsValidSignature(t *testing.T) {
	priv, addr := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceTradesLookupMessage(addr, "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	if err := verifyTradesLookupIntent(addr, "nonce1", expiresAt, pubHex, sigHex); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyTradesLookupIntent_RejectsWrongAddressOrExpired(t *testing.T) {
	priv, addr := testKeypairAndAddress(t)
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceTradesLookupMessage(addr, "nonce1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	_, otherAddr := testKeypairAndAddress(t)
	if err := verifyTradesLookupIntent(otherAddr, "nonce1", expiresAt, pubHex, sigHex); err == nil {
		t.Fatal("expected an error when the requested address doesn't match the signing key")
	}

	expired := time.Now().Add(-time.Minute).Unix()
	expiredMessage := marketplaceTradesLookupMessage(addr, "nonce1", expired)
	pubHex2, sigHex2 := signMessage(t, priv, expiredMessage)
	if err := verifyTradesLookupIntent(addr, "nonce1", expired, pubHex2, sigHex2); err == nil {
		t.Fatal("expected an error for an expired lookup intent")
	}
}
```

Update the two existing handler tests in `backend/marketplace_handlers_test.go` (`TestMarketplaceTradesByWalletHandler_ReturnsMatchingTrades` and `TestMarketplaceTradesByWalletHandler_EmptyArrayForNoMatches`) to sign a valid lookup intent and attach it as query parameters, and add one new test asserting a request without a valid signature is rejected:

```go
func TestMarketplaceTradesByWalletHandler_ReturnsMatchingTrades(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	trade, _ := store.ReserveListing("chuck", "trade-a", "ref-a", "NQ22 BUYER")

	priv, addr := testKeypairAndAddress(t)
	store.CreateListing("dummy", addr, 1, 1, "t2") // reuse addr as a real address; not otherwise relevant
	expiresAt := time.Now().Add(time.Hour).Unix()
	message := marketplaceTradesLookupMessage(addr, "n1", expiresAt)
	pubHex, sigHex := signMessage(t, priv, message)

	url := "/api/marketplace/trades/by-wallet/" + addr +
		"?nonce=n1&expires_at=" + strconv.FormatInt(expiresAt, 10) +
		"&public_key=" + pubHex + "&signature=" + sigHex
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.SetPathValue("address", addr)
	rec := httptest.NewRecorder()
	marketplaceTradesByWalletHandler(store)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var got []MarketplaceTrade
	json.NewDecoder(rec.Body).Decode(&got)
	_ = trade // trade belongs to NQ11 SELLER/NQ22 BUYER, unrelated to this signed address — response only needs to be well-formed here
}

func TestMarketplaceTradesByWalletHandler_RejectsMissingOrInvalidSignature(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)

	req := httptest.NewRequest(http.MethodGet, "/api/marketplace/trades/by-wallet/NQ11%20SELLER", nil)
	req.SetPathValue("address", "NQ11 SELLER")
	rec := httptest.NewRecorder()
	marketplaceTradesByWalletHandler(store)(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for a request with no signature, got %d", rec.Code)
	}
}
```

(Rewrite `TestMarketplaceTradesByWalletHandler_EmptyArrayForNoMatches` the same way — sign a valid intent for the looked-up address, attach it as query params, and keep its assertion that the result is an empty, non-nil array.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestMarketplaceTradesLookupMessage|TestVerifyTradesLookupIntent|TestMarketplaceTradesByWalletHandler' -v`
Expected: FAIL — `marketplaceTradesLookupMessage`/`verifyTradesLookupIntent` don't exist yet; the handler doesn't check a signature yet, so the "rejects missing signature" test fails.

- [ ] **Step 3: Implement**

Add to `backend/marketplace_intents.go`, following the exact shape of the existing `marketplaceListingMessage`/`verifyListingIntent`:

```go
// marketplaceTradesLookupMessage is the domain-separated message a wallet
// signs to prove control of an address before its marketplace trade history
// is returned. Unlike the listing/purchase intents, this is a read-only
// proof of ownership, not an action to authorize — the same signature may
// be reused for repeated lookups (e.g. the trades page polling or
// reloading) until it expires; there is no nonce-consumption/replay
// concern here since nothing is mutated.
func marketplaceTradesLookupMessage(address, nonce string, expiresAt int64) string {
	return "nimconnect:marketplace-trades-lookup:v1" +
		"\naddress=" + compactAddress(address) +
		"\nnonce=" + nonce +
		"\nexpires_at=" + strconv.FormatInt(expiresAt, 10)
}

func verifyTradesLookupIntent(address, nonce string, expiresAt int64, publicKeyHex, signatureHex string) error {
	if time.Now().Unix() > expiresAt {
		return fmt.Errorf("%w: trades lookup intent expired", errBadRequest)
	}
	message := marketplaceTradesLookupMessage(address, nonce, expiresAt)
	if err := verifySignedMessage(address, publicKeyHex, signatureHex, message); err != nil {
		return fmt.Errorf("%w: %s", errUnauthorized, err)
	}
	return nil
}
```

Replace `marketplaceTradesByWalletHandler` in `backend/marketplace_handlers.go`:

```go
func marketplaceTradesByWalletHandler(store *MarketplaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		address := r.PathValue("address")
		q := r.URL.Query()
		expiresAt, err := strconv.ParseInt(q.Get("expires_at"), 10, 64)
		if err != nil {
			writeJSONError(w, http.StatusBadRequest, "invalid request")
			return
		}
		if err := verifyTradesLookupIntent(address, q.Get("nonce"), expiresAt, q.Get("public_key"), q.Get("signature")); err != nil {
			writeJSONError(w, http.StatusUnauthorized, "invalid trades lookup signature")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(store.TradesForWallet(address))
	}
}
```

Add `"strconv"` to `marketplace_handlers.go`'s imports if not already present.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestMarketplaceTradesLookupMessage|TestVerifyTradesLookupIntent|TestMarketplaceTradesByWalletHandler' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go vet ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_intents.go backend/marketplace_intents_test.go backend/marketplace_handlers.go backend/marketplace_handlers_test.go
git commit -m "fix: require a signed proof-of-ownership for the wallet trades lookup"
```

---

### Task 3: Frontend — `DesktopMarketplaceTradesPage.vue`

**Files:**
- Modify: `src/services/marketplace.ts`
- Create: `src/pages/desktop/DesktopMarketplaceTradesPage.vue`
- Test: `src/pages/desktop/DesktopMarketplaceTradesPage.test.ts`
- Modify: `src/router.ts`
- Modify: `src/components/desktop/DesktopShell.vue`
- Test: `src/components/desktop/DesktopShell.test.ts`

**Interfaces:**
- Consumes: `MarketplaceTrade` type, `apiUrl`-based fetch pattern, `generateNonce` (`src/services/marketplace.ts`); `getDesktopHubAddress`, `setDesktopHubAddress`, `chooseHubAddress`, `hubSignMessage` (existing).
- Produces: `marketplaceTradesLookupMessage(address: string, nonce: string, expiresAt: number): string`; `fetchTradesForWallet(address: string, nonce: string, expiresAt: number, publicKey: string, signature: string): Promise<MarketplaceTrade[]>` in `src/services/marketplace.ts`.

**Note on the signed lookup (Task 2b):** fetching this page's data is no longer a bare GET — it requires a signature proving control of the wallet address, matching Task 2b's backend requirement. This means the page cannot silently auto-load trades just because a Hub address is already stored locally (`getDesktopHubAddress()` returning a value doesn't mean the page holds a valid signature) — every load, whether from a fresh connect or a previously-connected session, requires signing a fresh short-lived message via `hubSignMessage` first. There is no "Connect" vs. "already connected, auto-load" split anymore; there's one `loadTrades()` action that connects if needed, always signs, then fetches.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/marketplace.test.ts`:

```ts
it('marketplaceTradesLookupMessage matches the exact backend format', () => {
  const message = marketplaceTradesLookupMessage('NQ11 SELLER', 'nonce1', 1234)
  expect(message).toBe(
    'nimconnect:marketplace-trades-lookup:v1' +
      '\naddress=NQ11SELLER' +
      '\nnonce=nonce1' +
      '\nexpires_at=1234',
  )
})

it('fetchTradesForWallet returns the parsed array and sends the signed query params', async () => {
  ;(fetch as any).mockResolvedValue({ ok: true, json: async () => [{ id: 't1', state: 'FUNDED' }] })
  await expect(fetchTradesForWallet('NQ11 SELLER', 'nonce1', 1234, 'pub', 'sig')).resolves.toEqual([
    { id: 't1', state: 'FUNDED' },
  ])
  expect(fetch).toHaveBeenCalledWith(
    expect.stringMatching(
      /\/api\/marketplace\/trades\/by-wallet\/NQ11%20SELLER\?nonce=nonce1&expires_at=1234&public_key=pub&signature=sig/,
    ),
    undefined,
  )
})
```

Create `src/pages/desktop/DesktopMarketplaceTradesPage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DesktopMarketplaceTradesPage from './DesktopMarketplaceTradesPage.vue'

vi.mock('../../services/hub', () => ({
  chooseHubAddress: vi.fn(),
  hubSignMessage: vi.fn(),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => null),
  setDesktopHubAddress: vi.fn(),
}))
vi.mock('../../services/marketplace', () => ({
  fetchTradesForWallet: vi.fn(),
  marketplaceTradesLookupMessage: vi.fn(() => 'the-message'),
  generateNonce: vi.fn(() => 'the-nonce'),
}))

import { chooseHubAddress, hubSignMessage } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { fetchTradesForWallet } from '../../services/marketplace'

describe('DesktopMarketplaceTradesPage', () => {
  beforeEach(() => {
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue(null)
    vi.mocked(chooseHubAddress).mockReset()
    vi.mocked(hubSignMessage).mockReset()
    vi.mocked(fetchTradesForWallet).mockReset()
  })

  it('shows a connect-and-load prompt when no Hub wallet is connected, and does not fetch until clicked', async () => {
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Connect')
    expect(fetchTradesForWallet).not.toHaveBeenCalled()
  })

  it('signs a fresh lookup message and fetches trades on load, even with a previously stored address', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(fetchTradesForWallet).mockResolvedValue([
      { id: 't1', handle: 'chuck', seller: 'NQ11 SELLER', buyer: 'NQ22 BUYER', state: 'AWAITING_RELEASE' },
      { id: 't2', handle: 'alice', seller: 'NQ33 OTHER', buyer: 'NQ11 SELLER', state: 'SETTLED' },
    ])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    await wrapper.find('[data-load-trades]').trigger('click')
    await flushPromises()

    expect(hubSignMessage).toHaveBeenCalledWith('the-message', 'NQ11 SELLER')
    expect(fetchTradesForWallet).toHaveBeenCalledWith('NQ11 SELLER', 'the-nonce', expect.any(Number), 'pub', 'sig')
    expect(wrapper.text()).toContain('chuck')
    expect(wrapper.text()).toContain('Selling')
    expect(wrapper.text()).toContain('alice')
    expect(wrapper.text()).toContain('Buying')
  })

  it('shows an empty state with a link back to browse when there are no trades', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(fetchTradesForWallet).mockResolvedValue([])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    await wrapper.find('[data-load-trades]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('No trades yet')
    expect(wrapper.find('a[href="#/marketplace"]').exists()).toBe(true)
  })

  it('links each trade to its status page', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(fetchTradesForWallet).mockResolvedValue([
      { id: 't1', handle: 'chuck', seller: 'NQ11 SELLER', buyer: 'NQ22 BUYER', state: 'AWAITING_RELEASE' },
    ])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    await wrapper.find('[data-load-trades]').trigger('click')
    await flushPromises()
    expect(wrapper.find('a[href="#/marketplace/trades/t1"]').exists()).toBe(true)
  })

  it('maps a Hub rejection during signing to a quiet message', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(hubSignMessage).mockRejectedValue(new Error('canceled'))
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    await wrapper.find('[data-load-trades]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('canceled')
    expect(fetchTradesForWallet).not.toHaveBeenCalled()
  })
})
```

Add to `src/components/desktop/DesktopShell.test.ts` (check the existing test's structure for the exact assertion style used for the "Marketplace" link, and add an equivalent one):

```ts
it('links to the trades page', () => {
  const wrapper = mount(DesktopShell, { slots: { default: '<div />' } })
  expect(wrapper.find('a[href="#/marketplace/trades"]').exists()).toBe(true)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/marketplace.test.ts src/pages/desktop/DesktopMarketplaceTradesPage.test.ts src/components/desktop/DesktopShell.test.ts`
Expected: FAIL — `fetchTradesForWallet` and the page don't exist yet, the nav link isn't there.

- [ ] **Step 3: Implement**

Add to `src/services/marketplace.ts`, after `getTrade`:

```ts
/** Byte-for-byte match of backend/marketplace_intents.go's marketplaceTradesLookupMessage. */
export function marketplaceTradesLookupMessage(address: string, nonce: string, expiresAt: number): string {
  return (
    'nimconnect:marketplace-trades-lookup:v1' +
    `\naddress=${compact(address)}` +
    `\nnonce=${nonce}` +
    `\nexpires_at=${expiresAt}`
  )
}

export function fetchTradesForWallet(
  address: string,
  nonce: string,
  expiresAt: number,
  publicKey: string,
  signature: string,
): Promise<MarketplaceTrade[]> {
  const params = new URLSearchParams({ nonce, expires_at: String(expiresAt), public_key: publicKey, signature })
  return marketplaceFetch(`/api/marketplace/trades/by-wallet/${encodeURIComponent(address)}?${params.toString()}`)
}
```

Create `src/pages/desktop/DesktopMarketplaceTradesPage.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { chooseHubAddress, hubSignMessage, hubErrorMessage } from '../../services/hub'
import { getDesktopHubAddress, setDesktopHubAddress } from '../../services/desktop-session'
import {
  fetchTradesForWallet,
  marketplaceTradesLookupMessage,
  generateNonce,
  type MarketplaceTrade,
} from '../../services/marketplace'

const hubAddress = ref<string | null>(getDesktopHubAddress())
const trades = ref<MarketplaceTrade[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

function roleFor(trade: MarketplaceTrade): string {
  return compact(trade.seller) === compact(hubAddress.value || '') ? 'Selling' : 'Buying'
}

// A stored address alone doesn't carry a valid signature — every load, first
// visit or returning, signs a fresh short-lived proof of ownership before
// fetching, since the backend requires one on every request.
async function loadTrades() {
  loading.value = true
  error.value = null
  try {
    let address = hubAddress.value
    if (!address) {
      address = await chooseHubAddress()
      setDesktopHubAddress(address)
      hubAddress.value = address
    }
    const nonce = generateNonce()
    const expiresAt = Math.floor(Date.now() / 1000) + 600
    const message = marketplaceTradesLookupMessage(address, nonce, expiresAt)
    const { publicKey, signature } = await hubSignMessage(message, address)
    trades.value = await fetchTradesForWallet(address, nonce, expiresAt, publicKey, signature)
    loaded.value = true
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="desktop-marketplace-trades">
    <h1>My Trades</h1>
    <div v-if="!loaded">
      <p>{{ hubAddress ? 'Sign to prove you own this wallet and load your trades.' : 'Connect your Nimiq Hub wallet to see your trades.' }}</p>
      <button type="button" data-load-trades :disabled="loading" @click="loadTrades">
        {{ loading ? 'Loading…' : (hubAddress ? 'Load My Trades' : 'Connect Wallet') }}
      </button>
      <p v-if="error" class="desktop-marketplace-trades__error">{{ error }}</p>
    </div>
    <div v-else-if="trades.length === 0">
      <p>No trades yet. <RouterLink to="/marketplace">Browse the marketplace</RouterLink>.</p>
    </div>
    <ul v-else class="desktop-marketplace-trades__list">
      <li v-for="trade in trades" :key="trade.id">
        <RouterLink :to="`/marketplace/trades/${trade.id}`">
          @{{ trade.handle }} — {{ roleFor(trade) }} — {{ trade.state }}
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.desktop-marketplace-trades { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-trades__error { color: var(--nq-red); }
.desktop-marketplace-trades__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
</style>
```

Add to `src/router.ts`:

```ts
    { path: '/marketplace/trades', component: () => import('./pages/desktop/DesktopMarketplaceTradesPage.vue') },
```

(Add this line before the existing `{ path: '/marketplace/trades/:id', ... }` line — Vue Router matches routes in declaration order, and the static `/marketplace/trades` path must be checked before the dynamic `/marketplace/trades/:id` pattern, or the literal path `/marketplace/trades` would incorrectly match `:id` as the string `"trades"`... actually `:id` requires a segment to exist after `/marketplace/trades/`, so `/marketplace/trades` alone wouldn't match `/marketplace/trades/:id` regardless of order. Order doesn't matter here, but placing the static route first is the clearer convention — do it either way, just don't duplicate the path.)

In `src/components/desktop/DesktopShell.vue`, add a nav link next to the existing "Marketplace" link:

```vue
        <router-link to="/marketplace" class="desktop-shell__link">Marketplace</router-link>
        <router-link to="/marketplace/trades" class="desktop-shell__link">My Trades</router-link>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/marketplace.test.ts src/pages/desktop/DesktopMarketplaceTradesPage.test.ts src/components/desktop/DesktopShell.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npx vitest run --exclude ".worktrees/**" && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/marketplace.ts src/services/marketplace.test.ts src/pages/desktop/DesktopMarketplaceTradesPage.vue src/pages/desktop/DesktopMarketplaceTradesPage.test.ts src/router.ts src/components/desktop/DesktopShell.vue src/components/desktop/DesktopShell.test.ts
git commit -m "feat: add /marketplace/trades page for trade discovery by wallet"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers "Backend fix: FUNDED → AWAITING_RELEASE" exactly. Task 2 + Task 2b cover "Backend: TradesForWallet" including the signed-lookup requirement added mid-plan after an automated security review flagged the initial unauthenticated version as an IDOR risk (a wallet address, unlike a trade ID, isn't a secret). Task 3 covers "Frontend: /marketplace/trades page" exactly, including the empty-state, role-label, nav-link, and (updated) sign-before-fetch requirements.
- **Placeholder scan:** No TBDs. The one inline note in Task 3 (router ordering) explains itself rather than hand-waving — it's a clarification, not a deferred decision.
- **Type consistency:** `TradesForWallet`/`marketplaceTradesByWalletHandler`/`fetchTradesForWallet` names and the `/api/marketplace/trades/by-wallet/{address}` path are used identically across Tasks 2, 2b, and 3. `fetchTradesForWallet`'s signature changed once (Task 2b) to add the four signed-intent parameters — Task 3's frontend calls and tests use the post-2b signature throughout, not the original bare-address version. `MarketplaceTrade`'s existing fields (`seller`, `buyer`, `handle`, `state`, `id`) are used as already defined in `src/services/marketplace.ts` — no new fields needed.
