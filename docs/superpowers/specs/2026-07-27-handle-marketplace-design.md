# Handle Marketplace — Design

**Date:** 2026-07-27
**Status:** Approved

## Problem

Handles claimed on the shared on-chain registry (`HANDLE_REGISTRY_ADDRESS`,
`packages/profile-client/src/registry.ts`) are permanent: `resolveHandleRegistry`
picks the earliest claim per handle and there is no way to give one up or move
it to another owner. Users who want to trade a handle currently have no
mechanism to do so, on-chain or otherwise.

The registry is shared protocol, not NimConnect-only — NimFeed reads the same
on-chain data (see `backend/handles.go`'s header comment). Any change to what
counts as a valid claim/release must be honored by every reader.

## Goals

- Let a handle's current owner give it up and let someone else claim it,
  enforced by the shared on-chain protocol so every reader (NimConnect,
  NimFeed) agrees on the result.
- Let a buyer and seller trade a handle for a fixed NIM price without either
  party trusting the other, and without NimConnect's backend custodying
  either party's funds.
- Protect the buyer: if the seller never follows through, the buyer's NIM is
  recoverable without manual intervention.
- Let NimConnect collect a fee per completed trade.

## Non-goals

- Auctions or negotiated offers — listings are fixed-price only.
- Eliminating the sniping window between a handle's release and the buyer's
  re-claim (accepted risk, see below).
- General-purpose escrow for anything other than handle trades.
- Migrating or grandfathering existing claims — this only affects trades made
  through the marketplace going forward.

## Protocol change: `RELEASE` claim type

Add `claimTypeRelease = 0x02` alongside the existing `claimTypeProfile = 0x01`
in `backend/handles.go`, mirrored in `packages/profile-client`. Payload shape
is identical to an existing claim:

```text
raw binary (Nimiq Hub):    "NF" 0x01 0x02 <handle>
text envelope (Nimiq Pay): "NFH:" + hex of the binary payload
```

No target address is embedded — this keeps the payload exactly as small as
today's claim, so it fits Nimiq Pay's 64-char text-transaction limit for the
same handle lengths (up to 26 chars) that claiming already supports. An
earlier design considered embedding the buyer's address directly (a true
`TRANSFER` type), which would make the handoff atomic and immune to sniping,
but at 4 + 2×(24+len) hex chars it only fits Pay's 64-char cap for handles
≤6 characters — unacceptable for a marketplace meant to work for any handle.

A `RELEASE` transaction must be signed by the handle's current owner. When the
registry rebuild (`resolveHandleRegistry` / `backend`'s equivalent) encounters
a valid `RELEASE` from the current owner, it removes that handle from the
registry as of that `(blockHeight, txIndex)`. Any `CLAIM` after that point
follows the existing earliest-wins rule, exactly as if the handle had never
been claimed.

**Sniping window:** between a `RELEASE` landing and the buyer's `CLAIM`
landing, the handle is genuinely open — anyone watching the chain could claim
it first. This is accepted as equivalent to the existing risk of claiming any
newly-available handle; it's mitigated operationally (see Trade flow, step 4)
but not eliminated.

## Trade flow

Funds move directly between the buyer and seller through Hashed Time-Locked
Contracts (HTLC) — NimConnect's backend never custodies NIM. Nimiq's account
types are limited to Basic, HTLC, Vesting, and Staking; HTLC is the only one
that supports conditional transfer, and its only conditions are a hash-preimage
reveal or a timeout. There is no way to make the HTLC redemption conditional on
a separate, independently-signed transaction (the seller's `RELEASE`) — Nimiq
has no general contract scripting. Full atomicity between payment and release
is therefore not achievable; the design below gets as close as the protocol
allows while keeping the backend fund-free.

1. **List.** Seller lists an owned handle with a fixed NIM price.
2. **Commit to buy.** The buyer's client generates a random secret `s` and
   computes `H = hash(s)`. It builds two HTLC transactions, both hash-locked
   on the same `H`, both refundable to the buyer after a fixed timeout
   (e.g. 48h):
   - `HTLC_seller`: amount = `price - fee`, recipient = seller.
   - `HTLC_fee`: amount = `fee`, recipient = NimConnect's fee address.

   The buyer also pre-signs their own `CLAIM` transaction for the handle.
   Both the secret `s` and the pre-signed `CLAIM` are sent to NimConnect's
   backend for automated relay — not to the seller.
3. **Backend confirms funding.** The chain watcher (extending the existing
   indexer-polling path used for claim detection, see the commit that made
   indexer POST failures pending after a successful claim tx) waits for both
   HTLCs to confirm before considering the listing "funded."
4. **Seller releases.** The seller signs and sends `RELEASE` for the handle
   from their own wallet. The instant the backend observes it (mempool, not
   waiting for confirmation, to minimize the sniping window), it:
   - broadcasts the buyer's pre-signed `CLAIM`;
   - hands `s` to the seller, who redeems `HTLC_seller` themselves;
   - redeems `HTLC_fee` itself, using the same `s` it already holds.
5. **Timeout path.** If no `RELEASE` lands within the timeout window, both
   HTLCs become refundable to the buyer. The buyer reclaims them with a
   standard HTLC timeout-redeem transaction. No backend action is required,
   and no fee is collected on a trade that didn't happen.

## Trust surface

- **Backend never holds NIM.** Funds sit in buyer-funded HTLC contracts;
  redemption requires the recipient's own key plus the preimage.
- **Backend does hold a short-lived secret.** Between receiving `s` from the
  buyer and relaying it to the seller, the backend must not disclose or use
  `s` for any purpose other than relaying it *after* `RELEASE` confirms.
  Releasing `s` early would let a seller redeem `HTLC_seller` without ever
  releasing the handle — this is the one operational invariant the whole
  trust model rests on.
- **Sniping window** (see above): accepted risk, unmitigated beyond firing the
  buyer's pre-signed claim as soon as `RELEASE` is seen.
- **Seller must be online** to redeem `HTLC_seller` after the backend relays
  `s`. Not blocking (their funds don't expire until the HTLC's own timeout,
  which is set well past the trade window), but worth a reminder notification.

## Error handling

- `RELEASE` from a non-owner is ignored by the registry rebuild, same as any
  other malformed or unauthorized claim data today.
- If the buyer's pre-signed `CLAIM` fails to broadcast (e.g. already
  invalidated by a chain reorg), the backend retries; if the handle is lost to
  a snipe, the buyer keeps their timeout-refund path — no NIM is at risk.
- If the backend crashes between observing `RELEASE` and relaying `s`, it
  must recover `s` from persisted state and complete the relay on restart —
  `s` is never derivable from anything else once generated, so it must be
  durably stored the moment the buyer submits it.
- A listing whose seller no longer owns the handle at purchase time (e.g. it
  was released or transferred outside the marketplace) is invalidated before
  the buyer funds anything.

## Tests

- `RELEASE` claim payload builds and parses byte-for-byte, mirrored between
  `backend/handles.go` and `packages/profile-client`.
- Registry rebuild: a valid `RELEASE` from the current owner frees the handle
  as of its `(blockHeight, txIndex)`; a `RELEASE` from any other sender is
  ignored; a `CLAIM` after a valid `RELEASE` wins the handle fresh.
- `RELEASE` payload fits Nimiq Pay's 64-char text-transaction limit for the
  same handle lengths the existing `CLAIM` supports.
- HTLC construction: `HTLC_seller` and `HTLC_fee` share the same hash root,
  sum to the listing price, and are both refundable to the buyer after the
  same timeout.
- Backend relay: `s` is only released after `RELEASE` is observed, never
  before; relay and `HTLC_fee` self-redemption both use the persisted `s`
  and survive a backend restart between observing `RELEASE` and relaying.
- Timeout path: an unreleased handle's HTLCs become refundable to the buyer
  after the timeout and are not collectible by the backend or seller.
- A listing is invalidated if the seller no longer owns the handle at
  purchase time.
