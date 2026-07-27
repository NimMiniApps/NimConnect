# Handle Marketplace — Design

**Date:** 2026-07-27
**Status:** Draft

## Revision note

This revision replaces the earlier HTLC settlement design with
NimConnect-controlled custodial escrow. The change is deliberate:

- Neither the public Hub API nor the Nimiq Pay Mini App SDK currently exposes
  the complete HTLC proof-signing surface the earlier design required.
- A client-held trade key would make the client part of the trusted settlement
  path, which is not acceptable for this marketplace.
- The existing 64-byte transaction-data limit rules out a general
  `TRANSFER(handle, buyerAddress)` payload for the supported handle lengths.

The marketplace therefore keeps the existing small `RELEASE` followed by
`CLAIM` protocol and makes the NimConnect server the authoritative financial
middleman. The buyer and seller do not trust each other, but both explicitly
trust NimConnect to hold the buyer's funds temporarily, observe the canonical
registry result, and execute exactly one payout or refund.

## Problem

Handles claimed on the shared on-chain registry (`HANDLE_REGISTRY_ADDRESS`,
`packages/profile-client/src/registry.ts`) are permanent:
`resolveHandleRegistry` picks the earliest claim per handle and there is no way
to give one up. Users who want to trade a handle currently have no protocol
mechanism or protected payment flow.

The registry is shared protocol, not NimConnect-only. NimFeed reads the same
on-chain data and owns the existing type-byte namespace
(`NimFeed/src/protocol/constants.js`). Every reader must interpret claim and
release events identically, including historical events.

## Goals

- Add a shared `RELEASE` event that lets the current owner give up a handle
  without exceeding the existing Nimiq Pay transaction-data limit.
- Support fixed-price handle sales using wallet operations available in both
  Hub and the Nimiq Pay Mini App SDK today.
- Make the NimConnect server authoritative for order state, escrow accounting,
  chain verification, payout, and refund. Client-reported state is never
  trusted.
- Pay the seller only after the exact buyer is the macro-finalized registry
  winner.
- Refund the buyer's full escrowed sale price if the trade fails. NimConnect
  absorbs the outbound refund transaction fee and collects no marketplace fee
  on a failed trade.
- Collect a marketplace fee only on a completed trade.
- Preserve an append-only, auditable record of every financial and marketplace
  state transition.

## Non-goals

- Non-custodial settlement. NimConnect deliberately holds buyer funds during an
  active trade.
- Auctions, negotiated offers, or partial payments. Listings are fixed-price
  and must be funded by one exact payment.
- True atomicity between handle ownership and payment. `RELEASE` and `CLAIM`
  are separate transactions, and Nimiq has no general contract scripting that
  can make their outcome atomic with a server payout.
- Eliminating the public sniping window after `RELEASE`. A failed or sniped
  trade refunds the buyer, but the seller can still lose the handle without
  payment. This is an explicit seller risk.
- A general `TRANSFER` event. Embedding the buyer's address does not fit the
  64-byte Nimiq Pay text-transaction limit for the supported handle lengths.
- Treating `validityStartHeight` as a timelock or an ordering primitive. It is
  used only to keep a signed transaction fresh.

## Protocol change: `RELEASE`

`0x02` is already `POST_INLINE` in the shared type namespace
(`NimFeed/src/protocol/constants.js:4`). Reusing it would make NimConnect read a
release where NimFeed reads a post. The next unused shared byte is `0x07`:

```text
PROFILE_CLAIM = 0x01
POST_INLINE   = 0x02
POST_START    = 0x03
POST_CHUNK    = 0x04
FOLLOW        = 0x05
UNFOLLOW      = 0x06
RELEASE       = 0x07
```

The payload shape is identical in size to an existing profile claim:

```text
raw binary (Hub):          "NF" 0x01 0x07 <handle>
text envelope (Nimiq Pay): "NFH:" + hex(raw payload)
```

No buyer address or marketplace order ID is embedded. This preserves support
for the same handles that already fit the Nimiq Pay claim envelope. A transfer
payload containing a 20-byte buyer address would require
`4 + 2 * (4 + handleBytes + 20) = 52 + 2 * handleBytes` text characters. It
would fit the 64-character envelope only for handles of six bytes or fewer and
is therefore not a usable general protocol.

### Activation height

`0x07` was previously unknown and ignored. Existing history must not be
retroactively reinterpreted if an old transaction happens to contain bytes
that look like a release.

NimConnect and NimFeed must share a fixed activation block height:

- `RELEASE` before the activation height remains an ignored unknown event.
- `RELEASE` at or after the activation height participates in registry replay.
- Both readers must deploy the same constant before either enables marketplace
  release actions.

### Registry semantics

Registry history is replayed in `(blockHeight, transactionIndex)` order:

- `CLAIM(handle)` assigns the handle only when it is currently unowned.
- `RELEASE(handle)` clears the handle only when its resolved signer is the
  current owner.
- Any other claim or release is retained in history but is a no-op.

After a valid release, the first valid subsequent claim wins. Marketplace
status, escrow status, or a server-issued trade ID has no effect on this
on-chain rule.

Nimiq Pay can route a transaction through an HTLC account. Every reader and the
marketplace verifier must compare the resolved controlling wallet
(`owner_address`), not blindly compare the raw transaction sender.

## Cross-reader migration

NimFeed currently stores claims keyed by `[username+address]` and resolves the
earliest one. That representation cannot retain an interleaved sequence such
as owner A claiming, releasing, and later reclaiming the same handle.

Adopting `RELEASE` requires:

- An append-only event log containing every claim and release, keyed by
  transaction identity/order rather than username and address.
- Chronological replay using the registry state machine above.
- A full historical rescan through the new resolver.
- Shared fixtures proving NimConnect, `packages/profile-client`, and NimFeed
  produce the same owner for the same ordered event stream.
- Coordinated activation using the same activation height.

This is a real NimFeed schema and resolver migration, not merely a mirrored
constant.

## Marketplace architecture

### Authoritative server

The backend is the source of truth for listings, reservations, trades,
deadlines, financial liabilities, and settlement operations. The frontend may
request an action and present wallet results, but the server independently
verifies all signatures and on-chain transactions.

Client choreography is not the registry truth. Once an exact escrow deposit has
been observed for an active trade, any protocol-valid release by the expected
seller and any subsequent protocol-valid claim by the bound buyer are
recognized from canonical history, even if the deposit or registry events are
still awaiting macro finality or were broadcast outside the expected UI.
Otherwise a participant could deliberately use a different client, produce the
real on-chain outcome, and still try to trigger a refund.

The marketplace consists of:

- A marketplace API and persisted trade state machine.
- A pooled NimConnect-controlled NIM escrow wallet.
- An escrow-address watcher separate from `HandleSyncer`.
- The registry watcher/resolver extended with `RELEASE`.
- An idempotent settlement worker for payouts and refunds.
- Notifications for buyer readiness, release, claim, settlement, and failure.

`HandleSyncer` only watches the registry address. Escrow deposits go to a
different NimConnect address and require their own watcher.

### Pooled escrow and deposit reference

All buyers pay one server-controlled escrow address. Each trade receives a
cryptographically random 16-byte reference encoded in a short, versioned data
field, for example:

```text
NME1:<22-character base64url trade reference>
```

This is 27 ASCII bytes and fits comfortably in the 64-byte basic-transaction
data field. It is used only on the escrow payment; it does not change the
registry `RELEASE` or `CLAIM` payload.

A deposit is accepted only when:

- Its reference maps to one live trade.
- Its amount equals the snapshotted listing price in Luna exactly.
- Its resolved payer is the buyer bound to that trade, including HTLC-routed
  sender attribution where applicable.
- It has not already been assigned to another trade.
- It is macro-finalized.

Wrong-reference, duplicate, partial, underpaid, overpaid, expired, or otherwise
unattributable deposits never advance a trade. They enter manual review rather
than triggering automatic refunds that could be abused with dust transactions.

### Signed marketplace intents

Listings and purchase orders are authenticated separately from their on-chain
transactions.

The seller signs a domain-separated listing intent containing at least the
handle, seller address, price in Luna, fee, expiry, nonce, and protocol version.
The buyer signs a purchase intent containing at least the trade ID, buyer and
refund address, snapshotted price, expiry, nonce, and protocol version.

The server verifies each signature and verifies that its public key resolves to
the claimed wallet address. A message signature authorizes only the marketplace
intent; it is never treated as an on-chain transaction signature.

For the MVP:

- Seller payout goes to the resolved wallet that owned the handle when the
  listing was accepted.
- Buyer refund goes to the wallet bound by the signed purchase intent.
- A different payout or refund address is not accepted.

## Wallet transaction choreography

### Hub and Nimiq Pay have different signing behavior

Hub's public `signTransaction` returns a serialized signed transaction without
broadcasting it. NimConnect can submit exact fields for approval, receive the
result, verify it, persist it, and broadcast it through the backend.

The Nimiq Pay Mini App SDK exposes `sendBasicTransactionWithData`, which signs
and broadcasts in one wallet-approved action and returns a transaction hash. It
does not expose transaction sign-only. Its arbitrary-message signature cannot
be converted into a transaction proof.

The server supports both paths:

- **Hub:** verify the returned serialized transaction against the server-issued
  intent before persisting or broadcasting it.
- **Nimiq Pay:** ignore client claims of success and independently locate and
  verify the resulting on-chain transaction against the server-issued intent.

Intent matching decides whether the backend will broadcast a returned
transaction or accept a client callback as evidence. It does not override
canonical registry semantics. The registry watcher still recognizes an
otherwise valid release or buyer claim sent through another client.

### `validityStartHeight` is freshness, not sequencing

Nimiq currently considers a transaction valid at block `h` when:

```text
h >= validityStartHeight - BLOCKS_PER_BATCH
h <  validityStartHeight + TRANSACTION_VALIDITY_WINDOW_BLOCKS
```

With the current policy that is a 60-block early tolerance and a 7,200-block
window. A future `validityStartHeight` is therefore not a strict "do not include
before" condition and cannot make `RELEASE` and `CLAIM` atomic or guarantee
their order.

For each release or claim, the server obtains the current height from its own
consensus-established RPC, creates a fresh intent, and accepts only a returned
transaction whose network, sender, registry recipient, value, fee, data, flags,
and validity height match that intent. If it expires, the server requests a new
wallet approval; it never edits or reuses an expired signature.

The server does not ask the buyer to pre-sign `CLAIM` before a release is
confirmed. The client receives its own signed transaction and could broadcast
it independently, so pre-signing cannot be treated as server-exclusive control.

## Trade flow

### 1. List

The seller submits a signed fixed-price listing. The server:

- Resolves the current registry owner and requires it to match the seller.
- Rejects a second active listing for the same handle.
- Stores price and fee as integer Luna.
- Requires `price > fee >= 0`, a positive seller payout, and configured minimum
  and maximum trade values.
- Snapshots the current winning claim transaction as the ownership epoch.
- Clearly discloses that a snipe or absent buyer can cost the seller the handle
  without payment.

### 2. Reserve

The first valid buyer reservation wins an atomic database race. Only one trade
may be active for a listing.

The server revalidates seller ownership, creates the random escrow reference,
snapshots all amounts and addresses, and gives the buyer a short funding
deadline. An unfunded reservation may expire without an on-chain action.

### 3. Fund escrow

The buyer signs the purchase intent and sends exactly the listed price to the
escrow wallet with the trade reference.

- Hub uses an ordinary checkout/payment with the reference as `extraData`.
- Nimiq Pay uses `sendBasicTransactionWithData`.

The escrow watcher verifies the deposit independently. The trade moves to
`FUNDED` only after macro finality. Until then it remains provisional and the
seller is never asked to release.

The buyer's original inbound network fee is not part of escrow and cannot be
refunded. "Full refund" means the full sale price received into escrow.

### 4. Establish claim readiness

Before enabling the seller's release action, the server requires:

- A funded, macro-finalized escrow liability.
- The seller still being the current owner for the snapshotted ownership epoch.
- A healthy registry watcher, escrow watcher, database, signer, and refund
  reserve.
- The buyer being actively connected and explicitly acknowledging readiness to
  claim.

Readiness reduces the seller's risk but is not a guarantee: the buyer can still
disconnect or refuse after release.

### 5. Release

The server issues a fresh, exact `RELEASE` transaction intent to the seller.

- With Hub, the server verifies and broadcasts the signed result.
- With Nimiq Pay, the wallet broadcasts and the server independently verifies
  the chain transaction.

A confirmed release immediately advances the trade to `AWAITING_CLAIM` and
triggers the buyer notification. The release remains provisional until macro
finality, and no money moves yet.

If the expected seller independently broadcasts a protocol-valid release after
the trade's exact deposit has been observed, the watcher records and follows
that release even if funding is still finalizing. The server cannot pretend the
release did not happen merely because it did not use the issued intent. Payout
still waits for macro-finalized funding and ownership.

### 6. Claim

Only after the release is confirmed does the server issue a fresh, exact
`CLAIM` intent to the bound buyer.

- With Hub, the server verifies and broadcasts the signed result.
- With Nimiq Pay, the wallet broadcasts and the server independently verifies
  it.

The server checks the resolved controlling wallet rather than only the raw
transaction sender. A claim from any other wallet is a competing public claim,
not fulfillment of the marketplace trade.

Conversely, any protocol-valid claim by the bound buyer after the recognized
release fulfills the ownership side of the trade, even if the buyer sent it
outside the marketplace UI. If that buyer becomes the macro-finalized winner,
the seller must be paid; refunding the buyer would give them both the handle and
the sale price.

### 7. Resolve

The server replays canonical registry history through the shared resolver. It
does not settle from a transaction hash, client callback, mempool observation,
or a single reversible micro-block.

Settlement becomes eligible only when:

- The release and winning claim are in canonical history.
- The release belongs to the expected ownership epoch.
- The exact bound buyer is the resolved owner.
- That registry state is macro-finalized.

The release and claim do not have to be the exact transaction hashes returned
through the intended wallet flow. They must satisfy the shared protocol, occur
in the correct release epoch, and resolve to the expected seller and buyer.

If a reorganization removes or reorders provisional events, the trade rolls
back to the matching earlier state and the server re-prompts while its deadline
and transaction validity allow.

### 8. Pay or refund

If the buyer is the macro-finalized winner, the settlement worker sends:

```text
seller payout = sale price - marketplace fee
```

The marketplace fee is recognized only after the payout is submitted. The
outbound payout network fee is an operating cost paid from the marketplace fee
or operating reserve; it is never silently deducted from the seller's quoted
payout.

The buyer receives a full-principal refund and the seller receives no payment
when:

- The seller never produces a valid release before the deadline.
- The buyer never produces a valid claim before the post-release deadline.
- A different claimant wins.
- The expected release or claim is invalidated and cannot be retried in time.
- An operational safety gate fails after funding and the seller has not yet
  released.

NimConnect absorbs the refund transaction fee and collects no marketplace fee.
The buyer's original inbound network fee remains spent.

## Deadlines and cancellation

The marketplace uses short server deadlines, all comfortably within Nimiq's
transaction validity window:

- Reservation/funding deadline.
- Seller release deadline after macro-finalized funding.
- Buyer claim deadline after confirmed release.

Exact durations are configuration, not protocol constants, and are snapshotted
on each trade.

Before a valid release is observed, either party may cancel. If escrow was
funded, cancellation queues a full-principal refund.

After a valid release is observed, cancellation is impossible because the
seller may already have lost the handle. The trade must reach either:

- `SETTLED`, if the exact buyer wins; or
- `REFUNDED`, if the buyer does not win.

A released handle is never automatically relisted.

## Persisted state and accounting

At minimum, persist:

### `marketplace_listings`

- Listing ID and protocol version.
- Handle and snapshotted ownership-epoch transaction.
- Seller/payout address.
- Price and fee in Luna.
- Signed listing intent and nonce.
- Status and timestamps.

### `marketplace_trades`

- Trade ID and unique escrow reference.
- Listing ID, handle, buyer/refund address, and seller/payout address.
- Price, fee, payout amount, and all snapshotted deadlines.
- State and monotonic state-version number.
- Deposit, release, claim, payout, and refund transaction hashes.
- Canonical block height/index and macro-finality evidence for relevant events.
- Signed purchase intent.

### `escrow_ledger`

An append-only double-entry ledger recording deposits, buyer liabilities,
seller payables, marketplace fees, network-fee expenses, payouts, refunds, and
manual adjustments. Existing rows are never edited or deleted; corrections use
compensating entries.

### `settlement_operations`

One durable operation per attempted payout or refund, containing the
deterministic operation ID, intended transaction fields, serialized signed
transaction, transaction hash, broadcast state, retry state, and timestamps.

Database constraints enforce:

- One active listing per handle.
- One active trade per listing.
- One deposit assignment per transaction hash.
- Unique escrow references.
- At most one terminal financial result per trade: payout or refund, never both.

## Trade state machine

The persisted state machine is:

```text
LISTED
  -> RESERVED
  -> AWAITING_DEPOSIT
  -> DEPOSIT_FINALIZING
  -> FUNDED
  -> AWAITING_RELEASE
  -> RELEASE_CONFIRMING
  -> AWAITING_CLAIM
  -> CLAIM_CONFIRMING
  -> SETTLEMENT_PENDING
  -> SETTLED

Any pre-release failure after funding:
  -> REFUND_PENDING -> REFUNDED

Any post-release failure:
  -> FAILED_AFTER_RELEASE -> REFUND_PENDING -> REFUNDED

Ambiguous money or chain state:
  -> MANUAL_REVIEW
```

Every transition uses a database transaction and compares the expected current
state/version. Duplicate jobs, callbacks, watcher results, or retries are
idempotent no-ops.

The diagram shows the intended UI sequence, not an assumption that clients
obey it. Watchers may record an out-of-band release or claim from any
nonterminal state after an exact deposit is observed. Settlement then evaluates
all funding and ownership prerequisites from canonical history rather than
discarding the event because it arrived "too early" for the UI state.

## Custody and trust surface

### What users trust NimConnect to do

- Keep escrow funds solvent and available.
- Never pay before the exact buyer is macro-finalized as owner.
- Refund the full escrow principal when the trade fails.
- Protect the custody signing key.
- Remain available through release, claim, payout, and refund.
- Operate the registry resolver correctly.

A compromised or malicious backend can steal, freeze, or misdirect escrowed
funds. The product must describe the flow as custodial escrow, not trustless or
non-custodial.

### What the server does not trust

The server does not trust:

- A client-supplied transaction hash or status.
- A client-supplied sender, owner, amount, fee, height, or finality claim.
- A signed transaction until every field is decoded and matched to the stored
  intent.
- A registry API snapshot without canonical replay.
- A micro-block inclusion as final settlement.

The inverse is also enforced: a canonical protocol-valid event is not ignored
merely because a client omitted its callback or used a different wallet UI.

### Seller risk

The public interval between release and claim cannot be eliminated with this
protocol. A competing claimant can win, or the buyer can disappear after the
seller releases. In either case the buyer is refunded and the seller receives
no payment, but the seller may have permanently lost the handle.

The UI must disclose this before listing and again before release.

## Custody controls

Before mainnet operation:

- Run escrow signing in an isolated service with an encrypted key and no
  private-key material in the application database, logs, traces, or error
  reports.
- Restrict the signer to persisted, server-validated payout/refund operations
  and enforce per-transaction and daily limits.
- Rate-limit reservations, cancellations, failed trades, and refunds per wallet
  and per handle. Apply cooldowns and a minimum trade value so colluding
  buyer/seller accounts cannot repeatedly force NimConnect to pay refund fees.
- Persist the signed outgoing transaction and its hash before broadcast. A
  crash may rebroadcast the identical transaction but must never construct a
  second payment.
- Maintain an operating NIM reserve large enough to pay full-principal refunds
  plus outbound transaction fees.
- Continuously reconcile:

  ```text
  spendable escrow balance
    >= outstanding buyer liabilities
     + queued seller payouts
     + queued refund fees
  ```

- Pause new reservations and disable seller release if reconciliation fails,
  the signer is unavailable, the registry watcher is stale, or refund capacity
  is insufficient.
- Provide an emergency pause that blocks new trades and releases while still
  allowing verified refunds.
- Test key recovery and settlement recovery before accepting real funds.

## Error handling

- **Wrong or missing deposit reference:** quarantine for manual review; do not
  start a trade.
- **Wrong amount or payer:** quarantine; do not combine partial payments in the
  MVP.
- **Duplicate deposit callback or watcher result:** no-op after the first
  durable assignment.
- **Late deposit after reservation expiry:** manual review and verified refund;
  never revive the old trade automatically.
- **Seller ownership changed before release:** invalidate the trade and refund
  the buyer.
- **Seller silent before release:** refund the buyer and optionally return the
  listing to `LISTED`.
- **Buyer silent after release:** refund the buyer; terminate the listing
  because the seller may no longer own the handle. Before refunding, replay
  canonical history once more to prove the bound buyer did not claim through a
  different path.
- **Competing claim wins:** refund the buyer; never pay the seller or collect a
  marketplace fee.
- **Release or claim reorganization:** roll back provisional registry state; do
  not roll back a macro-finalized settlement assumption because settlement is
  never executed before macro finality.
- **Payout/refund broadcast uncertainty:** query by the persisted transaction
  hash and rebroadcast the identical bytes when safe; never create a replacement
  operation without manual reconciliation.
- **Backend restart:** resume from persisted state and durable settlement
  operations. No correctness-critical state exists only in memory.
- **Signer, database, watcher, or RPC unhealthy:** block new release actions.
  If release has not occurred, queue refunds; if release already occurred,
  recover service and resolve the canonical winner before any financial action.

## Tests

### Shared protocol

- `RELEASE` builds and parses byte-for-byte as type `0x07` in backend,
  `packages/profile-client`, and NimFeed fixtures.
- Pre-activation `0x07` is ignored and the same payload at/after activation is
  honored.
- A release from the current owner clears the handle; a release from any other
  wallet is a recorded no-op.
- Claim/release/reclaim sequences replay identically across every reader.
- HTLC-routed registry transactions resolve to their controlling wallet.
- The full supported handle range fits the Nimiq Pay release envelope.

### Wallet behavior

- Hub returns a signed release/claim transaction without broadcasting; the
  server rejects any field that differs from its intent.
- Nimiq Pay direct-send results are accepted only after independent on-chain
  verification.
- A valid out-of-band seller release advances a funded trade, and a valid
  out-of-band claim by the bound buyer counts as fulfillment.
- A buyer who becomes the macro-finalized owner through another client causes
  exactly one seller payout and is never also refunded.
- Message signatures cannot be submitted as transaction proofs.
- Validity-height tests cover the 60-block early tolerance, 7,200-block window,
  expiry, and fresh re-signing. No test treats validity height as strict
  sequencing.
- The buyer is never asked to sign a claim before a release is confirmed.

### Escrow and state

- Exact deposits advance only after macro finality.
- Wrong reference, amount, payer, duplicate, or late deposits enter manual
  review and never fund a trade.
- Two buyers racing for one listing produce one reservation.
- Duplicate callbacks and jobs cannot skip or repeat a transition.
- Seller cancellation before release creates one full-principal refund.
- Seller silence creates one full-principal refund.
- Buyer silence after release creates one full-principal refund and no payout.
- A competing claimant winning creates one full-principal refund, no seller
  payout, and no marketplace fee.
- The exact buyer winning becomes payable only after macro finality.
- A reorganization before macro finality rolls provisional state back without
  releasing funds.

### Settlement and accounting

- Payout and refund are mutually exclusive for every trade.
- Crashes before signing, after signing, and after broadcast recover without a
  duplicate transfer.
- A successful payout sends the quoted seller amount and records the fee and
  network expense separately.
- Every failed trade refunds the full escrow principal; NimConnect pays the
  outbound fee.
- Ledger liabilities reconcile to on-chain escrow balances.
- Insufficient refund reserve, stale watchers, or an unavailable signer disables
  release.

## Rollout

1. Implement and test shared `RELEASE` parsing/replay in NimConnect,
   `packages/profile-client`, and NimFeed.
2. Deploy the NimFeed append-only event migration and full rescan with release
   handling still gated by the future activation height.
3. Implement the escrow wallet, ledger, watcher, settlement worker, solvency
   checks, and emergency pause.
4. Exercise successful, canceled, silent-buyer, silent-seller, snipe, reorg,
   crash-recovery, and wrong-deposit flows on Nimiq testnet using both Hub and
   Nimiq Pay.
5. Perform a custody-key recovery drill and ledger/on-chain reconciliation.
6. Deploy both readers with the same activation height.
7. Start mainnet with low per-trade and aggregate escrow limits and manual
   operational review.
8. Raise limits only after observed payout/refund and recovery behavior matches
   the ledger.

## Implementation gates

The spec remains Draft until all of the following are decided and documented:

- Marketplace fee and maximum network-fee policy.
- Reservation, release, and claim deadline defaults.
- Escrow key storage, recovery, and signer deployment.
- Maximum per-trade and aggregate escrow exposure.
- Manual-review and unexpected-deposit recovery procedure.
- Shared activation height and coordinated NimFeed deployment.
- Exact macro-finality evidence exposed by the production RPC/indexer.

## Revision history

- **2026-07-27 (custodial rewrite):** Replaced HTLC settlement with pooled
  server escrow; retained 64-byte-compatible `RELEASE`/`CLAIM`; added signed
  marketplace intents, authoritative server verification, Hub sign-only versus
  Nimiq Pay sign-and-send behavior, validity-height limits, macro-final payout,
  full-principal server-funded refunds, an explicit trade/ledger state machine,
  custody controls, and operational rollout gates.
- **2026-07-27 (HTLC review revisions):** Corrected the shared type collision,
  activation semantics, NimFeed replay migration, macro-finality threshold,
  transaction validity assumptions, HTLC wallet limitations, refund behavior,
  and buyer-versus-seller snipe losses in the earlier non-custodial proposal.
- **2026-07-27 (initial draft):** Proposed fixed-price handle trades using a new
  release event and HTLC settlement.
