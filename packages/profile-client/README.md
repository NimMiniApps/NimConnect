# @nimconnect/profile-client

Read `@handle`s and public profiles from the shared NimFeed/NimConnect
identity registry, and build the on-chain payload to claim a `@handle` —
for any Nimiq mini app, not just NimConnect.

In the examples below, `wallet` and `WalletIntegration` are placeholders for
whatever wallet integration your mini app already uses (Nimiq Hub, Nimiq
Pay's injected provider, etc.) — this package has no such type or import,
it only builds the `{ recipient, extraData }` you pass to your own
`sendTransaction` call.

## Quick start — zero setup (NimConnect's API for everything)

```ts
import { createProfileClient, buildHandleClaimPayload, isValidHandle } from '@nimconnect/profile-client'

const client = createProfileClient()

// Claim form
async function claimHandle(handle: string, wallet: WalletIntegration) {
  if (!isValidHandle(handle)) throw new Error('3-31 chars, a-z 0-9 _ only')
  if (await client.resolveHandle(handle)) throw new Error('handle already taken')

  const { recipient, extraData } = buildHandleClaimPayload(handle)
  await wallet.sendTransaction({ recipient, extraData, value: 0 }) // your own wallet call
}

// Display
async function loadIdentity(address: string) {
  return client.getDisplayIdentity(address) // { address, handle?, displayName?, bio?, links? }
}
```

Reads hit NimConnect's public, CORS-open, cacheable read endpoints — no
config or allow-listing needed on either side.

## No NimConnect dependency for handles — self-hosted RPC

```ts
import {
  buildHandleClaimPayload,
  isValidHandle,
  fetchHandleRegistry,
  resolveHandleByAddress,
  isHandleAvailable,
  createProfileClient, // only for the off-chain profile fields (bio/links), still
} from '@nimconnect/profile-client'

const RPC_URL = 'https://your-rpc.example' // omit everywhere below to use the public mainnet gateway

// Claim form
async function claimHandle(handle: string, wallet: WalletIntegration) {
  if (!isValidHandle(handle)) throw new Error('3-31 chars, a-z 0-9 _ only')

  const registry = await fetchHandleRegistry({ rpcUrl: RPC_URL })
  if (!isHandleAvailable(registry, handle)) throw new Error('taken or invalid')

  const { recipient, extraData } = buildHandleClaimPayload(handle)
  await wallet.sendTransaction({ recipient, extraData, value: 0 })
}

// Display — handle from chain directly, bio/links still enriched from NimConnect
async function loadIdentity(address: string) {
  const registry = await fetchHandleRegistry({ rpcUrl: RPC_URL })
  const handleClaim = resolveHandleByAddress(registry, address)

  const profile = await createProfileClient().getProfileByAddress(address)

  return {
    address,
    handle: handleClaim?.handle,
    displayName: profile?.profile.display_name,
    bio: profile?.profile.bio,
  }
}
```

`fetchHandleRegistry` fetches the registry address's transaction history and
resolves it — including Nimiq Pay's swap-HTLC claim attribution — with no
dependency on NimConnect's server. `resolveHandleRegistry`/
`resolveHandleByAddress`/`isHandleAvailable` are the lower-level pure
functions underneath, for bringing your own fetching/pagination/caching.

**Caching note:** `fetchHandleRegistry` rescans and replays the *full*
registry tx history on every call — there's no shortcut, the registry only
exists as replayed chain history, not indexed contract state. That's fine
for occasional use (a claim form, a one-off lookup), but don't call it per
render on something like a leaderboard: fetch once, cache the returned
`Map` yourself, and refresh it on a timer or on demand. This is the same
tradeoff NimConnect's own backend has — it only avoids repeated full scans
by sweeping on a 2-minute interval and serving cached results in between,
which is exactly the behavior you'd need to replicate yourself if you call
this often. If that's more than you want to own, use the NimConnect-API
path above instead — it's already doing this caching for you.

## Docs

- [`docs/api/public-profile-read.md`](../../docs/api/public-profile-read.md) — read endpoints
- [`docs/api/handle-claim-protocol.md`](../../docs/api/handle-claim-protocol.md) — on-chain claim format

Writing/editing the off-chain profile fields (bio, links, display name)
requires NimConnect's own signed edit flow — link users to
`https://nimconnect.nimiqminiapps.com` rather than reimplementing it.
