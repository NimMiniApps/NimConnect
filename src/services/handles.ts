import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { apiUrl, hasApiBase } from './api'
import { sendNim, signChallenge } from './nimiq'
import type { Profile } from '../types/profile'

/** Must match the backend's REGISTRY_ADDRESS; empty disables the feature. */
export const REGISTRY_ADDRESS: string = import.meta.env.VITE_REGISTRY_ADDRESS ?? ''
/** Dust value carried by claim transactions. */
export const CLAIM_AMOUNT_NIM = 0.00001

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

export interface HandleClaim {
  handle: string
  address: string
  tx_hash: string
  block_height: number
  tx_index: number
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

export async function handleForAddress(address: string): Promise<HandleClaim | null> {
  const res = await fetch(apiUrl(`/api/handles/by-address/${compact(address)}`))
  if (res.status === 404) return null
  if (!res.ok) throw new Error('lookup failed')
  return res.json()
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
export async function claimHandle(handle: string): Promise<'indexed' | 'pending'> {
  if (!claimableInPay(handle)) throw new Error('Invalid handle')
  if (!REGISTRY_ADDRESS) throw new Error('Handle registry not configured')
  const txHash = await sendNim(REGISTRY_ADDRESS, CLAIM_AMOUNT_NIM, makeClaimPayload(handle))
  const res = await fetch(apiUrl('/api/handles/claims'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_hash: txHash }),
  })
  if (!res.ok) return 'pending' // tx is on chain; the periodic sweep will pick it up
  const body = await res.json()
  return body.status === 'indexed' ? 'indexed' : 'pending'
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
