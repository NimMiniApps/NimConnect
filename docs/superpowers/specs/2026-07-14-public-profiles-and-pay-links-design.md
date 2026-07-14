# Public Profiles (@handles) & Public Payment Pages — Design

Date: 2026-07-14
Status: approved pending review

## Positioning

The public resolve API is intentionally designed to become shared
infrastructure for the Nimiq ecosystem: any mini app can support
"Send to @username" without building its own username system. The chain is the
registry; NimConnect's backend is one (replaceable) indexer of it.

## Goal

Make NimConnect useful to people who don't have it (yet), and lay the seed for a
Nimiq-ecosystem contact layer:

1. **Payment request links** a non-user can open and pay — amount, message,
   address, QR — no app, no account.
2. **On-chain @handles** (`@chuck`): a claimable, permanent, chain-verified
   identity bound to a Nimiq address, with a public profile page and a public
   resolve API other mini apps can use.

## Non-goals

- Handle transfers, releases, or marketplace. The shared NimFeed protocol has
  no release type — claims are permanent. If releases are ever wanted, extend
  the NimFeed protocol and both apps adopt it together.
- Third-party write access to profiles. Read-only resolve API only.
- Running our own Nimiq node (public API now; swappable later).

## 1. On-chain handle registry

- **Shared registry with NimFeed** (decision revised 2026-07-14; both projects
  have the same owner): `@chuck` is ONE identity across NimFeed, NimConnect,
  and anything else that indexes the chain, and every existing NimFeed
  username resolves in NimConnect from day one.
- **Claim** = dust transaction to the NimFeed **catalog address** (mainnet
  `NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y`) carrying a NimFeed
  `PROFILE_CLAIM` payload: raw binary `"NF" 0x01 0x01 <username> [0x00
  <display name>]` (Hub) or the `NFH:` + hex text envelope (Nimiq Pay).
  NimConnect sends username-only claims — display names live in the off-chain
  profile.
  - Username: 3–31 chars, `[a-z0-9_]`, lowercase (NimFeed's rules). Claims
    from inside Nimiq Pay are capped at 26 chars by the 64-char text
    transaction limit; longer names claim via NimFeed/Hub in a browser.
- **Resolution**: earliest valid claim by `(block_height, tx_index)` wins the
  handle, permanently binding handle → sender address. Later claims for the
  same handle are ignored. No release: claims are permanent.
- **Reserved names gate NimConnect's claim UI only.** Resolution always
  follows the chain — a reserved name claimed via NimFeed still resolves
  here, otherwise the shared namespace would fork between apps.
- **Finality / reorgs**: the indexer records a claim only once its tx is
  finalized per the RPC (Nimiq PoS has fast finality). Conflict resolution is
  always recomputed from chain order, so a late-discovered earlier claim
  displaces a wrongly-recorded winner.
- **Forward compatibility**: the indexer ignores non-`PROFILE_CLAIM` types
  (posts, follows, future NimFeed types), so protocol growth doesn't break it.
- **Reserved list**: loaded from `reserved-handles.json` at startup (built-in
  default set: nimiq, nimconnect, admin, support, wallet, pay, official, …);
  gates the claim UI and availability check only — never resolution.
- The chain is the source of truth. Any product can independently index claims;
  NimConnect's backend is a convenience indexer, not an authority.

## 2. Backend (Go): claim indexing + profile store

### Claim ingestion
- **Fast path**: after sending a claim tx, the app `POST /api/handles/claims`
  with the tx hash. Backend fetches the tx from public RPC, verifies recipient
  = registry address, payload decodes to a valid claim, tx is confirmed, then
  records it.
- **Reconciliation**: periodic poll (interval ~minutes) of the registry
  address's inbound transactions via the public API, to catch claims submitted
  outside the app and enforce chain-order conflict resolution.
- `ponytail:` single public API dependency (nimiqscan / public RPC); swap to a
  self-hosted node by changing one base URL.

### Profile content (off-chain, signed, keyed by ADDRESS)
- Profiles belong to an **address**, not a handle. The handle merely resolves
  to the address (`handle → address → profile`), so releasing/reclaiming a
  handle never orphans or transfers profile data.
- `PUT /api/profile/{address}`: body contains the profile payload (only fields
  the user chose to share: display name, bio, website, github, x, tags), an
  `updated_at` timestamp, plus `public_key` + `signature` over a canonical
  message covering payload + `updated_at` — same verification scheme as the
  existing inbox. Accepted only if the key matches the address AND
  `updated_at` is newer than the stored profile's (replay protection).
- Deleting/unpublishing: signed `DELETE /api/profile/{address}`.
- Storage: file-based store, same pattern as the inbox store. Size caps on the
  payload (bio length etc. mirror the existing SharedProfile limits).
- Schema evolution: the profile is JSON; new optional fields (generic
  `links[]`, `avatar_url`, `metadata{}`) can be added later without breaking
  readers. Deliberately NOT built now (YAGNI).

### Public read API (the ecosystem seed)
Two independent concerns, two endpoints — apps that only need address lookup
never touch profiles:
- `GET /api/resolve/{handle}` → `{ handle, address, claim_tx }`.
- `GET /api/profile/{address}` → `{ address, updated_at, profile: {…} }`.
- Both public, no auth, CORS-open, with `ETag` (from `updated_at` / claim tx)
  and `Cache-Control` headers — profiles rarely change and cache well.
- `GET /api/handles/check?h=chuck` → availability. **Advisory only** — the
  chain is authoritative; the UI must present it as "looks available", and
  handle the claimed-first failure after tx confirmation.
- Deferred until a caller exists: batch resolve (`POST /api/resolve`), search
  (`/search?q=`). Both are additive, non-breaking.

## 3. Frontend: claim + publish flow ("choose what to share")

- **My Profile page**: "Claim your @handle" → input with live availability
  check → send the dust claim tx via the Pay SDK → backend fast-path POST →
  claimed state shown once confirmed.
- **Publish sheet**: per-field checkboxes (display name, bio, website, github,
  x, tags). Only checked fields are uploaded, signed by the wallet key.
  Editable / fully unpublishable anytime. **Everything defaults to private**:
  nothing leaves the device unless explicitly published — the local-first
  stance is a selling point, keep it front and center in the UI copy.

## 4. Public profile page — `nimconnect…/@chuck`

- Nginx routes `/@*` to the Go backend. Backend serves an HTML shell with OG
  meta tags (name, bio, identicon image URL) so links preview properly in
  WhatsApp/Telegram/X — generated OG *images* (identicon + name + @handle
  card) are later polish, not now — then the SPA takes over and renders:
  identicon, name, @handle, verified address (chain-claim link), bio, socials,
  tags, **Send NIM** (QR + `nimiq:` link + "Open in Nimiq Pay"), and
  **Add to NimConnect**.
- Works for anyone, logged-out, any browser.

## 5. Public payment-request page (client-side only)

- `makePaymentShareLink()` targets NimConnect's own origin instead of
  `nimpay.app/miniapps/open/…`.
- When the SPA is opened outside Nimiq Pay with `#/pay?r=…`, render a public
  request view instead of the generic install landing: requester (label),
  amount, message, QR of the `nimiq:` URI, full address + copy, "Pay with
  Nimiq Pay" (deep link via NIMPAY_OPEN_URL), store links.
- Request data stays in the URL — ephemeral, serverless, no privacy surface.
- The payload stays the standard `nimiq:` request URI (any wallet can parse
  it); we deliberately do NOT wrap it in a custom versioned format. Future
  extras (expiry, invoice ID, asset) go in additional query params alongside
  `r=` — non-breaking.

## Error handling

- Claim tx invalid / handle already taken at confirmation time: UI shows
  "handle was claimed first" and offers to retry with another handle.
- Public API down: claim UI degrades (no availability check, warn before
  sending); public pages show a friendly retry state.
- Profile PUT with stale/invalid signature: 401, no state change.

## Testing

- Go: claim payload encode/decode, chain-order conflict resolution (table
  tests), signature verification, reserved list, availability endpoint.
- TS (vitest): claim envelope encode/decode, `#/pay?r=` public-view parsing,
  publish payload field filtering.
- Manual E2E: claim → publish → open `/@handle` logged out on a phone → pay
  via QR; send a request link to a non-user device and pay it.

## Build order (each step shippable alone)

1. Public payment-request page (§5) — client-side only, immediate adoption win.
2. Registry backend (§1+§2): claim protocol, ingestion, resolve API.
3. Claim + publish flow in the app (§3).
4. Public profile page with OG previews (§4).

## Open items (decide during implementation)

- Registry address: generate a dedicated address (key held by maintainer) —
  only its *inbound* txs matter, so the key is not security-critical.
- Which public chain API: nimiqscan vs public RPC endpoint — pick whichever
  exposes "list inbound txs for address" + "get tx by hash" most simply.
