# Marketplace Release Transition and Trade Discovery — Design

**Date:** 2026-07-29
**Status:** Approved

## Problem

The marketplace UI branch (`feat/marketplace-ui`) is otherwise complete and reviewed, but its final whole-branch review surfaced two gaps that block a real purchase from ever completing:

1. Nothing in the backend transitions a trade from `FUNDED` to `AWAITING_RELEASE`. The escrow watcher stops at `FUNDED`; the ownership watcher only sweeps trades from `AWAITING_RELEASE` onward. A funded trade's seller is shown a "Release" button that will always be rejected by the backend with "trade is not awaiting a release."
2. There is no way for a seller (or a buyer who navigates away) to find a trade again — only `GET /trades/{id}` exists, and that ID is currently shown only to the buyer at the moment they reserve it.

## Goals

- Once a deposit is macro-finalized, a trade automatically becomes releasable — no separate condition or event required.
- A connected wallet (buyer or seller) can list every trade it's a party to and navigate to each one's status page.

## Non-goals

- Any deadline/timeout-driven transition (e.g. auto-refunding a trade the seller never releases) — still out of scope, as it was for the original marketplace plans.
- Filtering, pagination, or sorting on the trades list — matches the same no-pagination call already made for the listings browse page.
- Server-side wallet authentication for the lookup endpoint — the address is the same "opaque, unguessable enough" trust level already used for `GET /trades/{id}` and `GET /handles/by-address/{address}`, not a claim requiring a signature.

## Backend: `FUNDED` → `AWAITING_RELEASE`

In `backend/marketplace_escrow_watcher.go`, the existing sweep already does exactly one unconditional thing once a `DEPOSIT_FINALIZING` trade's deposit block height is at or before the current macro-finalized height: `Transition(trade.ID, StateDepositFinalizing, StateFunded, nil)`. This design adds a second, equally unconditional hop immediately after it succeeds: `Transition(trade.ID, StateFunded, StateAwaitingRelease, nil)`. Both hops happen in the same sweep, so a trade never observably rests in `FUNDED` — by the time any client or watcher next reads it, it's already `AWAITING_RELEASE`. No new condition is introduced; a finalized deposit is definitionally sufficient to say "waiting on the seller now."

## Backend: `TradesForWallet`

New `(*MarketplaceStore) TradesForWallet(address string) []MarketplaceTrade`, structurally identical to the existing `TradesInState` (mutex-guarded, copies matching trades out under the lock), matching any trade where the given address (compared the same case/spacing-insensitive way as everywhere else in this store) equals either `Seller` or `Buyer`. New handler `marketplaceTradesByWalletHandler`, registered at `GET /api/marketplace/trades/by-wallet/{address}`, mirroring `handleByAddressHandler`'s existing path-segment convention (not a query parameter) and its "just return what's there, empty array if none" response shape — no distinct 404 case, since "no trades" isn't an error.

## Frontend: `/marketplace/trades` page

`DesktopMarketplaceTradesPage.vue`:
- Requires a connected Hub wallet — same connect-prompt empty state already used by the sell page (reuse the pattern, not a new one).
- On mount (and once on connect), fetches `GET /api/marketplace/trades/by-wallet/{address}`.
- Renders each trade as: `@handle`, a role label (`Buying` if the connected address is `buyer`, `Selling` if `seller` — a trade can't be both, since a wallet can't buy its own listing), the trade's current `state`, and a link to `/marketplace/trades/:id`.
- Empty state: "No trades yet" with a link back to `/marketplace` to browse.
- Added to `DesktopShell.vue`'s nav, next to the existing "Marketplace" link. The sell page's post-listing success panel and the buy page's post-purchase redirect both continue to work as they do today (the sell page's share link goes to the *listing*, not this page; this page is reached via nav, not a redirect target — no existing flow needs to change to point here).

## Tests

- Escrow watcher: a `DEPOSIT_FINALIZING` trade past the macro-finality height reaches `AWAITING_RELEASE` (not `FUNDED`) after one `Sweep()` call.
- `TradesForWallet`: returns trades where the address matches either role, case/spacing-insensitively; returns an empty slice (not nil-panic) for an address with none.
- Handler: `GET /api/marketplace/trades/by-wallet/{address}` returns the matching trades as JSON, empty array for no matches.
- `DesktopMarketplaceTradesPage`: connect prompt when disconnected; renders fetched trades with correct role labels; empty state when the list is empty; links resolve to the right trade IDs.
