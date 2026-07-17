# @handle Claim Protocol

`@handle`s (e.g. `@chuck`) are not a NimConnect-owned resource. They're a
shared on-chain username registry also used by NimFeed and Nimiq Pay:
claiming one is just sending a correctly-formatted transaction — no API call
to NimConnect required. NimConnect (and NimFeed) independently index the
same chain data, so a handle claimed via any app resolves identically
everywhere. Source of truth: `backend/handles.go`.

`@nimconnect/profile-client` doesn't require NimConnect's server for any of
this — claiming and resolving both work directly against a Nimiq RPC:

- `buildHandleClaimPayload(handle)` / `HANDLE_REGISTRY_ADDRESS` — build the
  claim tx payload.
- `fetchHandleRegistry({ rpcUrl })` — give it an RPC URL (defaults to the
  public mainnet gateway) and it fetches the registry's tx history and
  resolves it for you, HTLC attribution included. The easiest self-hosted
  option.
- `resolveHandleRegistry(txs)` / `resolveHandleByAddress` / `isHandleAvailable`
  — the lower-level pure functions `fetchHandleRegistry` is built on, for
  when you want to control fetching/pagination/caching yourself.

`createProfileClient().resolveHandle()` etc. remain the zero-setup option —
NimConnect's server already does this indexing for you, continuously, and
exposes it as a fast, cached, CORS-open read API. Use the RPC-backed
functions above only if you specifically don't want that dependency. Read
this doc if you want to understand the wire format either way.

## Registry address

```
NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y
```

This is the shared NimFeed catalog address (mainnet). A claim is any
transaction sent to this address with a correctly-formatted data payload.

## Claim rules

- **Earliest claim wins.** Ordered by `(blockHeight, transactionIndex)`.
  There is no release/transfer type in the protocol — once claimed, a handle
  is permanent.
- **Username format:** 3–31 chars, `[a-z0-9_]` only.
- **One handle "wins" per address for display purposes** — an address can
  technically send multiple claim txs, but by-address lookups
  (`GET /api/handles/by-address/{address}`) resolve to the earliest one.
  Don't rely on being able to claim more than one handle per address.
- Sending a claim tx costs a normal network fee; value can be `0`.

## Payload format

```
raw binary (Nimiq Hub):    "NF" 0x01 0x01 <username bytes>
text envelope (Nimiq Pay): "NFH:" + hex(<raw binary payload above>)
```

Byte breakdown of the raw binary form:

| Bytes | Meaning |
|---|---|
| `0x4e 0x46` | Magic — ASCII `"NF"` |
| `0x01` | Version |
| `0x01` | Type — `PROFILE_CLAIM` |
| rest | Username, ASCII, no length prefix (claim ends at payload end) |

To claim `chuck`: raw payload is `4e 46 01 01 63 68 75 63 6b`, tx data field
is `"NFH:4e460101636875636b"` — send that as the transaction's
`extraData`/message field via your wallet integration (Nimiq Hub `checkout`,
Nimiq Pay's injected provider, etc.). This library does not sign or
broadcast the transaction — only build the payload — since signing depends
on whichever wallet integration your mini app already has.

```ts
import { buildHandleClaimPayload, createProfileClient } from '@nimconnect/profile-client'

const { recipient, extraData } = buildHandleClaimPayload('chuck')
await wallet.sendTransaction({ recipient, extraData, value: 0 }) // your own wallet call

// Later, read it back (see docs/api/public-profile-read.md for full read API):
const client = createProfileClient()
await client.resolveHandle('chuck')
```

## Display names, bios, links — off-chain, NimConnect-hosted

The on-chain registry only carries the username. Everything else about a
public identity (display name, bio, links, tags) is off-chain, signed, and
hosted by NimConnect — see
[`docs/api/public-profile-read.md`](./public-profile-read.md). That schema
is additive-only, so it's meant to be extended over time without breaking
existing readers.

## Resolving without NimConnect's server

If you'd rather not depend on NimConnect's API for handle resolution (only
for the off-chain profile enrichment, say), give `fetchHandleRegistry` an
RPC URL — it fetches the registry's tx history and resolves it, Nimiq Pay
HTLC attribution included, all in one call:

```ts
import { fetchHandleRegistry, resolveHandleByAddress, isHandleAvailable } from '@nimconnect/profile-client'

const registry = await fetchHandleRegistry({ rpcUrl: 'https://your-rpc.example' }) // omit rpcUrl to use the public mainnet gateway
registry.get('chuck')                          // -> ResolvedHandleClaim | undefined
resolveHandleByAddress(registry, address)       // -> ResolvedHandleClaim | null
isHandleAvailable(registry, 'newhandle')        // -> boolean
```

This is the same earliest-`(blockHeight, txIndex)`-wins algorithm the
backend runs (`backend/handles_registry.go`'s `Rebuild`), including the
same two-tier HTLC-owner resolution the backend's `htlcCreator` does (live
account `sender` field, falling back to decoding the contract's creation-tx
data) — Nimiq Pay-originated claims resolve to the real wallet, not the
swap contract, with no setup needed on your end.

ponytail: `fetchHandleRegistry` refetches and replays the full tx history
on every call, same as the backend before its periodic-sweep cache — fine
for occasional use; cache the result yourself (e.g. on a timer) if you call
it often.

### Lower-level: bring your own fetching

If you already have your own indexer/pagination/caching and just want the
protocol logic, `resolveHandleRegistry` is the pure function
`fetchHandleRegistry` is built on — same HTLC attribution, but you supply
the transaction list and the HTLC-owner resolver:

```ts
import { resolveHandleRegistry, ownerFromHtlcCreationData } from '@nimconnect/profile-client'

// txs: your own RPC's transaction history for HANDLE_REGISTRY_ADDRESS,
// shaped as { hash, sender, data, blockHeight, txIndex, fromType? }
const registry = await resolveHandleRegistry(txs, {
  resolveHtlcOwner: async (contractAddress) => {
    const account = await yourRpc.getAccountByAddress(contractAddress)
    if (account.type === 'htlc' && account.sender) return account.sender
    const creationTx = await yourRpc.findHtlcCreationTx(contractAddress)
    return creationTx ? ownerFromHtlcCreationData(creationTx.data) : null
  },
})
```

`resolveHtlcOwner` is called at most once per distinct contract address per
call, and omitting it falls back to attributing HTLC-routed claims to the
contract address instead of the user (same fallback the backend has).

## Availability checks

`GET /api/handles/check?h={handle}` (NimConnect-specific, not part of the
on-chain protocol) reports whether a handle is free, taken, invalid, or
reserved by NimConnect's own claim UI — useful for a claim form's live
validation, but the chain is always authoritative. A handle this endpoint
calls "reserved" can still be claimed and will still resolve if claimed via
another app (e.g. NimFeed) — reservation only blocks NimConnect's own UI.
