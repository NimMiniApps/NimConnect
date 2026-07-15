import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { apiUrl, hasApiBase } from './api'
import { fetchTransactionsByAddress } from './history'
import { sendNim, signChallenge } from './nimiq'
import type { Profile } from '../types/profile'

/** Mainnet NimFeed catalog — shared on-chain username registry. */
export const NIMFEED_CATALOG_ADDRESS =
  'NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y'

/** Must match the backend's REGISTRY_ADDRESS. Override with VITE_REGISTRY_ADDRESS. */
export const REGISTRY_ADDRESS: string =
  import.meta.env.VITE_REGISTRY_ADDRESS ?? NIMFEED_CATALOG_ADDRESS
/**
 * Value carried by claim transactions. 1 luna is technically enough, but
 * Nimiq Pay shows it as "0 NIM" and its swap routing can reject sub-dust
 * sends — 0.01 NIM (a fraction of a cent) renders honestly and routes.
 */
export const CLAIM_AMOUNT_NIM = 0.01

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

export function handlesEnabled(): boolean {
  return hasApiBase() && !!REGISTRY_ADDRESS
}

// Username rules are shared with NimFeed (same on-chain registry): 3-31
// chars, [a-z0-9_]. Claims sent from inside Nimiq Pay are capped at 26 chars
// by the 64-char text-transaction limit; longer names claim via NimFeed/Hub.
export function isValidHandle(h: string): boolean {
  return /^[a-z0-9_]{3,31}$/.test(h)
}

export const MAX_PAY_CLAIM_CHARS = 26

export function claimableInPay(h: string): boolean {
  return isValidHandle(h) && h.length <= MAX_PAY_CLAIM_CHARS
}

/**
 * NimFeed PROFILE_CLAIM in the Nimiq Pay text envelope:
 * "NFH:" + hex("NF" 0x01 0x01 <username>). Username-only — the display name
 * lives in the off-chain profile.
 */
export function makeClaimPayload(handle: string): string {
  const header = new Uint8Array([0x4e, 0x46, 0x01, 0x01])
  const username = new TextEncoder().encode(handle)
  const payload = new Uint8Array(header.length + username.length)
  payload.set(header, 0)
  payload.set(username, header.length)
  return `NFH:${bytesToHex(payload)}`
}

const CLAIM_MAGIC = new Uint8Array([0x4e, 0x46]) // "NF"

function parseClaimPayload(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== CLAIM_MAGIC[0] || bytes[1] !== CLAIM_MAGIC[1] || bytes[2] !== 0x01 || bytes[3] !== 0x01) {
    return null
  }
  const end = bytes.indexOf(0, 4)
  const username = new TextDecoder().decode(end >= 0 ? bytes.subarray(4, end) : bytes.subarray(4))
  return isValidHandle(username) ? username : null
}

/** Decode hex tx data into a claimed handle (mirrors backend parseClaimData). */
export function parseClaimHandle(dataHex: string): string | null {
  const trimmed = dataHex.trim().replace(/^0x/i, '')
  if (!trimmed || trimmed.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(trimmed)) return null
  const raw = Uint8Array.from(trimmed.match(/../g)!.map(b => parseInt(b, 16)))
  const asText = new TextDecoder().decode(raw)
  if (asText.startsWith('NFH:')) {
    const inner = asText.slice(4).trim()
    if (!/^[0-9a-fA-F]+$/.test(inner) || inner.length % 2 !== 0) return null
    const payload = Uint8Array.from(inner.match(/../g)!.map(b => parseInt(b, 16)))
    return parseClaimPayload(payload)
  }
  const direct = parseClaimPayload(raw)
  if (direct) return direct
  if (/^[0-9a-fA-F]+$/.test(asText) && asText.length % 2 === 0) {
    const inner = Uint8Array.from(asText.match(/../g)!.map(b => parseInt(b, 16)))
    const innerText = new TextDecoder().decode(inner)
    if (innerText.startsWith('NFH:')) {
      const payloadHex = innerText.slice(4).trim()
      if (/^[0-9a-fA-F]+$/.test(payloadHex) && payloadHex.length % 2 === 0) {
        const payload = Uint8Array.from(payloadHex.match(/../g)!.map(b => parseInt(b, 16)))
        return parseClaimPayload(payload)
      }
    }
    return parseClaimPayload(inner)
  }
  return null
}

export interface HandleClaim {
  handle: string
  /** On-chain claim sender — may be an HTLC contract in Nimiq Pay. */
  address: string
  /** Basic wallet that controls the claim, when address is an HTLC contract. */
  owner_address?: string
  tx_hash: string
  block_height: number
  tx_index: number
}

/** Wallet used for signing, publishing, and receiving — not the HTLC contract. */
export function claimOwnerAddress(claim: HandleClaim): string {
  return claim.owner_address ?? claim.address
}

export interface PublicProfile {
  display_name?: string
  bio?: string
  website?: string
  github?: string
  x?: string
  tags?: string[]
}

export interface ShareSelection {
  name: boolean
  bio: boolean
  website: boolean
  github: boolean
  x: boolean
  tags: boolean
}

export function defaultShareSelection(): ShareSelection {
  return { name: true, bio: false, website: false, github: false, x: false, tags: false }
}

/** Default share toggles: opt in every field the user has actually filled in. */
export function shareSelectionForProfile(profile: Profile): ShareSelection {
  return {
    name: !!profile.name.trim(),
    bio: !!profile.bio?.trim(),
    website: !!profile.website?.trim(),
    github: !!profile.github?.trim(),
    x: !!profile.x?.trim(),
    tags: profile.tags.length > 0,
  }
}

export function shareFromPublished(p: PublicProfile | null): ShareSelection {
  if (!p) return defaultShareSelection()
  return {
    name: !!p.display_name,
    bio: !!p.bio,
    website: !!p.website,
    github: !!p.github,
    x: !!p.x,
    tags: !!(p.tags?.length),
  }
}

export function hasAnyPublicShare(share: ShareSelection): boolean {
  return share.name || share.bio || share.website || share.github || share.x || share.tags
}

/** True when the server copy is missing or stale vs what we'd publish now. */
export function publicProfileNeedsSync(
  profile: Profile,
  share: ShareSelection,
  remote: PublicProfile | null,
): boolean {
  if (!hasAnyPublicShare(share)) return false
  if (!remote) return true
  if (share.name && profile.name && remote.display_name !== profile.name) return true
  if (share.bio && profile.bio && remote.bio !== profile.bio) return true
  if (share.website && profile.website && remote.website !== profile.website) return true
  if (share.github && profile.github && remote.github !== profile.github) return true
  if (share.x && profile.x && remote.x !== profile.x) return true
  if (share.tags && profile.tags.length) {
    const remoteTags = remote.tags ?? []
    if (remoteTags.length !== profile.tags.length) return true
    if (profile.tags.some((t, i) => t !== remoteTags[i])) return true
  }
  if (share.github && profile.github && !remote.github) return true
  if (share.website && profile.website && !remote.website) return true
  if (share.bio && profile.bio && !remote.bio) return true
  if (share.name && profile.name && !remote.display_name) return true
  return false
}

/** Push public-page visibility to the server when the user has a claimed @handle. */
export async function syncPublicProfile(
  profile: Profile,
  share: ShareSelection,
  wallets: string[],
): Promise<'published' | 'unpublished' | 'skipped'> {
  const claim = await findMyHandle(wallets)
  if (!claim) return 'skipped'
  const address = claimOwnerAddress(claim)
  const signed = { ...profile, address }
  if (!hasAnyPublicShare(share)) {
    await unpublishProfile(address)
    return 'unpublished'
  }
  await publishProfile(signed, share)
  return 'published'
}

/** Serialize ONLY the opted-in fields. Private data (notes, …) never leaves the device. */
export function profileToPublicPayload(profile: Profile, share: ShareSelection): string {
  const payload: PublicProfile = {}
  if (share.name && profile.name) payload.display_name = profile.name
  if (share.bio && profile.bio) payload.bio = profile.bio
  if (share.website && profile.website) payload.website = profile.website
  if (share.github && profile.github) payload.github = profile.github
  if (share.x && profile.x) payload.x = profile.x
  if (share.tags && profile.tags.length) payload.tags = [...profile.tags]
  return JSON.stringify(payload)
}

// Canonical messages — byte-match backend/profiles.go.
export function buildProfilePutMessage(address: string, updatedAt: number, payloadHash: string): string {
  return 'nimconnect:profile:v1'
    + `\naddress=${compact(address)}`
    + `\nupdatedAt=${updatedAt}`
    + `\npayloadHash=${payloadHash}`
}

export function buildProfileDeleteMessage(address: string, updatedAt: number): string {
  return 'nimconnect:profile-delete:v1'
    + `\naddress=${compact(address)}`
    + `\nupdatedAt=${updatedAt}`
}

export function profilePayloadHash(payload: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(payload)))
}

export async function checkHandle(handle: string): Promise<{ available: boolean; reason?: string }> {
  const res = await fetch(apiUrl(`/api/handles/check?h=${encodeURIComponent(handle)}`))
  if (!res.ok) throw new Error('check failed')
  return res.json()
}

export async function resolveHandle(handle: string): Promise<HandleClaim | null> {
  const res = await fetch(apiUrl(`/api/resolve/${encodeURIComponent(handle)}`))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('resolve failed')
  return res.json()
}

/** Resolve a handle and map HTLC claim senders to the wallet that owns them. */
export async function resolveHandleEnriched(handle: string): Promise<HandleClaim | null> {
  const claim = await resolveHandle(handle)
  return claim ? enrichClaimOwner(claim) : null
}

export async function handleForAddress(address: string): Promise<HandleClaim | null> {
  const res = await fetch(apiUrl(`/api/handles/by-address/${compact(address)}`))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('lookup failed')
  return res.json()
}

/** Nimiq Pay exposes separate incoming/outgoing accounts — check them all. */
export async function findHandleForWallets(addresses: string[]): Promise<HandleClaim | null> {
  const seen = new Set<string>()
  for (const address of addresses) {
    const key = compact(address)
    if (seen.has(key)) continue
    seen.add(key)
    const claim = await handleForAddress(address)
    if (claim) return claim
  }
  return null
}

const RPC_URL = 'https://rpc-mainnet.nimiqscan.com/'

interface ChainAccount {
  type?: string
  sender?: string
}

async function fetchChainAccount(address: string): Promise<ChainAccount | null> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountByAddress',
      params: [address],
    }),
  })
  if (!res.ok) return null
  const body = await res.json()
  return body.result?.data ?? body.result ?? null
}

/** True when the claim belongs to one of the user's Nimiq Pay wallet accounts. */
export async function claimBelongsToWallets(claim: HandleClaim, wallets: string[]): Promise<boolean> {
  const mine = new Set(wallets.map(compact))
  if (claim.owner_address && mine.has(compact(claim.owner_address))) return true
  if (mine.has(compact(claim.address))) return true
  const owner = await htlcOwnerWallet(claim.address)
  return owner != null && mine.has(compact(owner))
}

async function htlcOwnerWallet(address: string): Promise<string | null> {
  const acc = await fetchChainAccount(address)
  if (acc?.type === 'htlc' && acc.sender) return acc.sender
  return null
}

async function enrichClaimOwner(claim: HandleClaim): Promise<HandleClaim> {
  if (claim.owner_address) return claim
  const owner = await htlcOwnerWallet(claim.address)
  if (!owner || compact(owner) === compact(claim.address)) return claim
  return { ...claim, owner_address: owner }
}

/** Scan recent registry claims when by-address lookup misses HTLC senders. */
async function discoverHandleFromRegistry(wallets: string[]): Promise<HandleClaim | null> {
  const mine = new Set(wallets.map(compact))
  const registry = compact(REGISTRY_ADDRESS)
  const txs = await fetchTransactionsByAddress(REGISTRY_ADDRESS, 500)
  for (const tx of [...txs].reverse()) {
    if (compact(tx.to) !== registry) continue
    const handle = parseClaimHandle(tx.recipientData ?? '')
    if (!handle) continue
    const sender = tx.from
    if (!sender) continue
    let owner: string | null = null
    if (mine.has(compact(sender))) {
      owner = sender
    } else {
      owner = await htlcOwnerWallet(sender)
      if (!owner || !mine.has(compact(owner))) continue
    }
    return {
      handle,
      address: sender,
      owner_address: owner !== sender ? owner : undefined,
      tx_hash: tx.hash,
      block_height: tx.blockNumber ?? tx.validityStartHeight ?? 0,
      tx_index: 0,
    }
  }
  return null
}

/** Find the user's claimed @handle — API, local cache, then on-chain registry scan. */
export async function findMyHandle(wallets: string[]): Promise<HandleClaim | null> {
  const fromApi = await findHandleForWallets(wallets)
  if (fromApi) return enrichClaimOwner(fromApi)

  const local = loadMyHandle(wallets)
  if (local?.handle) {
    const resolved = await resolveHandle(local.handle)
    if (resolved && await claimBelongsToWallets(resolved, wallets)) {
      return enrichClaimOwner(resolved)
    }
    if (await claimBelongsToWallets(local, wallets)) return enrichClaimOwner(local)
  }

  const discovered = await discoverHandleFromRegistry(wallets)
  if (discovered) return discovered

  return null
}

const LOCAL_HANDLE_PREFIX = 'nimconnect:my-handle-v1:'

function walletStorageKey(addresses: string[]): string {
  return [...addresses].map(compact).sort().join('+')
}

export function saveMyHandle(wallets: string[], claim: HandleClaim): void {
  try {
    globalThis.localStorage?.setItem(
      `${LOCAL_HANDLE_PREFIX}${walletStorageKey(wallets)}`,
      JSON.stringify(claim),
    )
  } catch { /* best-effort */ }
}

export function loadMyHandle(wallets: string[]): HandleClaim | null {
  try {
    const raw = globalThis.localStorage?.getItem(
      `${LOCAL_HANDLE_PREFIX}${walletStorageKey(wallets)}`,
    )
    return raw ? JSON.parse(raw) as HandleClaim : null
  } catch {
    return null
  }
}

export async function fetchPublicProfile(
  address: string,
): Promise<{ updatedAt: number; profile: PublicProfile } | null> {
  const res = await fetch(apiUrl(`/api/profile/${compact(address)}`))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('profile fetch failed')
  const body = await res.json()
  return { updatedAt: body.updated_at, profile: body.profile ?? {} }
}

/** Send the on-chain claim tx, then fast-path it to the indexer. */
export async function claimHandle(
  handle: string,
  wallets: string[] = [],
): Promise<{ status: 'indexed' | 'pending'; txHash: string; claim?: HandleClaim }> {
  if (!claimableInPay(handle)) throw new Error('Invalid handle')
  if (!REGISTRY_ADDRESS) throw new Error('Handle registry not configured')
  const txHash = await sendNim(REGISTRY_ADDRESS, CLAIM_AMOUNT_NIM, makeClaimPayload(handle))
  const res = await fetch(apiUrl('/api/handles/claims'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_hash: txHash }),
  })
  if (!res.ok) return { status: 'pending', txHash }
  const body = await res.json()
  const claim = body.claim as HandleClaim | undefined
  if (claim && wallets.length) saveMyHandle(wallets, claim)
  return {
    status: body.status === 'indexed' ? 'indexed' : 'pending',
    txHash,
    claim,
  }
}

export async function publishProfile(profile: Profile, share: ShareSelection): Promise<void> {
  const payload = profileToPublicPayload(profile, share)
  const updatedAt = Date.now()
  const { publicKey, signature } = await signChallenge(
    buildProfilePutMessage(profile.address, updatedAt, profilePayloadHash(payload)),
  )
  const res = await fetch(apiUrl(`/api/profile/${compact(profile.address)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: profile.address,
      updated_at: updatedAt,
      profile: payload,
      public_key: publicKey,
      signature,
    }),
  })
  if (!res.ok) throw new Error(`Publish failed (${res.status})`)
}

export async function unpublishProfile(address: string): Promise<void> {
  const updatedAt = Date.now()
  const { publicKey, signature } = await signChallenge(buildProfileDeleteMessage(address, updatedAt))
  const res = await fetch(apiUrl(`/api/profile/${compact(address)}`), {
    method: 'DELETE',
    headers: {
      'X-Profile-Updated-At': String(updatedAt),
      'X-Profile-Public-Key': publicKey,
      'X-Profile-Signature': signature,
    },
  })
  if (!res.ok && res.status !== 404) throw new Error(`Unpublish failed (${res.status})`)
}
