import { ValidationUtils } from '@nimiq/utils/validation-utils'
import type { Profile, ProfileType } from '../types/profile'
import { appOrigin } from './links'

const PROFILE_TYPES: ProfileType[] = ['person', 'business', 'merchant', 'other']
const GITHUB_HANDLE = /^[A-Za-z0-9-]{1,39}$/
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/

/** Public profile fields encoded in a share QR / deep link. */
export interface SharedProfile {
  v: 1
  address: string
  name: string
  type: ProfileType
  bio?: string
  website?: string
  github?: string
  x?: string
  tags: string[]
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(encoded: string): Uint8Array | null {
  try {
    const pad = encoded.length % 4 ? '='.repeat(4 - (encoded.length % 4)) : ''
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + pad
    const bin = atob(b64)
    return Uint8Array.from(bin, c => c.charCodeAt(0))
  } catch {
    return null
  }
}

function safeUrl(url?: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined
  try {
    const raw = url.trim()
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

function safeHandle(handle: unknown, pattern: RegExp): string | undefined {
  if (typeof handle !== 'string') return undefined
  const h = handle.trim().replace(/^@/, '')
  return h && pattern.test(h) ? h : undefined
}

function safeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean))]
}

function safeText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLen) : undefined
}

function normalizeSharedProfile(raw: unknown): SharedProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  if (typeof o.address !== 'string' || typeof o.name !== 'string') return null
  if (!ValidationUtils.isValidAddress(o.address)) return null
  const name = o.name.trim()
  if (!name) return null

  const type = typeof o.type === 'string' && PROFILE_TYPES.includes(o.type as ProfileType)
    ? o.type as ProfileType
    : 'person'

  return {
    v: 1,
    address: ValidationUtils.normalizeAddress(o.address),
    name,
    type,
    ...(safeText(o.bio, 500) ? { bio: safeText(o.bio, 500) } : {}),
    ...(safeUrl(o.website) ? { website: safeUrl(o.website) } : {}),
    ...(safeHandle(o.github, GITHUB_HANDLE) ? { github: safeHandle(o.github, GITHUB_HANDLE) } : {}),
    ...(safeHandle(o.x, X_HANDLE) ? { x: safeHandle(o.x, X_HANDLE) } : {}),
    tags: safeTags(o.tags),
  }
}

export function encodeSharedProfile(profile: SharedProfile): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(profile)))
}

export function decodeSharedProfile(encoded: string): SharedProfile | null {
  const bytes = base64UrlToBytes(encoded.trim())
  if (!bytes) return null
  try {
    return normalizeSharedProfile(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

export function profileToSharePayload(profile: Profile): SharedProfile {
  return {
    v: 1,
    address: profile.address,
    name: profile.name,
    type: profile.type,
    ...(profile.bio ? { bio: profile.bio } : {}),
    ...(profile.website ? { website: profile.website } : {}),
    ...(profile.github ? { github: profile.github } : {}),
    ...(profile.x ? { x: profile.x } : {}),
    tags: [...profile.tags],
  }
}

export function makeProfileShareLink(profile: Profile): string {
  const payload = profileToSharePayload(profile)
  return `${appOrigin()}#/add?p=${encodeURIComponent(encodeSharedProfile(payload))}`
}

function extractShareParam(text: string): string | null {
  const trimmed = text.trim()
  const direct = trimmed.match(/[?&]p=([^&#]+)/i)
  if (direct) return decodeURIComponent(direct[1])

  try {
    const url = new URL(trimmed)
    const fromHash = url.hash.match(/[?&]p=([^&#]+)/i)
    if (fromHash) return decodeURIComponent(fromHash[1])
  } catch {
    // not a URL
  }
  return null
}

/** Parse a NimConnect profile share link or pasted payload. */
export function parseProfileShare(text: string): SharedProfile | null {
  const param = extractShareParam(text)
  if (param) return decodeSharedProfile(param)

  // Allow pasting the raw base64 payload in the scan sheet.
  if (/^[A-Za-z0-9_-]+$/.test(text.trim()) && text.trim().length > 20) {
    return decodeSharedProfile(text.trim())
  }
  return null
}

export function sharedProfileToNewProfile(shared: SharedProfile) {
  return {
    name: shared.name,
    address: shared.address,
    type: shared.type,
    tags: shared.tags,
    ...(shared.bio ? { bio: shared.bio } : {}),
    ...(shared.website ? { website: shared.website } : {}),
    ...(shared.github ? { github: shared.github } : {}),
    ...(shared.x ? { x: shared.x } : {}),
  }
}
