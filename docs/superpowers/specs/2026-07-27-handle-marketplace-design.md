# Handle Marketplace — Design

**Date:** 2026-07-27
**Status:** Draft

## Revision note

The first version of this spec was reviewed and found not implementation-ready:
`RELEASE = 0x02` collided with NimFeed's existing `POST_INLINE` type, the
trade flow could cost the buyer their money on a snipe, and the pre-signed
claim / mempool-reveal / Nimiq Pay assumptions didn't hold against the actual
protocol and wallet capabilities. All of that is corrected below. See
"Revision history" at the bottom for what changed and why.

## Problem

Handles claimed on the shared on-chain registry (`HANDLE_REGISTRY_ADDRESS`,
`packages/profile-client/src/registry.ts`) are permanent: `resolveHandleRegistry`
picks the earliest claim per handle and there is no way to give one up or move
it to another owner. Users who want to trade a handle currently have no
mechanism to do so, on-chain or otherwise.

The registry is shared protocol, not NimConnect-only — NimFeed reads the same
on-chain data and is the origin of the type-byte namespace (`NimFeed/src/protocol/constants.js`).
Any change to what counts as a valid claim/release must be defined once, in
that shared namespace, and honored by every reader.

## Goals

- Let a handle's current owner give it up and let someone else claim it,
  enforced by the shared on-chain protocol so every reader (NimConnect,
  NimFeed) agrees on the result — including historical data, which must not
  be retroactively reinterpreted.
- Let a buyer and seller trade a handle for a fixed NIM price without either
  trusting the other with funds directly, and without NimConnect's backend
  ever holding custody of either party's NIM.
- Never let a failed trade (snipe, timeout, backend outage) cost the buyer
  their money. A failed trade may cost the seller the handle without payment
  — that risk is inherent to a non-atomic protocol and must be disclosed, not
  hidden.
- Let NimConnect collect a fee per completed trade.
- Ship an MVP against wallet surfaces that actually support it today.

## Non-goals

- Auctions or negotiated offers — listings are fixed-price only.
- Eliminating the sniping window between a handle's release and the buyer's
  re-claim (accepted risk, redistributed so it only ever costs the seller,
  never the buyer — see Trade flow).
- True atomicity between payment and release. Nimiq's account types are
  Basic, HTLC, Vesting, and Staking; HTLC's only conditions are a
  hash-preimage reveal or a timeout, and Nimiq has no general contract
  scripting to make one transaction's validity depend on a second,
  independently-signed transaction. This is a hard protocol ceiling, not a
  gap this design tries to close.
- Nimiq Pay (mobile mini-app) support in the MVP — see Wallet surface below.
- Migrating or grandfathering existing claims — this only affects trades made
  through the marketplace going forward, and only after the activation height.

## Protocol change: `RELEASE` claim type

`0x02` is already `POST_INLINE` in the shared type namespace
(`NimFeed/src/protocol/constants.js:4`; confirmed as rejected-as-non-claim in
`backend/handles_test.go`'s existing test cases). Using it for release would
make NimConnect read a release where NimFeed reads a malformed post — an
immediate protocol fork. The next unused byte in that namespace is `0x07`
(`PROFILE_CLAIM=0x01, POST_INLINE=0x02, POST_START=0x03, POST_CHUNK=0x04,
FOLLOW=0x05, UNFOLLOW=0x06`). This spec allocates:

```
RELEASE = 0x07
```

as a value NimFeed's constants module must also define, so both readers
agree on the byte before either ships code that acts on it.

Payload shape is identical to an existing claim:

```text
raw binary (Nimiq Hub):    "NF" 0x01 0x07 <handle>
text envelope (Nimiq Pay): "NFH:" + hex of the binary payload
```

No target address is embedded — this keeps the payload exactly as small as
today's claim, fitting Nimiq Pay's 64-char text-transaction limit for the
same handle lengths (up to 26 chars) that claiming already supports. An
earlier version of this design considered embedding the buyer's address
directly (a true `TRANSFER` type), which would make the handoff atomic and
immune to sniping, but at 4 + 2×(24+len) hex chars it only fits Pay's 64-char
cap for handles ≤6 characters — unacceptable for a marketplace meant to work
for any handle.

**Activation height.** Because `0x07` was previously an unrecognized type
(silently ignored by every existing parser), any transaction already on
chain that happens to decode to `magic + version + 0x07 + <valid handle>` —
however unlikely — must not be retroactively treated as a release once this
ships. The registry rebuild only honors `RELEASE` transactions at or after a
fixed activation block height, chosen and hardcoded at deploy time in both
NimConnect's and NimFeed's rebuild logic. Transactions before that height
with type `0x07` continue to be ignored as unknown, exactly as today.

A `RELEASE` transaction must be signed by the handle's current owner. When
the registry rebuild encounters a valid, post-activation `RELEASE` from the
current owner, it removes that handle from the registry as of that
`(blockHeight, txIndex)`. Any `CLAIM` after that point follows the existing
earliest-wins rule, exactly as if the handle had never been claimed.

## Cross-reader migration (NimFeed)

NimFeed currently stores only claims, primary-keyed `[username+address]`
(`NimFeed/src/db/schema.js`), and always resolves the earliest one
(`NimFeed/src/db/queries.js`'s `getWinningClaim`). That key silently
overwrites history: if owner A claims, releases, and later reclaims the same
username, the later claim event replaces the earlier row and the release in
between is lost from the claims table — a separate `profile_releases` table
alongside it doesn't fix this, since ownership resolution still needs the
full interleaved order of claims and releases to be correct, not just the
existence of a release somewhere.

Adopting `RELEASE` requires, on NimFeed's side:

- An **append-only event log**, one row per on-chain event (claim or
  release), keyed by transaction identity/order (`tx_hash`, or
  `[block_height+tx_index]`) — never by `[username+address]`, so no event is
  overwritten regardless of how many times a username is claimed and released.
- A resolver that replays that log chronologically as a small state machine
  per username: a `CLAIM` assigns ownership only if the username is currently
  unowned; a `RELEASE` clears ownership only if sent by the address that
  currently owns it; anything else is a no-op, recorded but not applied. This
  also resolves the previous circularity — "release validity depends on
  current owner" is exactly what replaying prior events from the start
  determines, not something checked against a snapshot.
- A full rescan once deployed, replaying existing history through the new
  state machine rather than only applying it to new transactions.
- Coordinated deployment: both NimConnect and NimFeed must ship with the same
  activation height before either starts honoring `RELEASE`, or the two
  systems disagree about current ownership during the gap.

This is a real migration, not a mirrored-constants change — budget it as
its own piece of work in NimFeed, not a side effect of the NimConnect spec.

## Wallet surface: currently blocking, not just an MVP restriction

Neither wallet surface NimConnect can call today supports constructing or
signing an HTLC redemption proof — this affects Hub, not only Nimiq Pay.

- The Nimiq Pay mini-app provider (`@nimiq/mini-app-sdk/dist/provider.d.ts`)
  exposes only basic sends and staking operations. No HTLC methods at all.
- Nimiq Hub's public `signTransaction` (`@nimiq/hub-api`'s
  `SignTransactionRequest`) takes a basic sender/recipient/value/data shape —
  no `senderType`, preimage, or HTLC proof input. `@nimiq/core`'s generic
  `Transaction.sign()` is explicit: *"HTLC redemption is not supported and
  will throw."*
- Hub does have `SetupSwapRequest`/`RefundSwapRequest`, which is how Nimiq
  Pay's existing swap-routed claims redeem HTLCs today — but those are
  restricted to Nimiq's own trusted origins, not callable by a third-party
  app like NimConnect.

NimConnect holds no private keys itself (`src/services/hub.ts` only ever
delegates to Hub's checkout/sign flows) — there is no in-app fallback that
signs a raw HTLC proof locally without a supporting wallet API.

**This is a hard external dependency, not a scoping choice.** The HTLC-based
trade flow in this spec cannot be built against any wallet surface available
today. Before implementation can start, one of the following needs to be
true:
- Hub/Keyguard adds public support for HTLC regular-transfer and
  timeout-resolve signing, or
- NimConnect gets a trusted-origin exception for the existing swap-restricted
  methods, or
- the design falls back to the backend-held custodial escrow considered
  earlier in this process (buyer pays a NimConnect-controlled address
  directly; backend forwards to the seller after confirming `RELEASE`). That
  variant only needs ordinary basic sends, which both Hub and Pay already
  support — at the cost of the backend actually custodying buyer funds
  during a trade, which is the trade-off this design was built to avoid.

This spec does not resolve that choice — it should stay in Draft until an
answer comes back on the wallet-capability question.

## Trade flow

Funds move directly between the buyer and seller through Hashed Time-Locked
Contracts (HTLC) — NimConnect's backend never custodies NIM, but it does
custody a short-lived secret and controls transaction timing, so it is best
understood as a **trusted, non-custodial coordinator**: the buyer and seller
don't trust each other, but both trust the backend to sequence events
correctly and stay available.

Two timers matter and must stay clearly separated:

- **HTLC timeout** (e.g. 48h): the on-chain, protocol-enforced deadline after
  which the buyer can reclaim funds unconditionally. This is the outer bound
  and never changes once the HTLCs are funded.
- **Trade deadline** (e.g. 90 minutes, comfortably inside Nimiq's
  `TRANSACTION_VALIDITY_WINDOW_BLOCKS`, ~2h): a marketplace-level, backend-
  enforced window for the seller to release and the buyer to respond. It
  exists entirely to keep signed transactions fresh; missing it fails the
  trade but does **not** by itself return funds — the buyer still waits out
  the HTLC timeout to reclaim, same as any other failed trade.

Steps:

1. **List.** Seller lists an owned handle with a fixed NIM price.
2. **Commit to buy.** The buyer's Hub-connected client generates a random
   secret `s` and computes `H = hash(s)`. It builds two HTLC transactions,
   both hash-locked on `H`, both refundable to the buyer after the HTLC
   timeout:
   - `HTLC_seller`: amount = `price - fee`, recipient = seller.
   - `HTLC_fee`: amount = `fee`, recipient = NimConnect's fee address.

   The buyer does **not** pre-sign a claim transaction — Nimiq transactions
   are only valid for `TRANSACTION_VALIDITY_WINDOW_BLOCKS` (~2h) past their
   `validityStartHeight`, and a pre-signed claim would go stale long before a
   48h trade could resolve. Instead the buyer's client stays reachable
   (push/in-app prompt) for the trade deadline.
3. **Backend confirms funding.** `HandleSyncer` (`backend/handles_sync.go`)
   only fetches transactions involving the registry address — it can't see
   HTLC funding, which lands on a per-listing contract address. This needs a
   **separate escrow watcher**, one per active listing, that: polls each
   listing's `HTLC_seller`/`HTLC_fee` contract addresses (same "poll
   confirmed history" approach as `HandleSyncer`, no mempool watching added
   here either); validates the funding transactions match the listing's
   exact price split and hash root, not merely "some payment arrived";
   rejects or flags partial funding (only one of the two HTLCs funded, or
   funded for the wrong amount); and rejects a second buyer's funding attempt
   once a listing is already funded, so two buyers can't race to fund the
   same listing concurrently. The listing is marked funded, and the trade
   deadline starts, only once both HTLCs are validated and macro-finalized.
4. **Seller releases.** The seller signs and sends `RELEASE` for the handle.
   The backend's sweep picks it up once **confirmed** — not from the mempool,
   which can drop or reorder a transaction before it lands.
5. **Buyer claims.** On seeing a confirmed `RELEASE`, the backend prompts the
   buyer (who must respond within the trade deadline) to sign and broadcast a
   fresh `CLAIM` with a current `validityStartHeight`. The backend then waits
   for that `CLAIM` to confirm **and** for the registry rebuild to resolve the
   buyer as the actual winner (i.e. no one else's claim landed first for this
   release epoch).
6. **Settle only on a macro-finalized win.** A micro-block inclusion is
   reversible until the next macro block finalizes it — Nimiq's own finality
   model. Revealing `s` is irreversible, so the backend must wait for the
   buyer's claim to be part of a *macro-finalized* registry state (not merely
   "confirmed" in a micro block) before disclosing anything. Only then does
   it hand `s` to the seller (who redeems `HTLC_seller` themselves) and
   redeem `HTLC_fee` itself. If the buyer was sniped — someone else's claim
   wins the handle first — the backend never reveals `s`. Both HTLCs sit
   unredeemed until the HTLC timeout. **The buyer never loses money to a
   snipe; the seller loses the handle without payment.** This must be
   disclosed to sellers before they list. The same macro-finality bar applies
   to step 3's funding confirmation, not only to the winning claim.
7. **Trade-deadline miss.** If the seller doesn't release, or the buyer
   doesn't respond to claim, within the trade deadline, the trade is marked
   failed. No further backend action is taken; the buyer's funds sit in the
   HTLCs until the (separate, longer) HTLC timeout elapses. No fee is ever
   collected on a trade that didn't settle.
8. **Reclaiming after timeout is not automatic — it needs the buyer's
   signature.** A `TimeoutResolve` proof must be signed by the HTLC's
   original sender (`core-rs-albatross`'s `htlc_contract.rs`: the check is
   `signature_proof_sender.is_signed_by(&self.sender)`). Nothing executes
   this for the buyer without their key. In practice: the buyer's client
   detects the elapsed timeout and prompts them to sign and broadcast the
   reclaim — "automatic" here means "the client surfaces the prompt without
   the buyer having to remember," not "requires no action." If the buyer
   never returns to sign it, the funds remain protocol-recoverable by them
   indefinitely, but nobody else can trigger the reclaim on their behalf.

## Trust surface

- **Backend never holds NIM.** Funds sit in buyer-funded HTLC contracts;
  redemption requires the recipient's own key plus the preimage.
- **Backend does hold a short-lived secret and controls trade sequencing.**
  It must not disclose `s` until the buyer's `CLAIM` is a *confirmed
  registry winner*, not merely broadcast. Revealing `s` any earlier lets the
  seller redeem `HTLC_seller` without the handle ever changing hands. This is
  the single invariant the whole trust model rests on, and it depends on the
  backend staying available and honest through step 6 — the design does not
  make this trustless, only non-custodial of funds.
- **Sniping window** between a confirmed `RELEASE` and the buyer's `CLAIM`
  confirming as winner: real and unmitigated beyond prompting the buyer
  immediately. Cost of a snipe falls entirely on the seller (lost handle,
  no payment), never on the buyer.
- **Seller must be online** to redeem `HTLC_seller` after the backend relays
  `s`. Not blocking (the HTLC's own timeout is well past the trade window),
  but worth a reminder notification.
- **Buyer must be reachable within the trade deadline** to sign a fresh claim
  after the seller releases. Missing it fails the trade (funds still safe,
  just tied up until the HTLC timeout).

## Error handling

- `RELEASE` from a non-owner, or before the activation height, is ignored by
  the registry rebuild, same as any other malformed or unauthorized claim
  data today.
- If the buyer's `CLAIM` fails to confirm as the registry winner (snipe or
  broadcast failure), the backend takes no further action; the buyer's HTLC
  timeout path is unaffected and requires no backend involvement to execute.
- If the backend crashes between observing a confirmed `RELEASE` and
  relaying `s`, it must recover `s` from persisted state and resume from
  "waiting for buyer's claim to confirm as winner" on restart — `s` is never
  derivable from anything else once generated, so it must be durably stored
  the moment the buyer submits it, before any HTLC is even funded.
- A listing whose seller no longer owns the handle at purchase time (e.g. it
  was released or transferred outside the marketplace) is invalidated before
  the buyer funds anything.

## Tests

- `RELEASE` claim payload builds and parses byte-for-byte with type `0x07`,
  mirrored between `backend/handles.go` and `packages/profile-client`.
- A `0x07` payload before the activation height is ignored, not treated as a
  release; the same payload at or after activation is honored.
- Registry rebuild: a valid post-activation `RELEASE` from the current owner
  frees the handle as of its `(blockHeight, txIndex)`; a `RELEASE` from any
  other sender is ignored; a `CLAIM` after a valid `RELEASE` wins the handle
  fresh.
- `RELEASE` payload fits Nimiq Pay's 64-char text-transaction limit for the
  same handle lengths the existing `CLAIM` supports.
- HTLC construction: `HTLC_seller` and `HTLC_fee` share the same hash root,
  sum to the listing price, and are both refundable to the buyer after the
  same HTLC timeout.
- Backend relay: `s` is only released after the buyer's `CLAIM` is confirmed
  as registry winner, never on a merely-broadcast or mempool-observed
  transaction; relay and `HTLC_fee` self-redemption both use persisted `s`
  and survive a backend restart at any point in the flow.
- Snipe path: a competing claim confirming before the buyer's leaves `s`
  unrevealed; both HTLCs remain refundable to the buyer only, never
  redeemable by the seller or the fee address.
- Trade-deadline miss (seller silent, or buyer unreachable after release)
  fails the trade without collecting a fee; funds remain recoverable only via
  the HTLC timeout.
- A listing is invalidated if the seller no longer owns the handle at
  purchase time.

## Revision history

- **2026-07-27 (second revision):** Corrected the wallet-surface finding from
  "Nimiq Pay can't do it, use Hub" to "neither Hub nor Pay can construct or
  sign an HTLC redemption proof today" — this is now flagged as a blocking
  external dependency, not an MVP scoping choice, with a custodial fallback
  named explicitly as the only currently-buildable alternative. Fixed the
  reveal/funding threshold from "confirmed" to macro-block-finalized (micro
  blocks are reversible; revealing `s` is not). Corrected "buyer reclaims
  automatically" — a `TimeoutResolve` proof requires the buyer's own
  signature; nothing executes it for them. Replaced the NimFeed
  claims-plus-releases-table plan with an append-only event log and a
  chronological resolver, since the existing `[username+address]`-keyed
  table silently overwrites history on a reclaim and the earlier plan was
  circular (release validity checked against a snapshot that replay is
  supposed to produce). Added a dedicated escrow-funding watcher, since
  `HandleSyncer` only sees the registry address, not per-listing HTLC
  contracts, and it needs to guard against partial funding and concurrent
  buyers.

- **2026-07-27 (first revision):** Reallocated `RELEASE` from `0x02` (collided
  with NimFeed's `POST_INLINE`) to `0x07`, added an activation height to
  prevent retroactive reinterpretation of historical data, added the NimFeed
  migration section, dropped the pre-signed buyer claim in favor of an
  on-demand fresh signature (transaction validity is ~2h, incompatible with a
  48h trade window), separated the HTLC timeout from a shorter trade
  deadline, restricted the MVP to Hub (the installed Nimiq Pay provider
  can't build or redeem HTLCs), and fixed the reveal condition so `s` is only
  ever disclosed after the buyer's claim is a *confirmed registry winner* —
  closing the path where a snipe could previously still cost the buyer their
  money.
