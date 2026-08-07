# Ecosystem awards and the app registry

Status: approved — phases 1–3 implemented (items/trading still deferred)
Date: 2026-08-07

Companion docs, one per repo:
- `NimWorld/docs/plans/2026-08-07-cross-app-platform-design.md` — the consumer
- `NimiqMiniApps/docs/plans/2026-08-07-app-registry-for-nimconnect-design.md` — the registry

## Context

NimWorld needs three things NimConnect does not expose yet: a list of apps a
wallet has authorized, cross-app achievements, and eventually tradable app
items. Two of the three are much closer than they look.

`2026-08-05-full-scoped-authorization-design.md` already landed
audience-and-capability sessions: one signature grants a **registered app** an
exact scope set for seven days, and NimConnect persists the token hash with its
audience, wallet, expiry, revocation state and scopes. That record *is* the
connection — "which apps did I authorize" is a query over a table that already
exists.

The gap is what counts as a registered app. Today it is "apps owned by the
project" (`nimconnect`, `nimworld`). For an ecosystem it has to be any app in
the NimiqMiniApps catalog.

## Decisions

### 1. `GET /api/authorizations` — list a wallet's authorized apps

Session-authenticated, returns the caller's own live grants: audience/app id,
scopes, granted-at, expires-at. Revoked and expired rows excluded by default.

This is the smallest useful step and needs no registry work — NimWorld renders
a real "Connected apps" list from it, with Disconnect wired to the existing
revocation path.

### 2. The catalog becomes the client registry

Standard OAuth split, and each side keeps what it already owns:

| | Owns |
|---|---|
| **NimiqMiniApps** | app identity, verification, owner, name/icon, declared `requestedScopes`, allowed launch origins |
| **NimConnect** | wallets, grants, tokens, scopes, revocation |

An app registers once where developers already go (`POST /api/apps/submit` plus
the existing approve/verify flow), and NimConnect consumes that record when
issuing grants. What this buys:

- **Consent screens can show a verified identity** — name and icon from the
  catalog, with its verified flag. A fake app cannot borrow a real one's
  identity to farm scope grants. This is the highest-value property here,
  especially once tradable items exist.
- **Declared scopes become enforceable.** The NimWorld app manifest already
  carries `nimconnect.requestedScopes`; nothing binds it to what is granted.
  With the catalog as registry, NimConnect refuses a scope the app never
  declared, and the listing page can show the ask before install.
- **One app id everywhere** — awards keyed on the catalog's app id render in
  the plaza, on the catalog's app page, or on a NimConnect profile.

Requirements this puts on us:

- **Mirror minimal app records** (id, name, icon, verified, declared scopes,
  launch origins) so consent still works when the catalog is unreachable. An
  authorization server cannot depend on a registry's uptime.
- **Re-consent on ownership transfer.** A grant is wallet→app. The catalog has
  `/api/apps/{slug}/owners`; if an app changes hands, existing grants must not
  silently transfer with it.
- **Re-consent on scope escalation.** An app adding a scope in a revision never
  inherits it.
- **Exact-match launch origins.** `website_url` / `open_url` stop being
  descriptive fields and become an allow-list.

### 3. Awards: `POST /api/awards`

Achievements are NimConnect's because every Mini App has NimConnect and only
some are in NimWorld. Routing awards through a lobby would stop a non-plaza app
from awarding at all.

- Authenticated with the app's own key; body is the achievement envelope plus
  wallet and app id.
- **Idempotency key `(appId, achievementId, wallet)`** so a retry cannot
  double-award and an app replaying its history is harmless.
- Scopes `achievements:read` (and later `inventory:read`) join the existing
  scope set; `GET /api/profiles/{address}/achievements` honours a visibility
  field so a public profile panel cannot leak private ones.

NimWorld holds no award secrets and stores no awards. Its own `/events` feed
stays what it is: plaza-local decoration that grants nothing.

## Item trading — reuse the escrow machinery, mind one difference

`docs/escrow-architecture.md` already describes a working marketplace: pooled
escrow, reserve → deposit → release → claim → settle, `EscrowWatcher` and
`OwnershipWatcher` sweeping independently of the HTTP endpoints, an append-only
ledger, and atomic swap deliberately rejected in favour of release-then-claim.

App items should reuse that choreography rather than invent a second one. One
structural difference decides the design:

> A handle's canonical owner is **on-chain**, so `OwnershipWatcher` can
> re-derive trade progress from the registry and catch a release that never
> touched our API. An app item's owner is a **row in our database**. There is
> no independent source to reconcile against.

Consequences:

- The item equivalent of `OwnershipWatcher` verifies *our own* state machine, so
  it is a weaker check by nature. Compensate with an append-only item
  provenance log — the same discipline as `escrow_ledger`, per item instance.
- Escrow still earns its place: it protects the **buyer**, who otherwise pays
  and hopes. Item transfer is a database write we control, so
  deposit → transfer → settle can be made genuinely safe, with refund on
  failure — something a direct buyer→seller payment cannot offer.
- Items need instance identity (`instanceId` + `owner`) before any of this.
  A quantity alone cannot be traded: two players trade *that* item.

Not scheduled here — flagged so item trading starts from the escrow design
rather than from scratch.

## Phasing

1. `GET /api/authorizations` (no registry work) — unblocks NimWorld immediately
2. Catalog as registry: mirror records, consent screen identity, declared-scope
   enforcement, re-consent rules
3. Awards: `POST /api/awards`, `achievements:read`, profile read endpoints
4. Items and trading, on the escrow choreography

## Open questions (resolved for phases 1–3)

- App award credentials are issued by NimConnect admin
  (`POST /api/admin/apps/{audience}/api-key`); catalog registration does not
  mint them yet. Blast radius stays separate until a joint registration path
  exists.
- Awards are not revocable in v1.
- `rarity` and `progress` are app-declared and untrusted — stored and returned
  verbatim; NimConnect does not verify them against game state.
