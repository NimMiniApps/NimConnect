# Marketplace UI — Design

**Date:** 2026-07-28
**Status:** Approved

## Problem

The handle marketplace backend (trade state machine, escrow watcher, settlement worker, signed-intent verification, Hub/Nimiq Pay choreography) is fully implemented and merged, but nothing in the frontend calls it. There is no way for a user to list a handle for sale, browse listings, buy one, or complete the release/claim steps that settle a trade.

## Goals

- Let a Hub-connected user with a claimed handle list it for sale at a fixed NIM price.
- Let a Hub-connected user browse active listings and buy one.
- Drive a trade from funding through release, claim, and settlement/refund, entirely through Hub's sign-then-verify flow.
- Keep the marketplace fee a platform decision, not a per-listing choice exposed to the seller.

## Non-goals

- Nimiq Pay (mobile mini-app) support — desktop/Hub only for this iteration. The backend's `"pay"` choreography path already exists for when this is picked up later; no backend work is blocked on it.
- Listing search beyond a client-side handle-prefix filter, pagination, or sorting — deferred until listing volume justifies it.
- Editing or canceling a listing/trade — out of scope; a stuck or unwanted trade still resolves via the existing timeout-free-for-now backend behavior (this spec doesn't add deadlines, matching the previous plan's explicit scope cut).
- Push notifications for trade state changes — the trade page's own polling is the only update mechanism.

## Backend additions

Two small additions alongside the existing marketplace backend, following its established patterns exactly.

### `GET /api/marketplace/listings`

Returns all active listings as a JSON array. New `(*MarketplaceStore) ActiveListings() []MarketplaceListing` method (mutex-guarded read over the existing `listings` map, filtering `Status == "active"`) plus a handler following `marketplaceTradeGetHandler`'s shape. No pagination — matches this plan's non-goal of deferring it until it's actually needed.

### `GET /api/chain/height`

Returns the current block height as `{"height": <uint64>}`. Backed by a new `(*NimiqRPC) GetBlockNumber() (uint64, error)` calling the standard `getBlockNumber` RPC method (same pattern as the existing `GetLastMacroBlockNumber`). Needed because Hub's `signTransaction` requires an explicit `validityStartHeight` — nothing in the app currently exposes a fresh height to the frontend.

## Frontend additions

### `hub.ts` additions

- `hubCheckoutPayment(opts: { recipient: string; valueLuna: number; data: string; sender?: string }): Promise<{ txHash: string }>` — a generic value+text-data checkout, distinct from `hubCheckoutClaim` (which is always value-0 with binary `extraData`). Used for the buyer's escrow deposit, where the data is the plain-text `"NME1:<reference>"` string, not a claim/release payload.
- `fetchChainHeight(): Promise<number>` — thin wrapper over `GET /api/chain/height`, used immediately before every `hubSignReleaseTransaction`/`hubSignClaimTransaction` call so the signed transaction's validity window starts fresh.

### Pages (new, under `src/pages/desktop/`, following existing naming)

**`DesktopMarketplacePage.vue`** — route `/marketplace`.
- Fetches `GET /api/marketplace/listings` on mount.
- A text input filters the fetched list client-side by handle prefix (no re-fetch).
- Each row: handle, price (NIM, converted from `price_luna`), a "Buy" button. The button is disabled/hidden when the listing's `seller` matches the connected Hub address (desktop session already tracks this, same as `DesktopIdentityPage`).
- "Buy" signs the purchase intent (new `marketplacePurchaseMessage`-equivalent built client-side, matching the backend's exact message format byte-for-byte — see Data flow below) via `hubSignMessage`, posts to `POST /api/marketplace/trades`, and routes to `/marketplace/trades/:id` with the returned `trade_id`.

**`DesktopMarketplaceSellPage.vue`** — route `/marketplace/sell`.
- Requires a connected Hub wallet with a resolved claimed handle (reuses the existing claim-lookup already used by `DesktopIdentityPage`); shows a connect/claim prompt otherwise, not a broken form.
- Price input in NIM, converted to `price_luna` (× 100,000, matching the existing `CLAIM_AMOUNT_NIM`-style Luna conversion already used elsewhere in the codebase).
- Fee is not an input: computed as a fixed percentage constant (`MARKETPLACE_FEE_BPS`, e.g. 500 = 5%) defined once in this page and shown as a read-only line ("Marketplace fee: 5% (X NIM)"). This constant is a frontend-only display/intent value — the backend still authoritatively caps whatever fee a listing intent carries at its own configured `MARKETPLACE_MAX_FEE_BPS`, so a mismatch between the two fails the listing request with a clear error rather than silently succeeding at a different fee.
- Submits the signed listing intent to `POST /api/marketplace/listings`; on success, shows a shareable link to `/marketplace/{handle}` (routes to the browse page's implicit single-listing view — reuses `DesktopMarketplacePage`'s data, filtered to that handle, rather than a third page).

**`DesktopMarketplaceTradePage.vue`** — route `/marketplace/trades/:id`.
- On mount and on a `setInterval` poll (every 4s, matching typical status-polling intervals elsewhere in the app) while `trade.state` is not `SETTLED`/`REFUNDED`, fetches `GET /api/marketplace/trades/{id}`.
- Renders one of five panels based on `state`:
  - `AWAITING_DEPOSIT` (and its provisional `DEPOSIT_FINALIZING`): a "Pay to fund" panel with the exact `price_luna` (shown in NIM) and a "Pay with Hub" button calling `hubCheckoutPayment({ recipient: escrow_address, valueLuna: price_luna, data: "NME1:" + reference })`.
  - `FUNDED` / `AWAITING_RELEASE` where the connected address is the trade's `seller`: a "Release @handle" button — `fetchChainHeight()` → `hubSignReleaseTransaction(handle, sender, height)` → `POST /trades/{id}/release` with `{kind:"hub", raw_hex}`.
  - `FUNDED` / `AWAITING_RELEASE` where the connected address is the buyer (or nobody connected): a passive "waiting for the seller to release" panel — no action available.
  - `RELEASE_CONFIRMING` / `AWAITING_CLAIM` where the connected address is the trade's `buyer`: a "Claim @handle" button — same shape as release, calling `hubSignClaimTransaction` and posting to `/trades/{id}/claim`.
  - `CLAIM_CONFIRMING` / `SETTLEMENT_PENDING`: a passive "confirming on chain" panel.
  - `SETTLED`: a success confirmation (different copy for buyer vs. seller — "you now own @handle" vs. "you were paid").
  - `REFUNDED` / `FAILED_AFTER_RELEASE` / `MANUAL_REVIEW`: a failure panel explaining the trade didn't complete and (for `REFUNDED`) that the buyer's payment was returned.
- Trade not found (bad ID, wrong network): a clear not-found state, not an infinite spinner.

## Data flow: purchase intent message

The purchase intent's signed message must byte-for-byte match `marketplacePurchaseMessage` in `backend/marketplace_intents.go`:

```text
nimconnect:marketplace-purchase:v1
handle=<handle>
buyer=<compact buyer address>
refund_address=<compact refund address>
nonce=<nonce>
expires_at=<unix seconds>
```

The frontend builds this exact string (a small new function in `src/services/handles.ts` or a new `src/services/marketplace.ts`, whichever the implementation plan's file-structure section settles on) rather than depending on any shared package, since `profile-client` doesn't currently export marketplace-intent builders and adding that cross-cutting dependency isn't justified for one string builder used in exactly two places (listing and purchase intents). A generated nonce (random hex, matching the backend's own nonce shape expectations — any unique string, since the backend only checks uniqueness, not format) and a short expiry (e.g. 10 minutes from signing) accompany every signed intent. The listing intent's message mirrors `marketplaceListingMessage` the same way.

## Error handling

- Every signed-intent or transaction-submission failure surfaces the backend's returned error message inline in the relevant panel, following `ClaimHandleSheet`'s existing pattern — no generic toast swallowing the specific reason (wrong owner, expired intent, nonce reuse, wrong sender on a release/claim).
- A Hub popup rejection or cancellation is mapped through the same quieter-message helper `DesktopIdentityPage` already has for its claim flow (reused, not reimplemented) across all four Hub-calling actions here (sell, buy, release, claim).
- A failed `GET /api/marketplace/listings` or `GET /api/marketplace/trades/{id}` shows a retry affordance, not a blank page.
- Polling on the trade page stops on a fetch error after a few consecutive failures (avoids hammering a down backend) and shows a "couldn't refresh — retry" state rather than silently going stale forever.

## Tests

### Backend

- `ActiveListings` returns only `"active"` listings, excludes `"reserved"`/`"sold"`/`"canceled"`.
- `GET /api/marketplace/listings` handler returns the store's active listings as JSON.
- `GetBlockNumber` parses the RPC response; `GET /api/chain/height` returns it as `{"height": ...}`.

### Frontend

- `DesktopMarketplacePage`: renders fetched listings; the handle filter narrows the visible rows without a re-fetch; "Buy" is hidden/disabled for the connected user's own listing; a fetch failure shows retry.
- `DesktopMarketplaceSellPage`: shows a connect/claim prompt when there's no resolved handle; computes and displays the fixed fee correctly for a given price; submits the exact `marketplaceListingMessage`-shaped signed intent; a Hub rejection maps to the quieter message.
- `DesktopMarketplaceTradePage`: renders the correct panel for each `state` value, including the buyer-vs-seller branching on `AWAITING_RELEASE`/`AWAITING_CLAIM`; polling stops on `SETTLED`/`REFUNDED`; a not-found trade ID shows the not-found state, not a spinner; `hubCheckoutPayment`/`hubSignReleaseTransaction`/`hubSignClaimTransaction` are called with the exact expected arguments for each action.
- `hubCheckoutPayment` and `fetchChainHeight`: unit tests following the existing `hub.test.ts` mocking pattern (as already established for `hubSignReleaseTransaction`/`hubSignClaimTransaction`).
