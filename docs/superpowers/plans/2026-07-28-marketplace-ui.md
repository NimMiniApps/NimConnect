# Marketplace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the desktop/Hub marketplace UI from `docs/superpowers/specs/2026-07-28-marketplace-ui-design.md` — browse, sell, and trade-status pages driving the already-implemented marketplace backend — plus its two small backend additions.

**Architecture:** Two tiny backend endpoints (`GET /api/marketplace/listings`, `GET /api/chain/height`) follow the exact store/handler/RPC conventions already established for the rest of the marketplace backend. On the frontend, a new `src/services/marketplace.ts` holds every marketplace API call and the exact message builders the backend's signature verification expects (byte-for-byte matches of `marketplaceListingMessage`/`marketplacePurchaseMessage` in `backend/marketplace_intents.go`) — pure, framework-free, and independently testable. Three new desktop pages consume it, following `DesktopIdentityPage.vue`'s established Hub-connect/claim-lookup pattern rather than inventing a new one.

**Tech Stack:** Go (backend), Vue 3 `<script setup>` + Vitest (frontend), matching existing conventions throughout.

## Global Constraints

- Every new backend JSON field is snake_case, matching `backend/marketplace.go`'s existing struct tags exactly — the frontend types in `src/services/marketplace.ts` must use the identical field names, not renamed/camelCased versions.
- The marketplace fee is never a user-editable field — `DesktopMarketplaceSellPage` computes it from a fixed constant and shows it read-only.
- Desktop/Hub only — no Nimiq Pay code paths in this plan.
- No pagination, search-on-the-server, listing edit/cancel, or push notifications — all explicitly out of scope per the design spec.
- `src/services/marketplace.ts`'s fetch calls parse and surface the backend's `{"error": "..."}` body on failure (unlike some older helpers in `handles.ts` that discard it) — the marketplace flows need the specific reason (wrong owner, expired intent, nonce reuse, wrong sender) surfaced to the user, not a generic "request failed."

---

### Task 1: Backend — `GET /api/marketplace/listings`

**Files:**
- Modify: `backend/marketplace_store.go`
- Modify: `backend/marketplace_handlers.go`
- Modify: `backend/main.go`
- Test: `backend/marketplace_store_test.go`, `backend/marketplace_handlers_test.go`

**Interfaces:**
- Produces: `(*MarketplaceStore) ActiveListings() []MarketplaceListing`; `marketplaceListingsGetHandler(store *MarketplaceStore) http.HandlerFunc`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/marketplace_store_test.go`:

```go
func TestActiveListings_ReturnsOnlyActiveStatus(t *testing.T) {
	s := NewMarketplaceStore(filepath.Join(t.TempDir(), "marketplace.json"))
	s.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")
	s.CreateListing("alice", "NQ22 SELLER", 2000, 100, "t2")
	s.ReserveListing("alice", "trade-1", "ref-1", "NQ33 BUYER") // moves alice's listing to "reserved"

	active := s.ActiveListings()
	if len(active) != 1 || active[0].Handle != "chuck" {
		t.Fatalf("expected only chuck's active listing, got %+v", active)
	}
}
```

Add to `backend/marketplace_handlers_test.go`:

```go
func TestMarketplaceListingsGetHandler_ReturnsActiveListings(t *testing.T) {
	store, _ := newTestMarketplaceHandlerDeps(t)
	store.CreateListing("chuck", "NQ11 SELLER", 1000, 50, "t1")

	req := httptest.NewRequest(http.MethodGet, "/api/marketplace/listings", nil)
	rec := httptest.NewRecorder()
	marketplaceListingsGetHandler(store)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var listings []MarketplaceListing
	json.NewDecoder(rec.Body).Decode(&listings)
	if len(listings) != 1 || listings[0].Handle != "chuck" {
		t.Fatalf("unexpected listings: %+v", listings)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestActiveListings|TestMarketplaceListingsGetHandler' -v`
Expected: FAIL — neither exists yet.

- [ ] **Step 3: Implement**

Add to `backend/marketplace_store.go`, after `FindTradeByReference`:

```go
// ActiveListings returns every currently active listing. No pagination —
// fine at expected marketplace volume; add it if that stops being true.
func (s *MarketplaceStore) ActiveListings() []MarketplaceListing {
	s.mu.Lock()
	defer s.mu.Unlock()
	active := make([]MarketplaceListing, 0)
	for _, listing := range s.listings {
		if listing.Status == "active" {
			active = append(active, listing)
		}
	}
	return active
}
```

Add to `backend/marketplace_handlers.go`, after `marketplaceTradeGetHandler`:

```go
func marketplaceListingsGetHandler(store *MarketplaceStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(store.ActiveListings())
	}
}
```

In `backend/main.go`, inside the `if escrowAddress != "" {` block, add the route next to the other marketplace routes:

```go
		mux.HandleFunc("GET /api/marketplace/listings", marketplaceListingsGetHandler(marketplaceStore))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestActiveListings|TestMarketplaceListingsGetHandler' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace_store.go backend/marketplace_handlers.go backend/main.go backend/marketplace_store_test.go backend/marketplace_handlers_test.go
git commit -m "feat: add GET /api/marketplace/listings"
```

---

### Task 2: Backend — `GET /api/chain/height`

**Files:**
- Modify: `backend/nimiq_rpc.go`
- Modify: `backend/handlers.go`
- Modify: `backend/main.go`
- Test: `backend/nimiq_rpc_test.go`, `backend/handlers_test.go` (create if it doesn't exist)

**Interfaces:**
- Produces: `(*NimiqRPC) GetBlockNumber() (uint64, error)`; `chainHeightHandler(rpc *NimiqRPC) http.HandlerFunc`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/nimiq_rpc_test.go`:

```go
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
```

Create `backend/handlers_test.go` (check first whether it already exists — if so, add this test function to it instead):

```go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChainHeightHandler_ReturnsHeightFromRPC(t *testing.T) {
	srv := fakeRPC(t, map[string]string{
		"getBlockNumber": `999`,
	})
	defer srv.Close()
	rpc := NewNimiqRPC(srv.Client(), srv.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/chain/height", nil)
	rec := httptest.NewRecorder()
	chainHeightHandler(rpc)(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body struct {
		Height uint64 `json:"height"`
	}
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Height != 999 {
		t.Fatalf("expected height 999, got %d", body.Height)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./... -run 'TestGetBlockNumber|TestChainHeightHandler' -v`
Expected: FAIL — neither exists yet.

- [ ] **Step 3: Implement**

Add to `backend/nimiq_rpc.go`, after `GetLastMacroBlockNumber`:

```go
// GetBlockNumber returns the current chain tip height. Used to give clients
// a fresh validityStartHeight for wallet-signed transactions (e.g. Hub's
// signTransaction, which requires one explicitly).
func (c *NimiqRPC) GetBlockNumber() (uint64, error) {
	var height uint64
	if err := c.call("getBlockNumber", []any{}, &height); err != nil {
		return 0, err
	}
	return height, nil
}
```

Add to `backend/handlers.go`:

```go
func chainHeightHandler(rpc *NimiqRPC) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		height, err := rpc.GetBlockNumber()
		if err != nil {
			log.Printf("chain height unavailable error=%q", err)
			writeJSONError(w, http.StatusBadGateway, "chain height unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]uint64{"height": height})
	}
}
```

In `backend/main.go`, inside the `if registryAddress != "off" {` block (this only needs `rpc`, which already exists there — it doesn't need the marketplace's `escrowAddress` block), add near the other handle routes:

```go
		mux.HandleFunc("GET /api/chain/height", chainHeightHandler(rpc))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./... -run 'TestGetBlockNumber|TestChainHeightHandler' -v`
Expected: PASS

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && go build ./... && go test ./... -race`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/nimiq_rpc.go backend/handlers.go backend/main.go backend/nimiq_rpc_test.go backend/handlers_test.go
git commit -m "feat: add GET /api/chain/height"
```

---

### Task 3: Frontend — `src/services/marketplace.ts`

**Files:**
- Create: `src/services/marketplace.ts`
- Test: `src/services/marketplace.test.ts`

**Interfaces:**
- Consumes: `apiUrl` (`src/services/api.ts`), `compactAddress`-equivalent — this file normalizes addresses the same way the backend's `compactAddress` does (uppercase, spaces stripped) since the signed message must match byte-for-byte; a small local `compact()` helper does this (mirrors the one already private to `handles.ts`, not exported from there, so it's redefined locally rather than reaching into another module's internals).
- Produces: `MarketplaceListing`, `MarketplaceTrade` types; `marketplaceListingMessage(...)`, `marketplacePurchaseMessage(...)`; `generateNonce()`; `fetchListings()`, `createListing(...)`, `reserveTrade(...)`, `getTrade(...)`, `submitRelease(...)`, `submitClaim(...)`, `fetchChainHeight()`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  marketplaceListingMessage,
  marketplacePurchaseMessage,
  generateNonce,
  fetchListings,
  createListing,
  reserveTrade,
  getTrade,
  submitRelease,
  submitClaim,
  fetchChainHeight,
} from './marketplace'

describe('marketplaceListingMessage', () => {
  it('matches the exact backend format', () => {
    const message = marketplaceListingMessage('chuck', 'NQ11 SELLER', 1000, 50, 't1', 'nonce1', 1234)
    expect(message).toBe(
      'nimconnect:marketplace-listing:v1' +
        '\nhandle=chuck' +
        '\nseller=NQ11SELLER' +
        '\nprice_luna=1000' +
        '\nfee_luna=50' +
        '\nownership_epoch_tx_hash=t1' +
        '\nnonce=nonce1' +
        '\nexpires_at=1234',
    )
  })
})

describe('marketplacePurchaseMessage', () => {
  it('matches the exact backend format', () => {
    const message = marketplacePurchaseMessage('chuck', 'NQ22 BUYER', 'NQ22 BUYER', 'nonce2', 5678)
    expect(message).toBe(
      'nimconnect:marketplace-purchase:v1' +
        '\nhandle=chuck' +
        '\nbuyer=NQ22BUYER' +
        '\nrefund_address=NQ22BUYER' +
        '\nnonce=nonce2' +
        '\nexpires_at=5678',
    )
  })
})

describe('generateNonce', () => {
  it('produces unique, non-empty values', () => {
    const a = generateNonce()
    const b = generateNonce()
    expect(a).not.toBe('')
    expect(a).not.toBe(b)
  })
})

describe('marketplace API calls', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchListings returns the parsed array', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => [{ handle: 'chuck' }] })
    await expect(fetchListings()).resolves.toEqual([{ handle: 'chuck' }])
  })

  it('createListing posts the request and returns the created listing', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ handle: 'chuck', status: 'active' }) })
    const result = await createListing({
      handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 1000, fee_luna: 50,
      ownership_epoch_tx_hash: 't1', nonce: 'n1', expires_at: 123,
      public_key: 'pub', signature: 'sig',
    })
    expect(result).toEqual({ handle: 'chuck', status: 'active' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/listings'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces the backend error message on failure, not a generic one', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: 'signer does not currently own this handle on chain' }) })
    await expect(
      createListing({
        handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 1000, fee_luna: 50,
        ownership_epoch_tx_hash: 't1', nonce: 'n1', expires_at: 123,
        public_key: 'pub', signature: 'sig',
      }),
    ).rejects.toThrow('signer does not currently own this handle on chain')
  })

  it('reserveTrade returns the trade payment details', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ trade_id: 't1', escrow_address: 'NQ99 ESCROW', reference: 'ref1', price_luna: 1000, fee_luna: 50 },
      ),
    })
    await expect(
      reserveTrade({ handle: 'chuck', buyer: 'NQ22 BUYER', refund_address: 'NQ22 BUYER', nonce: 'n2', expires_at: 456, public_key: 'pub', signature: 'sig' }),
    ).resolves.toEqual({ trade_id: 't1', escrow_address: 'NQ99 ESCROW', reference: 'ref1', price_luna: 1000, fee_luna: 50 })
  })

  it('getTrade fetches a single trade by id', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: 't1', state: 'FUNDED' }) })
    await expect(getTrade('t1')).resolves.toEqual({ id: 't1', state: 'FUNDED' })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/marketplace/trades/t1'), undefined)
  })

  it('submitRelease posts the hub or pay submission', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })
    await submitRelease('t1', { kind: 'hub', raw_hex: 'deadbeef' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/trades/t1/release'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ kind: 'hub', raw_hex: 'deadbeef' }) }),
    )
  })

  it('submitClaim posts the hub or pay submission', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })
    await submitClaim('t1', { kind: 'pay', tx_hash: 'c1' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/trades/t1/claim'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ kind: 'pay', tx_hash: 'c1' }) }),
    )
  })

  it('fetchChainHeight returns the numeric height', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ height: 4321 }) })
    await expect(fetchChainHeight()).resolves.toBe(4321)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/marketplace.test.ts`
Expected: FAIL — `src/services/marketplace.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// src/services/marketplace.ts
import { apiUrl } from './api'

/** Mirrors backend's compactAddress: uppercase, spaces stripped. */
function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

export interface MarketplaceListing {
  handle: string
  seller: string
  price_luna: number
  fee_luna: number
  status: string
  ownership_epoch_tx_hash: string
  created_at: number
}

export interface MarketplaceTrade {
  id: string
  reference: string
  handle: string
  buyer: string
  seller: string
  price_luna: number
  fee_luna: number
  state: string
  version: number
  deposit_tx_hash?: string
  deposit_block_height?: number
  release_tx_hash?: string
  claim_tx_hash?: string
  payout_tx_hash?: string
  refund_tx_hash?: string
  created_at: number
  updated_at: number
}

/** Byte-for-byte match of backend/marketplace_intents.go's marketplaceListingMessage. */
export function marketplaceListingMessage(
  handle: string,
  seller: string,
  priceLuna: number,
  feeLuna: number,
  ownershipEpochTxHash: string,
  nonce: string,
  expiresAt: number,
): string {
  return (
    'nimconnect:marketplace-listing:v1' +
    `\nhandle=${handle}` +
    `\nseller=${compact(seller)}` +
    `\nprice_luna=${priceLuna}` +
    `\nfee_luna=${feeLuna}` +
    `\nownership_epoch_tx_hash=${ownershipEpochTxHash}` +
    `\nnonce=${nonce}` +
    `\nexpires_at=${expiresAt}`
  )
}

/** Byte-for-byte match of backend/marketplace_intents.go's marketplacePurchaseMessage. */
export function marketplacePurchaseMessage(
  handle: string,
  buyer: string,
  refundAddress: string,
  nonce: string,
  expiresAt: number,
): string {
  return (
    'nimconnect:marketplace-purchase:v1' +
    `\nhandle=${handle}` +
    `\nbuyer=${compact(buyer)}` +
    `\nrefund_address=${compact(refundAddress)}` +
    `\nnonce=${nonce}` +
    `\nexpires_at=${expiresAt}`
  )
}

/** Random hex nonce — the backend only checks uniqueness, not format. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function marketplaceFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `request failed (${res.status})`)
  }
  return body as T
}

export function fetchListings(): Promise<MarketplaceListing[]> {
  return marketplaceFetch('/api/marketplace/listings')
}

export interface CreateListingRequest {
  handle: string
  seller: string
  price_luna: number
  fee_luna: number
  ownership_epoch_tx_hash: string
  nonce: string
  expires_at: number
  public_key: string
  signature: string
}

export function createListing(req: CreateListingRequest): Promise<MarketplaceListing> {
  return marketplaceFetch('/api/marketplace/listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export interface ReserveTradeRequest {
  handle: string
  buyer: string
  refund_address: string
  nonce: string
  expires_at: number
  public_key: string
  signature: string
}

export interface ReserveTradeResponse {
  trade_id: string
  escrow_address: string
  reference: string
  price_luna: number
  fee_luna: number
}

export function reserveTrade(req: ReserveTradeRequest): Promise<ReserveTradeResponse> {
  return marketplaceFetch('/api/marketplace/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export function getTrade(tradeId: string): Promise<MarketplaceTrade> {
  return marketplaceFetch(`/api/marketplace/trades/${tradeId}`)
}

export type SubmitTransactionRequest =
  | { kind: 'hub'; raw_hex: string }
  | { kind: 'pay'; tx_hash: string }

export function submitRelease(tradeId: string, req: SubmitTransactionRequest): Promise<void> {
  return marketplaceFetch(`/api/marketplace/trades/${tradeId}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export function submitClaim(tradeId: string, req: SubmitTransactionRequest): Promise<void> {
  return marketplaceFetch(`/api/marketplace/trades/${tradeId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export async function fetchChainHeight(): Promise<number> {
  const { height } = await marketplaceFetch<{ height: number }>('/api/chain/height')
  return height
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/marketplace.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/marketplace.ts src/services/marketplace.test.ts
git commit -m "feat: add marketplace API client and signed-intent message builders"
```

---

### Task 4: Frontend — `hub.ts` additions and shared error mapping

**Files:**
- Modify: `src/services/hub.ts`
- Modify: `src/pages/desktop/DesktopIdentityPage.vue`
- Test: `src/services/hub.test.ts`

**Interfaces:**
- Produces: `hubErrorMessage(e: unknown): string` (moved here, exported); `hubCheckoutPayment(opts: { recipient: string; valueLuna: number; data: string; sender?: string }): Promise<{ txHash: string }>`.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/hub.test.ts`:

```ts
it('hubCheckoutPayment sends text data and the given value', async () => {
  checkout.mockResolvedValue({ hash: 'pay-hash' })
  const { hubCheckoutPayment } = await import('./hub')
  await expect(
    hubCheckoutPayment({ recipient: 'NQ99 ESCROW', valueLuna: 1000, data: 'NME1:abc123', sender: 'NQ01 TEST' }),
  ).resolves.toEqual({ txHash: 'pay-hash' })
  expect(checkout).toHaveBeenCalledWith(
    expect.objectContaining({
      appName: 'NimConnect',
      recipient: 'NQ99 ESCROW',
      value: 1000,
      extraData: 'NME1:abc123',
      sender: 'NQ01 TEST',
    }),
  )
})

it('hubErrorMessage maps a cancellation to a quiet message and anything else to the install hint', async () => {
  const { hubErrorMessage } = await import('./hub')
  expect(hubErrorMessage(new Error('User canceled the request'))).toBe('Canceled — no changes were made.')
  expect(hubErrorMessage(new Error('popup blocked'))).toBe('Install or open a Nimiq Hub compatible wallet')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/hub.test.ts`
Expected: FAIL — `hubCheckoutPayment` and the exported `hubErrorMessage` don't exist yet.

- [ ] **Step 3: Implement**

Add to `src/services/hub.ts`:

```ts
/** Best-effort mapping of a Hub popup rejection/cancellation to a quieter message. */
export function hubErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  if (/cancel/i.test(message)) return 'Canceled — no changes were made.'
  return 'Install or open a Nimiq Hub compatible wallet'
}

/**
 * Generic value+text-data checkout — distinct from hubCheckoutClaim, which
 * is always value-0 with binary extraData. Used for the marketplace escrow
 * deposit, where the data is a plain-text "NME1:<reference>" string.
 */
export async function hubCheckoutPayment(opts: {
  recipient: string
  valueLuna: number
  data: string
  sender?: string
}): Promise<{ txHash: string }> {
  const signed = await getHub().checkout({
    appName: APP_NAME,
    recipient: opts.recipient,
    value: opts.valueLuna,
    extraData: opts.data,
    ...(opts.sender ? { sender: opts.sender } : {}),
  })
  return { txHash: signed.hash }
}
```

In `src/pages/desktop/DesktopIdentityPage.vue`, remove the page-local `hubErrorMessage` function and its doc comment, and import the shared one instead:

```ts
import { chooseHubAddress, hubSignMessage, hubErrorMessage } from '../../services/hub'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/hub.test.ts src/pages/desktop/DesktopIdentityPage.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — this also confirms removing the local `hubErrorMessage` didn't leave a dangling reference anywhere else in that file.

- [ ] **Step 6: Commit**

```bash
git add src/services/hub.ts src/services/hub.test.ts src/pages/desktop/DesktopIdentityPage.vue
git commit -m "feat: add hubCheckoutPayment and share hubErrorMessage across desktop pages"
```

---

### Task 5: `DesktopMarketplacePage.vue` — browse

**Files:**
- Create: `src/pages/desktop/DesktopMarketplacePage.vue`
- Test: `src/pages/desktop/DesktopMarketplacePage.test.ts`
- Modify: `src/router.ts`

**Interfaces:**
- Consumes: `fetchListings` (Task 3), `getDesktopHubAddress` (`src/services/desktop-session.ts`), `compactAddress`-equivalent comparison (reuse the pattern, not a shared export — comparing two already-known-format addresses with a simple space-stripped-uppercase compare is enough here).

- [ ] **Step 1: Write the failing test**

```ts
// src/pages/desktop/DesktopMarketplacePage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DesktopMarketplacePage from './DesktopMarketplacePage.vue'

vi.mock('../../services/marketplace', () => ({
  fetchListings: vi.fn(),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => null),
}))

import { fetchListings } from '../../services/marketplace'
import { getDesktopHubAddress } from '../../services/desktop-session'

describe('DesktopMarketplacePage', () => {
  beforeEach(() => {
    vi.mocked(fetchListings).mockReset()
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue(null)
  })

  it('renders fetched listings', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = mount(DesktopMarketplacePage)
    await flushPromises()
    expect(wrapper.text()).toContain('chuck')
    expect(wrapper.text()).toContain('1 NIM') // 100000 luna -> 1 NIM
  })

  it('filters the visible listings by handle prefix without re-fetching', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
      { handle: 'alice', seller: 'NQ22', price_luna: 200000, fee_luna: 10000, status: 'active', ownership_epoch_tx_hash: 't2', created_at: 2 },
    ])
    const wrapper = mount(DesktopMarketplacePage)
    await flushPromises()
    await wrapper.find('input[type="search"]').setValue('ch')
    expect(wrapper.text()).toContain('chuck')
    expect(wrapper.text()).not.toContain('alice')
    expect(fetchListings).toHaveBeenCalledTimes(1)
  })

  it('hides the Buy action for the connected user\'s own listing', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = mount(DesktopMarketplacePage)
    await flushPromises()
    expect(wrapper.find('[data-buy-handle="chuck"]').exists()).toBe(false)
  })

  it('shows a retry affordance when the fetch fails', async () => {
    vi.mocked(fetchListings).mockRejectedValue(new Error('marketplace unavailable'))
    const wrapper = mount(DesktopMarketplacePage)
    await flushPromises()
    expect(wrapper.text()).toContain('marketplace unavailable')
    expect(wrapper.find('[data-retry]').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/desktop/DesktopMarketplacePage.test.ts`
Expected: FAIL — the component doesn't exist yet.

- [ ] **Step 3: Implement**

```vue
<!-- src/pages/desktop/DesktopMarketplacePage.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchListings, type MarketplaceListing } from '../../services/marketplace'
import { getDesktopHubAddress } from '../../services/desktop-session'

const brandIconUrl = `${import.meta.env.BASE_URL}brand/nimconnect-icon-192x192.png`

const listings = ref<MarketplaceListing[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const filter = ref('')

function lunaToNim(luna: number): string {
  return (luna / 100000).toString()
}

function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

const ownAddress = computed(() => getDesktopHubAddress())

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return listings.value
  return listings.value.filter((l) => l.handle.startsWith(q))
})

async function load() {
  loading.value = true
  error.value = null
  try {
    listings.value = await fetchListings()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="desktop-marketplace">
    <header class="desktop-marketplace__header">
      <img :src="brandIconUrl" alt="" width="32" height="32" />
      <h1>Handle Marketplace</h1>
      <RouterLink to="/marketplace/sell" class="desktop-marketplace__sell-link">Sell your @handle</RouterLink>
    </header>

    <input
      type="search"
      v-model="filter"
      placeholder="Filter by handle…"
      class="desktop-marketplace__filter"
    />

    <p v-if="loading">Loading listings…</p>
    <div v-else-if="error" class="desktop-marketplace__error">
      <p>{{ error }}</p>
      <button type="button" data-retry @click="load">Retry</button>
    </div>
    <ul v-else class="desktop-marketplace__list">
      <li v-for="listing in visible" :key="listing.handle" class="desktop-marketplace__row">
        <span class="desktop-marketplace__handle">@{{ listing.handle }}</span>
        <span class="desktop-marketplace__price">{{ lunaToNim(listing.price_luna) }} NIM</span>
        <RouterLink
          v-if="compact(listing.seller) !== compact(ownAddress || '')"
          :to="{ path: '/marketplace/buy', query: { handle: listing.handle } }"
          :data-buy-handle="listing.handle"
          class="desktop-marketplace__buy"
        >
          Buy
        </RouterLink>
      </li>
      <li v-if="visible.length === 0" class="desktop-marketplace__empty">No listings match.</li>
    </ul>
  </section>
</template>

<style scoped>
.desktop-marketplace { max-width: 720px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace__header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.desktop-marketplace__header h1 { flex: 1; font-size: 20px; margin: 0; }
.desktop-marketplace__filter {
  width: 100%; height: 40px; padding: 0 12px; margin-bottom: 16px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); font: inherit; color: var(--text);
}
.desktop-marketplace__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.desktop-marketplace__row {
  display: flex; align-items: center; gap: 12px; padding: 12px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
}
.desktop-marketplace__handle { flex: 1; font-weight: 700; }
.desktop-marketplace__buy {
  padding: 6px 14px; border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-gold-bg); color: var(--nimiq-white); font-weight: 700; text-decoration: none;
}
.desktop-marketplace__error { color: var(--nq-red); }
.desktop-marketplace__empty { color: var(--text-2); padding: 12px; }
</style>
```

Note: the "Buy" link routes to `/marketplace/buy?handle=...` rather than directly reserving from this page — Task 6 covers the sell flow only; a minimal buy-confirmation step (reachable from this link) belongs to Task 7's trade page work, since reserving a trade and landing on its status page are one continuous action. Wire that route in Task 7, not here.

Add to `src/router.ts`:

```ts
    { path: '/marketplace', component: () => import('./pages/desktop/DesktopMarketplacePage.vue') },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/pages/desktop/DesktopMarketplacePage.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pages/desktop/DesktopMarketplacePage.vue src/pages/desktop/DesktopMarketplacePage.test.ts src/router.ts
git commit -m "feat: add marketplace browse page"
```

---

### Task 6: `DesktopMarketplaceSellPage.vue`

**Files:**
- Create: `src/pages/desktop/DesktopMarketplaceSellPage.vue`
- Test: `src/pages/desktop/DesktopMarketplaceSellPage.test.ts`
- Modify: `src/router.ts`

**Interfaces:**
- Consumes: `chooseHubAddress`, `hubSignMessage`, `hubErrorMessage` (`src/services/hub.ts`); `getDesktopHubAddress`, `setDesktopHubAddress` (`src/services/desktop-session.ts`); `findMyHandle` (`src/services/handles.ts`); `createListing`, `marketplaceListingMessage`, `generateNonce` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// src/pages/desktop/DesktopMarketplaceSellPage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DesktopMarketplaceSellPage from './DesktopMarketplaceSellPage.vue'

vi.mock('../../services/hub', () => ({
  chooseHubAddress: vi.fn(),
  hubSignMessage: vi.fn(),
  hubErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => null),
  setDesktopHubAddress: vi.fn(),
}))
vi.mock('../../services/handles', () => ({
  findMyHandle: vi.fn(),
}))
vi.mock('../../services/marketplace', () => ({
  createListing: vi.fn(),
  marketplaceListingMessage: vi.fn(() => 'the-message'),
  generateNonce: vi.fn(() => 'the-nonce'),
}))

import { chooseHubAddress, hubSignMessage } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { findMyHandle } from '../../services/handles'
import { createListing } from '../../services/marketplace'

describe('DesktopMarketplaceSellPage', () => {
  beforeEach(() => {
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue(null)
    vi.mocked(findMyHandle).mockReset()
    vi.mocked(chooseHubAddress).mockReset()
    vi.mocked(hubSignMessage).mockReset()
    vi.mocked(createListing).mockReset()
  })

  it('shows a connect prompt when no Hub wallet is connected', async () => {
    const wrapper = mount(DesktopMarketplaceSellPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Connect')
  })

  it('shows a claim prompt when connected but no handle is owned', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue(null)
    const wrapper = mount(DesktopMarketplaceSellPage)
    await flushPromises()
    expect(wrapper.text()).toContain('claim')
  })

  it('computes and displays the fixed fee for an entered price', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue({ handle: 'chuck', address: 'NQ11 SELLER', tx_hash: 't1', block_height: 5, tx_index: 0 })
    const wrapper = mount(DesktopMarketplaceSellPage)
    await flushPromises()
    await wrapper.find('input[type="number"]').setValue('10')
    expect(wrapper.text()).toContain('0.5 NIM') // 5% of 10 NIM
  })

  it('signs and submits the exact listing message', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue({ handle: 'chuck', address: 'NQ11 SELLER', tx_hash: 't1', block_height: 5, tx_index: 0 })
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(createListing).mockResolvedValue({
      handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 1000000, fee_luna: 50000,
      status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1,
    })
    const wrapper = mount(DesktopMarketplaceSellPage)
    await flushPromises()
    await wrapper.find('input[type="number"]').setValue('10')
    await wrapper.find('[data-list-button]').trigger('click')
    await flushPromises()

    expect(hubSignMessage).toHaveBeenCalledWith('the-message', 'NQ11 SELLER')
    expect(createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 1000000, fee_luna: 50000,
        ownership_epoch_tx_hash: 't1', nonce: 'the-nonce', public_key: 'pub', signature: 'sig',
      }),
    )
    expect(wrapper.text()).toContain('marketplace/chuck')
  })

  it('maps a Hub rejection to a quiet message', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue({ handle: 'chuck', address: 'NQ11 SELLER', tx_hash: 't1', block_height: 5, tx_index: 0 })
    vi.mocked(hubSignMessage).mockRejectedValue(new Error('canceled'))
    const wrapper = mount(DesktopMarketplaceSellPage)
    await flushPromises()
    await wrapper.find('input[type="number"]').setValue('10')
    await wrapper.find('[data-list-button]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('canceled')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/desktop/DesktopMarketplaceSellPage.test.ts`
Expected: FAIL — the component doesn't exist yet.

- [ ] **Step 3: Implement**

```vue
<!-- src/pages/desktop/DesktopMarketplaceSellPage.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { chooseHubAddress, hubSignMessage, hubErrorMessage } from '../../services/hub'
import { getDesktopHubAddress, setDesktopHubAddress } from '../../services/desktop-session'
import { findMyHandle, type HandleClaim } from '../../services/handles'
import { createListing, marketplaceListingMessage, generateNonce } from '../../services/marketplace'

const brandIconUrl = `${import.meta.env.BASE_URL}brand/nimconnect-icon-192x192.png`

/** Fixed platform fee — never editable by the seller. Must stay at or below
 * the backend's configured MARKETPLACE_MAX_FEE_BPS or listing creation
 * fails with a clear "fee exceeds the maximum allowed" error. */
const FEE_BPS = 500 // 5%
const LUNA_PER_NIM = 100000

const hubAddress = ref<string | null>(null)
const claim = ref<HandleClaim | null>(null)
const loadingIdentity = ref(false)
const connecting = ref(false)
const priceNim = ref('')
const listing = ref(false)
const error = ref<string | null>(null)
const listedLink = ref<string | null>(null)

const priceLuna = computed(() => Math.round((parseFloat(priceNim.value) || 0) * LUNA_PER_NIM))
const feeLuna = computed(() => Math.round((priceLuna.value * FEE_BPS) / 10000))
const feeNim = computed(() => (feeLuna.value / LUNA_PER_NIM).toString())

async function loadIdentity(addr: string) {
  loadingIdentity.value = true
  try {
    claim.value = await findMyHandle([addr])
  } finally {
    loadingIdentity.value = false
  }
}

async function connect() {
  error.value = null
  connecting.value = true
  try {
    const addr = await chooseHubAddress()
    setDesktopHubAddress(addr)
    hubAddress.value = addr
    await loadIdentity(addr)
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    connecting.value = false
  }
}

async function submitListing() {
  if (!hubAddress.value || !claim.value || priceLuna.value <= 0) return
  listing.value = true
  error.value = null
  try {
    const nonce = generateNonce()
    const expiresAt = Math.floor(Date.now() / 1000) + 600
    const message = marketplaceListingMessage(
      claim.value.handle, hubAddress.value, priceLuna.value, feeLuna.value,
      claim.value.tx_hash, nonce, expiresAt,
    )
    const { publicKey, signature } = await hubSignMessage(message, hubAddress.value)
    await createListing({
      handle: claim.value.handle, seller: hubAddress.value,
      price_luna: priceLuna.value, fee_luna: feeLuna.value,
      ownership_epoch_tx_hash: claim.value.tx_hash,
      nonce, expires_at: expiresAt, public_key: publicKey, signature,
    })
    listedLink.value = `/marketplace/${claim.value.handle}`
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    listing.value = false
  }
}

onMounted(async () => {
  const stored = getDesktopHubAddress()
  if (stored) {
    hubAddress.value = stored
    await loadIdentity(stored)
  }
})
</script>

<template>
  <section class="desktop-marketplace-sell">
    <header class="desktop-marketplace-sell__header">
      <img :src="brandIconUrl" alt="" width="32" height="32" />
      <h1>Sell your @handle</h1>
    </header>

    <div v-if="!hubAddress">
      <p>Connect your Nimiq Hub wallet to list a handle for sale.</p>
      <button type="button" :disabled="connecting" @click="connect">
        {{ connecting ? 'Connecting…' : 'Connect Wallet' }}
      </button>
    </div>
    <div v-else-if="loadingIdentity">
      <p>Checking your identity…</p>
    </div>
    <div v-else-if="!claim">
      <p>You need to claim a handle before you can list one for sale.</p>
    </div>
    <div v-else-if="listedLink">
      <p>@{{ claim.handle }} is listed. Share its link:</p>
      <code>{{ listedLink }}</code>
    </div>
    <form v-else @submit.prevent="submitListing">
      <p>Listing <strong>@{{ claim.handle }}</strong> for sale.</p>
      <label>
        Price (NIM)
        <input type="number" min="0" step="0.01" v-model="priceNim" />
      </label>
      <p>Marketplace fee: {{ FEE_BPS / 100 }}% ({{ feeNim }} NIM)</p>
      <p v-if="error" class="desktop-marketplace-sell__error">{{ error }}</p>
      <button type="submit" data-list-button :disabled="listing || priceLuna <= 0">
        {{ listing ? 'Listing…' : 'List for sale' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.desktop-marketplace-sell { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-sell__header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.desktop-marketplace-sell__header h1 { font-size: 20px; margin: 0; }
.desktop-marketplace-sell__error { color: var(--nq-red); }
</style>
```

Add to `src/router.ts`:

```ts
    { path: '/marketplace/sell', component: () => import('./pages/desktop/DesktopMarketplaceSellPage.vue') },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/pages/desktop/DesktopMarketplaceSellPage.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pages/desktop/DesktopMarketplaceSellPage.vue src/pages/desktop/DesktopMarketplaceSellPage.test.ts src/router.ts
git commit -m "feat: add marketplace sell page"
```

---

### Task 7: `DesktopMarketplaceTradePage.vue` — buy confirmation + trade status

**Files:**
- Create: `src/pages/desktop/DesktopMarketplaceTradePage.vue`
- Create: `src/pages/desktop/DesktopMarketplaceBuyPage.vue`
- Test: `src/pages/desktop/DesktopMarketplaceTradePage.test.ts`, `src/pages/desktop/DesktopMarketplaceBuyPage.test.ts`
- Modify: `src/router.ts`

**Interfaces:**
- Consumes: `chooseHubAddress`, `hubSignMessage`, `hubCheckoutPayment`, `hubSignReleaseTransaction`, `hubSignClaimTransaction`, `hubErrorMessage` (`src/services/hub.ts`); `getDesktopHubAddress`, `setDesktopHubAddress` (`src/services/desktop-session.ts`); `reserveTrade`, `getTrade`, `submitRelease`, `submitClaim`, `fetchChainHeight`, `marketplacePurchaseMessage`, `generateNonce`, `fetchListings` (Task 3).

- [ ] **Step 1: Write the failing tests**

```ts
// src/pages/desktop/DesktopMarketplaceBuyPage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import DesktopMarketplaceBuyPage from './DesktopMarketplaceBuyPage.vue'

vi.mock('../../services/hub', () => ({
  chooseHubAddress: vi.fn(),
  hubSignMessage: vi.fn(),
  hubErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => 'NQ22 BUYER'),
  setDesktopHubAddress: vi.fn(),
}))
vi.mock('../../services/marketplace', () => ({
  fetchListings: vi.fn(),
  reserveTrade: vi.fn(),
  marketplacePurchaseMessage: vi.fn(() => 'the-message'),
  generateNonce: vi.fn(() => 'the-nonce'),
}))

import { hubSignMessage } from '../../services/hub'
import { fetchListings, reserveTrade } from '../../services/marketplace'

async function mountWithQuery(handle: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/marketplace/buy', component: DesktopMarketplaceBuyPage },
      { path: '/marketplace/trades/:id', component: { template: '<div />' } },
    ],
  })
  router.push({ path: '/marketplace/buy', query: { handle } })
  await router.isReady()
  return mount(DesktopMarketplaceBuyPage, { global: { plugins: [router] } })
}

describe('DesktopMarketplaceBuyPage', () => {
  beforeEach(() => {
    vi.mocked(fetchListings).mockReset()
    vi.mocked(reserveTrade).mockReset()
    vi.mocked(hubSignMessage).mockReset()
  })

  it('shows the listing price for the handle in the query string', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    expect(wrapper.text()).toContain('1 NIM')
  })

  it('signs the purchase intent, reserves the trade, and routes to its status page', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(reserveTrade).mockResolvedValue({
      trade_id: 'trade-1', escrow_address: 'NQ99 ESCROW', reference: 'ref1', price_luna: 100000, fee_luna: 5000,
    })
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    await wrapper.find('[data-confirm-buy]').trigger('click')
    await flushPromises()

    expect(reserveTrade).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'chuck', buyer: 'NQ22 BUYER', nonce: 'the-nonce', public_key: 'pub', signature: 'sig' }),
    )
    expect(wrapper.vm.$router.currentRoute.value.path).toBe('/marketplace/trades/trade-1')
  })
})
```

```ts
// src/pages/desktop/DesktopMarketplaceTradePage.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import DesktopMarketplaceTradePage from './DesktopMarketplaceTradePage.vue'

vi.mock('../../services/hub', () => ({
  hubCheckoutPayment: vi.fn(),
  hubSignReleaseTransaction: vi.fn(),
  hubSignClaimTransaction: vi.fn(),
  hubErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => 'NQ22 BUYER'),
}))
vi.mock('../../services/marketplace', () => ({
  getTrade: vi.fn(),
  submitRelease: vi.fn(),
  submitClaim: vi.fn(),
  fetchChainHeight: vi.fn(),
}))

import { hubCheckoutPayment, hubSignReleaseTransaction, hubSignClaimTransaction } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { getTrade, submitRelease, submitClaim, fetchChainHeight } from '../../services/marketplace'

async function mountForTrade(id: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/marketplace/trades/:id', component: DesktopMarketplaceTradePage }],
  })
  router.push(`/marketplace/trades/${id}`)
  await router.isReady()
  return mount(DesktopMarketplaceTradePage, { global: { plugins: [router] } })
}

const baseTrade = {
  id: 'trade-1', reference: 'ref1', handle: 'chuck', buyer: 'NQ22 BUYER', seller: 'NQ11 SELLER',
  price_luna: 100000, fee_luna: 5000, version: 1, created_at: 1, updated_at: 1,
}

describe('DesktopMarketplaceTradePage', () => {
  beforeEach(() => {
    vi.mocked(getTrade).mockReset()
    vi.mocked(submitRelease).mockReset()
    vi.mocked(submitClaim).mockReset()
    vi.mocked(fetchChainHeight).mockReset()
    vi.mocked(hubCheckoutPayment).mockReset()
    vi.mocked(hubSignReleaseTransaction).mockReset()
    vi.mocked(hubSignClaimTransaction).mockReset()
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue('NQ22 BUYER')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a not-found state for an unknown trade', async () => {
    vi.mocked(getTrade).mockRejectedValue(new Error('no such trade'))
    const wrapper = await mountForTrade('nope')
    await flushPromises()
    expect(wrapper.text()).toContain('no such trade')
  })

  it('shows the pay panel and calls hubCheckoutPayment with the escrow reference', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_DEPOSIT' })
    vi.mocked(hubCheckoutPayment).mockResolvedValue({ txHash: 'd1' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    await wrapper.find('[data-pay-button]').trigger('click')
    await flushPromises()
    expect(hubCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({ valueLuna: 100000, data: 'NME1:ref1' }),
    )
  })

  it('shows a release button for the seller when AWAITING_RELEASE', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_RELEASE' })
    vi.mocked(fetchChainHeight).mockResolvedValue(42)
    vi.mocked(hubSignReleaseTransaction).mockResolvedValue({ rawHex: 'deadbeef', hash: 'r1' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    await wrapper.find('[data-release-button]').trigger('click')
    await flushPromises()
    expect(hubSignReleaseTransaction).toHaveBeenCalledWith('chuck', 'NQ11 SELLER', 42)
    expect(submitRelease).toHaveBeenCalledWith('trade-1', { kind: 'hub', raw_hex: 'deadbeef' })
  })

  it('shows a passive waiting panel for the buyer when AWAITING_RELEASE', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ22 BUYER')
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_RELEASE' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    expect(wrapper.find('[data-release-button]').exists()).toBe(false)
    expect(wrapper.text()).toContain('waiting')
  })

  it('shows a claim button for the buyer when AWAITING_CLAIM', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_CLAIM' })
    vi.mocked(fetchChainHeight).mockResolvedValue(43)
    vi.mocked(hubSignClaimTransaction).mockResolvedValue({ rawHex: 'cafebabe', hash: 'c1' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    await wrapper.find('[data-claim-button]').trigger('click')
    await flushPromises()
    expect(hubSignClaimTransaction).toHaveBeenCalledWith('chuck', 'NQ22 BUYER', 43)
    expect(submitClaim).toHaveBeenCalledWith('trade-1', { kind: 'hub', raw_hex: 'cafebabe' })
  })

  it('shows a settled confirmation and stops polling', async () => {
    vi.useFakeTimers()
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'SETTLED' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    expect(wrapper.text()).toMatch(/own @chuck|paid/)
    vi.mocked(getTrade).mockClear()
    await vi.advanceTimersByTimeAsync(10000)
    expect(getTrade).not.toHaveBeenCalled()
  })

  it('shows a refunded failure panel', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'REFUNDED' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    expect(wrapper.text()).toContain('refunded')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/desktop/DesktopMarketplaceBuyPage.test.ts src/pages/desktop/DesktopMarketplaceTradePage.test.ts`
Expected: FAIL — neither component exists yet.

- [ ] **Step 3: Implement**

```vue
<!-- src/pages/desktop/DesktopMarketplaceBuyPage.vue -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { chooseHubAddress, hubSignMessage, hubErrorMessage } from '../../services/hub'
import { getDesktopHubAddress, setDesktopHubAddress } from '../../services/desktop-session'
import { fetchListings, reserveTrade, marketplacePurchaseMessage, generateNonce, type MarketplaceListing } from '../../services/marketplace'

const route = useRoute()
const router = useRouter()
const handle = computed(() => String(route.query.handle || ''))

const hubAddress = ref<string | null>(null)
const listing = ref<MarketplaceListing | null>(null)
const loading = ref(true)
const buying = ref(false)
const error = ref<string | null>(null)

function lunaToNim(luna: number): string {
  return (luna / 100000).toString()
}

async function connect() {
  error.value = null
  try {
    const addr = await chooseHubAddress()
    setDesktopHubAddress(addr)
    hubAddress.value = addr
  } catch (e) {
    error.value = hubErrorMessage(e)
  }
}

async function confirmBuy() {
  if (!hubAddress.value || !listing.value) return
  buying.value = true
  error.value = null
  try {
    const nonce = generateNonce()
    const expiresAt = Math.floor(Date.now() / 1000) + 600
    const message = marketplacePurchaseMessage(handle.value, hubAddress.value, hubAddress.value, nonce, expiresAt)
    const { publicKey, signature } = await hubSignMessage(message, hubAddress.value)
    const trade = await reserveTrade({
      handle: handle.value, buyer: hubAddress.value, refund_address: hubAddress.value,
      nonce, expires_at: expiresAt, public_key: publicKey, signature,
    })
    router.push(`/marketplace/trades/${trade.trade_id}`)
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    buying.value = false
  }
}

onMounted(async () => {
  hubAddress.value = getDesktopHubAddress()
  try {
    const listings = await fetchListings()
    listing.value = listings.find((l) => l.handle === handle.value) || null
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="desktop-marketplace-buy">
    <h1>Buy @{{ handle }}</h1>
    <p v-if="loading">Loading…</p>
    <p v-else-if="!listing">This listing is no longer available.</p>
    <template v-else>
      <p>Price: {{ lunaToNim(listing.price_luna) }} NIM</p>
      <button v-if="!hubAddress" type="button" @click="connect">Connect Wallet</button>
      <button v-else type="button" data-confirm-buy :disabled="buying" @click="confirmBuy">
        {{ buying ? 'Confirming…' : 'Confirm purchase' }}
      </button>
      <p v-if="error" class="desktop-marketplace-buy__error">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
.desktop-marketplace-buy { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-buy__error { color: var(--nq-red); }
</style>
```

```vue
<!-- src/pages/desktop/DesktopMarketplaceTradePage.vue -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { hubCheckoutPayment, hubSignReleaseTransaction, hubSignClaimTransaction, hubErrorMessage } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { getTrade, submitRelease, submitClaim, fetchChainHeight, type MarketplaceTrade } from '../../services/marketplace'

const TERMINAL_STATES = new Set(['SETTLED', 'REFUNDED', 'FAILED_AFTER_RELEASE', 'MANUAL_REVIEW'])
const POLL_INTERVAL_MS = 4000

const route = useRoute()
const tradeId = computed(() => String(route.params.id))

const trade = ref<MarketplaceTrade | null>(null)
const notFound = ref<string | null>(null)
const acting = ref(false)
const error = ref<string | null>(null)
let pollHandle: ReturnType<typeof setInterval> | undefined
let consecutiveFailures = 0

function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

const ownAddress = computed(() => getDesktopHubAddress())
const isSeller = computed(() => !!trade.value && compact(ownAddress.value || '') === compact(trade.value.seller))
const isBuyer = computed(() => !!trade.value && compact(ownAddress.value || '') === compact(trade.value.buyer))

function lunaToNim(luna: number): string {
  return (luna / 100000).toString()
}

async function refresh() {
  try {
    trade.value = await getTrade(tradeId.value)
    notFound.value = null
    consecutiveFailures = 0
    if (trade.value && TERMINAL_STATES.has(trade.value.state)) {
      stopPolling()
    }
  } catch (e) {
    consecutiveFailures++
    if (!trade.value) notFound.value = (e as Error).message
    if (consecutiveFailures >= 3) stopPolling()
  }
}

function stopPolling() {
  if (pollHandle) clearInterval(pollHandle)
  pollHandle = undefined
}

async function pay() {
  if (!trade.value) return
  acting.value = true
  error.value = null
  try {
    await hubCheckoutPayment({
      recipient: (trade.value as any).escrow_address ?? '',
      valueLuna: trade.value.price_luna,
      data: `NME1:${trade.value.reference}`,
    })
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    acting.value = false
  }
}

async function release() {
  if (!trade.value || !ownAddress.value) return
  acting.value = true
  error.value = null
  try {
    const height = await fetchChainHeight()
    const { rawHex } = await hubSignReleaseTransaction(trade.value.handle, ownAddress.value, height)
    await submitRelease(trade.value.id, { kind: 'hub', raw_hex: rawHex })
    await refresh()
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    acting.value = false
  }
}

async function claim() {
  if (!trade.value || !ownAddress.value) return
  acting.value = true
  error.value = null
  try {
    const height = await fetchChainHeight()
    const { rawHex } = await hubSignClaimTransaction(trade.value.handle, ownAddress.value, height)
    await submitClaim(trade.value.id, { kind: 'hub', raw_hex: rawHex })
    await refresh()
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    acting.value = false
  }
}

onMounted(async () => {
  await refresh()
  pollHandle = setInterval(refresh, POLL_INTERVAL_MS)
})
onUnmounted(stopPolling)
</script>

<template>
  <section class="desktop-marketplace-trade">
    <p v-if="notFound">{{ notFound }}</p>
    <template v-else-if="trade">
      <h1>@{{ trade.handle }}</h1>
      <p v-if="error" class="desktop-marketplace-trade__error">{{ error }}</p>

      <div v-if="trade.state === 'AWAITING_DEPOSIT' || trade.state === 'DEPOSIT_FINALIZING'">
        <p>Pay {{ lunaToNim(trade.price_luna) }} NIM to fund this trade.</p>
        <button type="button" data-pay-button :disabled="acting" @click="pay">Pay with Hub</button>
      </div>

      <div v-else-if="['FUNDED', 'AWAITING_RELEASE'].includes(trade.state) && isSeller">
        <button type="button" data-release-button :disabled="acting" @click="release">
          {{ acting ? 'Releasing…' : `Release @${trade.handle}` }}
        </button>
      </div>
      <div v-else-if="['FUNDED', 'AWAITING_RELEASE'].includes(trade.state)">
        <p>Waiting for the seller to release @{{ trade.handle }}.</p>
      </div>

      <div v-else-if="['RELEASE_CONFIRMING', 'AWAITING_CLAIM'].includes(trade.state) && isBuyer">
        <button type="button" data-claim-button :disabled="acting" @click="claim">
          {{ acting ? 'Claiming…' : `Claim @${trade.handle}` }}
        </button>
      </div>
      <div v-else-if="['RELEASE_CONFIRMING', 'AWAITING_CLAIM'].includes(trade.state)">
        <p>Waiting for the buyer to claim @{{ trade.handle }}.</p>
      </div>

      <div v-else-if="['CLAIM_CONFIRMING', 'SETTLEMENT_PENDING'].includes(trade.state)">
        <p>Confirming on chain…</p>
      </div>

      <div v-else-if="trade.state === 'SETTLED'">
        <p v-if="isBuyer">🎉 You now own @{{ trade.handle }}.</p>
        <p v-else>You were paid for @{{ trade.handle }}.</p>
      </div>

      <div v-else-if="trade.state === 'REFUNDED'">
        <p>This trade was refunded — the buyer's payment was returned.</p>
      </div>
      <div v-else-if="trade.state === 'FAILED_AFTER_RELEASE' || trade.state === 'MANUAL_REVIEW'">
        <p>This trade did not complete.</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.desktop-marketplace-trade { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-trade__error { color: var(--nq-red); }
</style>
```

Note on `escrow_address`: `MarketplaceTrade` (the persisted trade record) does not carry the escrow address — only `ReserveTradeResponse` does, at reservation time. Add an `escrow_address` field to `backend/marketplace.go`'s `MarketplaceTrade` struct (json tag `escrow_address,omitempty`) and set it in `marketplaceTradeReserveHandler` when the trade is created, so the trade page's later `GET /api/marketplace/trades/{id}` fetch — which may happen well after reservation, e.g. on a page reload — can still recover the address to pay. Make this small backend change as part of this task's Step 3, with a one-line addition to `backend/marketplace_handlers_test.go`'s existing reserve-handler test asserting the field is set, and to `TestMarketplaceTradeGetHandler_ReturnsTradeStatus` asserting it round-trips.

Add to `src/router.ts`:

```ts
    { path: '/marketplace/buy', component: () => import('./pages/desktop/DesktopMarketplaceBuyPage.vue') },
    { path: '/marketplace/trades/:id', component: () => import('./pages/desktop/DesktopMarketplaceTradePage.vue') },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/desktop/DesktopMarketplaceBuyPage.test.ts src/pages/desktop/DesktopMarketplaceTradePage.test.ts`
Expected: PASS

- [ ] **Step 5: Run the backend and full frontend suites**

Run: `cd backend && go build ./... && go test ./... -race`
Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/marketplace.go backend/marketplace_handlers.go backend/marketplace_handlers_test.go src/pages/desktop/DesktopMarketplaceBuyPage.vue src/pages/desktop/DesktopMarketplaceBuyPage.test.ts src/pages/desktop/DesktopMarketplaceTradePage.vue src/pages/desktop/DesktopMarketplaceTradePage.test.ts src/router.ts
git commit -m "feat: add marketplace buy and trade-status pages"
```

---

## Self-Review Notes

- **Spec coverage:** Backend additions (listings, chain height) — Tasks 1-2. `marketplace.ts` client + exact message builders — Task 3. Shared `hubCheckoutPayment`/`hubErrorMessage` — Task 4. Browse page with client-side filter and own-listing hiding — Task 5. Sell page with fixed non-editable fee — Task 6. Buy confirmation and the full trade-status page (pay/release/claim by role, auto-polling that stops on terminal states, not-found handling) — Task 7. Error-message surfacing (not generic) is built into `marketplace.ts`'s fetch helper in Task 3 and exercised throughout.
- **Placeholder scan:** No TBDs. One design gap found and fixed during planning (not deferred): `MarketplaceTrade` didn't carry the escrow address needed to pay after a page reload — Task 7 adds that field to the backend struct rather than working around its absence in the frontend.
- **Type consistency:** `MarketplaceListing`/`MarketplaceTrade` field names in `src/services/marketplace.ts` (Task 3) match `backend/marketplace.go`'s json tags exactly and are used identically across every page task. `SubmitTransactionRequest`'s `{kind, raw_hex}`/`{kind, tx_hash}` shape matches `backend/marketplace_handlers.go`'s `marketplaceSubmitRequest`. `hubSignReleaseTransaction`/`hubSignClaimTransaction`'s existing `(handle, sender, validityStartHeight)` signature (already merged) is called identically in Task 7.
