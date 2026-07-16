# Ecosystem profile client — design

Date: 2026-07-16
Status: approved

## Goal

Make NimConnect the ecosystem identity authority for Nimiq mini-apps, and let
apps like NimBomber consume `@handle` + display profile for UI enrichment while
keeping app-specific data (game stats, rewards, sessions) local.

## Decision

Do **not** split NimConnect’s full profile/CRM/backup stack into an SDK.

Extract a **thin read-only TypeScript client** over the public APIs that already
exist. NimConnect remains the write path (claim handle, publish/unpublish
signed profile). Consumers only read.

Package name: `@nimconnect/profile-client` (not `@nimiq/*` — that scope is not
ours). Fallback unscoped name: `nimconnect-profile-client` if the npm org is
not ready.

## Ownership

| Concern | Owner |
|---|---|
| `@handle` claim / resolve | NimConnect (+ on-chain NimFeed registry) |
| Signed public profile (`display_name`, bio, links, tags) | NimConnect |
| Contacts, invoices, inbox, encrypted backup | NimConnect only (not in client) |
| Wallet JWT / game auth | Each app (e.g. NimBomber) |
| Wins, kills, matches, rewards, leaderboard | Each app (NimBomber) |
| Local nickname fallback | Each app |

## Stats

Game stats are **enrichment on the consumer side only**. Never store or sync
Bomber stats into NimConnect profiles.

Typical NimBomber render:

```ts
{
  // @nimconnect/profile-client
  address, handle?, displayName?, bio?,
  // NimBomber /profile + /rewards
  nickname?, stats, rewards
}
```

Display priority for names: ecosystem `displayName` / `@handle` → local
`nickname` → `address` prefix.

## Architecture

```text
Write (NimConnect only)
  wallet → NimConnect UI → signed PUT /api/profile/{address}
                        → claim tx → chain → indexer

Read (any mini-app)
  app → @nimconnect/profile-client → GET /api/profile/{address}
                                   → GET /api/handles/by-address/{address}
                                   → GET /api/resolve/{handle}
```

Existing backend routes (stable contract):

- `GET /api/resolve/{handle}`
- `GET /api/profile/{address}`
- `GET /api/handles/by-address/{address}`

CORS already defaults to `ALLOWED_ORIGIN=*`; production may use an allow-list
and must include consumer origins (e.g. NimBomber).

## Client scope

In-repo path: `packages/profile-client`.

Exports (read-only):

- types for handle claim + public profile payload
- `resolveHandle(handle)`
- `getProfileByAddress(address)`
- `getHandleByAddress(address)`
- `getDisplayIdentity(address)` → normalized `{ address, handle?, displayName?, bio?, links? }`
- configurable `baseUrl`

Non-goals for the client: write APIs, Vue/Pinia/Dexie, stats types, UI
components, microservice split.

## NimBomber integration shape

- Client-side identity enrichment for Profile, Lobby, Leaderboard (no Bomber
  backend dependency on NimConnect for v1).
- Profile page shows ecosystem identity + Bomber stats; “Edit profile” links
  out to NimConnect.
- Keep `PUT /profile/nickname` as offline/fallback.

## Follow-ups (out of scope)

- Batch `GET /api/profiles?addresses=…` for large leaderboards
- Real Ed25519 verify in NimBomber auth (independent of profiles)
