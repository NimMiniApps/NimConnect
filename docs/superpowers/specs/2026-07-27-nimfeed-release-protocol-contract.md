# NimFeed RELEASE Protocol Contract

**Date:** 2026-07-27
**Status:** Ready for NimFeed implementation

This is the exact contract NimConnect's `RELEASE` implementation
(`backend/handles.go`, `packages/profile-client`) commits to. NimFeed's
resolver must match every value here before either reader enables release
handling — implemented ahead of an agreed activation height is safe (the
type byte is unrecognized until then); enabling recognition on only one side
is not.

## Type byte

`RELEASE = 0x07` in the shared type namespace already defined in
`NimFeed/src/protocol/constants.js`:

```js
export const TYPES = Object.freeze({
  PROFILE_CLAIM: 0x01,
  POST_INLINE: 0x02,
  POST_START: 0x03,
  POST_CHUNK: 0x04,
  FOLLOW: 0x05,
  UNFOLLOW: 0x06,
  RELEASE: 0x07,
})
```

## Payload shape

Identical to a claim, no target address:

```text
raw binary (Hub):          "NF" 0x01 0x07 <handle>
text envelope (Nimiq Pay): "NFH:" + hex(raw payload)
```

## Activation height

A release is honored only for a transaction at or after a fixed block
height, agreed and hardcoded identically on both sides before deployment.
`0x07` before that height is unrecognized data, exactly as it is today —
this is what prevents any already-mined transaction that happens to contain
these bytes from being retroactively reinterpreted as a release.

**Action for NimFeed:** pick the activation height jointly with NimConnect's
`RELEASE_ACTIVATION_HEIGHT` deployment value; do not deploy independently
with a different height.

## Resolver semantics

Replay `(block_height, tx_index)` ascending as a per-username state machine:

- `CLAIM` assigns ownership only if the username is currently unowned.
- `RELEASE` (at or after the activation height) clears ownership only if its
  resolved signer is the username's current owner; from any other signer, or
  before the activation height, it is a recorded no-op.
- HTLC-routed transactions resolve to their creating wallet (NimFeed already
  does this for claims — apply the same resolution to releases).

## Required schema change

NimFeed's `profile_claims` table is primary-keyed `[username+address]`
(`NimFeed/src/db/schema.js`), which silently overwrites history: if an owner
claims, releases, and later reclaims the same username, the later claim
event replaces the earlier row and the release is lost.

Replace this with an **append-only event log**, one row per on-chain event
(claim or release), keyed by transaction identity/order
(`tx_hash` or `[block_height+tx_index]`) — never by `[username+address]`.
`getWinningClaim` becomes a resolver that replays this log through the state
machine above, not a single-table earliest-row lookup.

## Rollout

1. NimFeed implements the schema migration and resolver above, gated by the
   same activation height NimConnect uses, deployed but inert until that
   height is reached.
2. Full rescan of existing history through the new resolver (a release can
   only apply at or after the agreed activation height, so this rescan
   cannot change any handle's current owner before that point).
3. Confirm NimConnect and NimFeed resolve to the same owner for a shared set
   of test fixtures (claim, release, reclaim, non-owner release, HTLC-routed
   claim) before the activation height is reached on mainnet.
