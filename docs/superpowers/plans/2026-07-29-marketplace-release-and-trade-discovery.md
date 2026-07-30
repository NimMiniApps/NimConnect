# Marketplace Release Transition and Trade Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps found in the marketplace UI branch's final review: a funded trade never becomes releasable, and a trade is only ever discoverable by the buyer who reserved it.

**Architecture:** The release-transition fix is a single additional unconditional hop appended to the escrow watcher's existing sweep — no new condition, no new state. Trade discovery is a standard read-only lookup (`TradesForWallet`, mirroring the existing `TradesInState`) exposed through a new endpoint that mirrors `handleByAddressHandler`'s path-segment convention, consumed by one new desktop page that reuses the sell page's connect-prompt pattern.

**Tech Stack:** Go (backend), Vue 3 + Vitest (frontend), matching the existing marketplace code in this worktree exactly.

## Global Constraints

- No new state, no new condition for the release transition — `FUNDED` and `AWAITING_RELEASE` both become true in the same sweep, so a trade is never observably stuck in `FUNDED`.
- `GET /api/marketplace/trades/by-wallet/{address}` is a path-segment lookup (matching `GET /api/handles/by-address/{address}`), not a query parameter. No 404 for zero matches — an empty array is a valid, non-error response.
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

Add to `backend/marketplace_handlers.go`, after `marketplaceTradeGetHandler`:

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

### Task 3: Frontend — `DesktopMarketplaceTradesPage.vue`

**Files:**
- Modify: `src/services/marketplace.ts`
- Create: `src/pages/desktop/DesktopMarketplaceTradesPage.vue`
- Test: `src/pages/desktop/DesktopMarketplaceTradesPage.test.ts`
- Modify: `src/router.ts`
- Modify: `src/components/desktop/DesktopShell.vue`
- Test: `src/components/desktop/DesktopShell.test.ts`

**Interfaces:**
- Consumes: `MarketplaceTrade` type, `apiUrl`-based fetch pattern (`src/services/marketplace.ts`); `getDesktopHubAddress`, `chooseHubAddress`, `setDesktopHubAddress` (existing).
- Produces: `fetchTradesForWallet(address: string): Promise<MarketplaceTrade[]>` in `src/services/marketplace.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/marketplace.test.ts`:

```ts
it('fetchTradesForWallet returns the parsed array', async () => {
  ;(fetch as any).mockResolvedValue({ ok: true, json: async () => [{ id: 't1', state: 'FUNDED' }] })
  await expect(fetchTradesForWallet('NQ11 SELLER')).resolves.toEqual([{ id: 't1', state: 'FUNDED' }])
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/marketplace/trades/by-wallet/NQ11%20SELLER'), undefined)
})
```

Create `src/pages/desktop/DesktopMarketplaceTradesPage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DesktopMarketplaceTradesPage from './DesktopMarketplaceTradesPage.vue'

vi.mock('../../services/hub', () => ({
  chooseHubAddress: vi.fn(),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => null),
  setDesktopHubAddress: vi.fn(),
}))
vi.mock('../../services/marketplace', () => ({
  fetchTradesForWallet: vi.fn(),
}))

import { chooseHubAddress } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { fetchTradesForWallet } from '../../services/marketplace'

describe('DesktopMarketplaceTradesPage', () => {
  beforeEach(() => {
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue(null)
    vi.mocked(chooseHubAddress).mockReset()
    vi.mocked(fetchTradesForWallet).mockReset()
  })

  it('shows a connect prompt when no Hub wallet is connected', async () => {
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Connect')
    expect(fetchTradesForWallet).not.toHaveBeenCalled()
  })

  it('fetches and renders trades with the correct role label', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(fetchTradesForWallet).mockResolvedValue([
      { id: 't1', handle: 'chuck', seller: 'NQ11 SELLER', buyer: 'NQ22 BUYER', state: 'AWAITING_RELEASE' },
      { id: 't2', handle: 'alice', seller: 'NQ33 OTHER', buyer: 'NQ11 SELLER', state: 'SETTLED' },
    ])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    expect(fetchTradesForWallet).toHaveBeenCalledWith('NQ11 SELLER')
    expect(wrapper.text()).toContain('chuck')
    expect(wrapper.text()).toContain('Selling')
    expect(wrapper.text()).toContain('alice')
    expect(wrapper.text()).toContain('Buying')
  })

  it('shows an empty state with a link back to browse when there are no trades', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(fetchTradesForWallet).mockResolvedValue([])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    expect(wrapper.text()).toContain('No trades yet')
    expect(wrapper.find('a[href="#/marketplace"]').exists()).toBe(true)
  })

  it('links each trade to its status page', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(fetchTradesForWallet).mockResolvedValue([
      { id: 't1', handle: 'chuck', seller: 'NQ11 SELLER', buyer: 'NQ22 BUYER', state: 'AWAITING_RELEASE' },
    ])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    expect(wrapper.find('a[href="#/marketplace/trades/t1"]').exists()).toBe(true)
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
export function fetchTradesForWallet(address: string): Promise<MarketplaceTrade[]> {
  return marketplaceFetch(`/api/marketplace/trades/by-wallet/${encodeURIComponent(address)}`)
}
```

Create `src/pages/desktop/DesktopMarketplaceTradesPage.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { chooseHubAddress } from '../../services/hub'
import { getDesktopHubAddress, setDesktopHubAddress } from '../../services/desktop-session'
import { fetchTradesForWallet, type MarketplaceTrade } from '../../services/marketplace'

const hubAddress = ref<string | null>(null)
const trades = ref<MarketplaceTrade[]>([])
const loading = ref(false)
const connecting = ref(false)
const error = ref<string | null>(null)

function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

function roleFor(trade: MarketplaceTrade): string {
  return compact(trade.seller) === compact(hubAddress.value || '') ? 'Selling' : 'Buying'
}

async function load(address: string) {
  loading.value = true
  error.value = null
  try {
    trades.value = await fetchTradesForWallet(address)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function connect() {
  connecting.value = true
  try {
    const addr = await chooseHubAddress()
    setDesktopHubAddress(addr)
    hubAddress.value = addr
    await load(addr)
  } finally {
    connecting.value = false
  }
}

onMounted(async () => {
  const stored = getDesktopHubAddress()
  if (stored) {
    hubAddress.value = stored
    await load(stored)
  }
})
</script>

<template>
  <section class="desktop-marketplace-trades">
    <h1>My Trades</h1>
    <div v-if="!hubAddress">
      <p>Connect your Nimiq Hub wallet to see your trades.</p>
      <button type="button" :disabled="connecting" @click="connect">
        {{ connecting ? 'Connecting…' : 'Connect Wallet' }}
      </button>
    </div>
    <div v-else-if="loading">
      <p>Loading…</p>
    </div>
    <div v-else-if="error" class="desktop-marketplace-trades__error">
      <p>{{ error }}</p>
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

- **Spec coverage:** Task 1 covers "Backend fix: FUNDED → AWAITING_RELEASE" exactly. Tasks 2-3 cover "Backend: TradesForWallet" and "Frontend: /marketplace/trades page" exactly, including the empty-state, role-label, and nav-link requirements.
- **Placeholder scan:** No TBDs. The one inline note in Task 3 (router ordering) explains itself rather than hand-waving — it's a clarification, not a deferred decision.
- **Type consistency:** `TradesForWallet`/`marketplaceTradesByWalletHandler`/`fetchTradesForWallet` names and the `/api/marketplace/trades/by-wallet/{address}` path are used identically across all three tasks. `MarketplaceTrade`'s existing fields (`seller`, `buyer`, `handle`, `state`, `id`) are used as already defined in `src/services/marketplace.ts` — no new fields needed.
