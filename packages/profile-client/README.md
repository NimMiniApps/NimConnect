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
import {
  createProfileClient,
  buildHandleClaimPayload,
  compactAddress,
  isValidHandle,
} from '@nimconnect/profile-client'

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

// Payment — resolve once for review, then again immediately before signing.
async function payHandle(handle: string, amount: number, wallet: WalletIntegration) {
  const preview = await client.resolveHandleForPayment(handle)
  if (!preview) throw new Error(`unknown handle: @${handle}`)

  // Show preview.handle + preview.address to the user before confirmation.
  const confirmed = await client.resolveHandleForPayment(handle)
  if (!confirmed) throw new Error(`handle no longer resolves: @${handle}`)
  if (compactAddress(confirmed.address) !== compactAddress(preview.address)) {
    throw new Error(`@${handle} changed owners — review the new address`)
  }

  await wallet.sendTransaction({ recipient: confirmed.address, value: amount })
}
```

Reads hit NimConnect's public, CORS-open endpoints — no config or
allow-listing needed on either side.

`resolveHandle()` is the cacheable identity lookup. Payments must use
`resolveHandleForPayment()`, which asks NimConnect to refresh its on-chain
registry and uses `cache: 'no-store'`. It returns `null` for an unknown handle
and throws when fresh resolution is unavailable; never fall back to a cached
address or an AI-guessed recipient.

## Handle release support

The package can also build and replay the shared protocol's gated `RELEASE`
action:

```ts
import {
  buildHandleReleasePayload,
  fetchHandleRegistry,
} from '@nimconnect/profile-client'

const { recipient, extraData } = buildHandleReleasePayload('chuck')

const registry = await fetchHandleRegistry({
  releaseActivationHeight: AGREED_SHARED_ACTIVATION_HEIGHT,
})
```

Do not send a release transaction until NimConnect, NimFeed, and other shared
registry readers have agreed on and activated the same block height. Release
actions remain inert by default: registry replay ignores them unless the caller
explicitly supplies `releaseActivationHeight`.

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

## Scoped authorization (v3)

One readable signature creates an app-specific grant for up to seven days.
The client signs the exact server challenge and then uses `Authorization:
Bearer`; it never holds wallet keys.

```ts
const client = createProfileClient({ audience: 'yourapp' })
const grant = await client.createAuthorization({
  address: myAddress,
  scopes: ['friends:read', 'friends:write', 'achievements:read'],
  signMessage: message => wallet.signMessage(message),
})

const friends = await client.listFriends()
await client.sendFriendRequest('bob')
const achievements = await client.listAchievements(myAddress) // includes private with achievements:read

// Persist grant in your app's IndexedDB and restore it later:
const restored = createProfileClient({ audience: 'yourapp', authorization: grant })
await restored.revokeAuthorization()       // current grant
// await restored.revokeAuthorization(true) // every grant for this wallet
```

First-party session (`createSession`) can also list every live grant for the
wallet and fetch mirrored app identity for consent:

```ts
await client.createSession({ address: myAddress, signMessage })
const connected = await client.listAuthorizations()
const app = await client.getApp('nimworld') // { displayName, iconUrl, verified, scopes, ... }
```

The grant belongs to exactly one audience, wallet, and explicit scope set. It
does not authorize on-chain actions, which still require a wallet transaction
confirmation. See [the v3 API contract](../../docs/api/scoped-authorization.md).

## Friends compatibility API (v1/v2)

Mutual friends can still use the deprecated short-lived server session. Wallet signing stays in
your app; this client never holds keys.

Pass your app's `audience` slug so the signed challenge names your app. That
makes the signature reusable by *your* backend (verify the same message for
your own session) without being replayable into another app.

```ts
const client = createProfileClient({ audience: 'yourapp' })

await client.createSession({
  address: myAddress,
  signMessage: async (message) => {
    // Nimiq Pay / Hub signMessage — return hex publicKey + signature
    const { publicKey, signature } = await wallet.signMessage(message)
    return { publicKey, signature }
  },
})

const friends = await client.listFriends()
const pending = await client.listFriendRequests()
await client.sendFriendRequest('bob') // handle or address
await client.acceptFriendRequest(pending[0].friendshipId)
await client.removeFriend(friends[0].address)

client.clearSession()
```

Session token is held on the client instance after `createSession` (or pass
`sessionToken` in options). Friends calls send `X-NimConnect-Session`.
Persist the token in your app (`sessionStorage`, etc.) if you want it to
survive reloads — inject it via `createProfileClient({ sessionToken })`.

`createSession` and `X-NimConnect-Session` remain for one compatibility
release. New integrations should use `createAuthorization`.

See [`docs/api/friends.md`](../../docs/api/friends.md).

## Docs

- [`docs/api/public-profile-read.md`](../../docs/api/public-profile-read.md) — read endpoints
- [`docs/api/handle-claim-protocol.md`](../../docs/api/handle-claim-protocol.md) — on-chain claim format
- [`docs/api/friends.md`](../../docs/api/friends.md) — session + friends API
- [`docs/api/scoped-authorization.md`](../../docs/api/scoped-authorization.md) — v3 grants and scopes

Writing/editing the off-chain profile fields (bio, links, display name)
requires NimConnect's own signed edit flow — link users to
`https://nimconnect.nimiqminiapps.com` rather than reimplementing it.
