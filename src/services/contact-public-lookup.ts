import { ValidationUtils } from '@nimiq/utils/validation-utils'
import {
  claimOwnerAddress,
  fetchPublicProfile,
  handleForAddress,
  handlesEnabled,
  parsePublicLookupQuery,
  resolveHandleEnriched,
  type PublicProfile,
} from './handles'

/** Brief in-memory cache so rescans / revisits do not hammer the resolver. */
const CACHE_TTL_MS = 2 * 60 * 1000

export interface ContactPublicSuggestion {
  address: string
  handle: string | null
  /** True when a claimed on-chain @handle backs this identity. */
  verified: boolean
  displayName: string | null
  bio?: string
  website?: string
  github?: string
  x?: string
  /** Public tags the owner opted to publish — never private contact tags. */
  tags: string[]
}

/** Form fields that can be filled from a public profile (never notes/favorite/type). */
export type PublicImportField = 'name' | 'bio' | 'website' | 'github' | 'x' | 'tags'

export interface ContactFormSnapshot {
  name: string
  bio: string
  website: string
  github: string
  x: string
  tags: string[]
}

export interface PublicImportPlan {
  patch: {
    name?: string
    bio?: string
    website?: string
    github?: string
    x?: string
    tags?: string[]
  }
  /** Form fields that will be filled (empty → public value). */
  fields: PublicImportField[]
  /** Banner labels: Avatar, Name, Handle, Bio, … */
  labels: string[]
}

export type ContactLookupResult =
  | { status: 'found'; suggestion: ContactPublicSuggestion }
  | { status: 'not_found' }
  | { status: 'unavailable' }

type CacheEntry = { at: number; result: ContactLookupResult }

const cache = new Map<string, CacheEntry>()

function cacheGet(key: string): ContactLookupResult | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.result
}

function cacheSet(key: string, result: ContactLookupResult): ContactLookupResult {
  // Do not cache transient backend failures — retry on next attempt.
  if (result.status !== 'unavailable') {
    cache.set(key, { at: Date.now(), result })
  }
  return result
}

/** Test helper — clears the short-lived resolution cache. */
export function clearContactPublicLookupCache(): void {
  cache.clear()
}

export function contactSuggestionHasDetails(s: ContactPublicSuggestion): boolean {
  return !!(
    s.handle
    || s.displayName
    || s.bio
    || s.website
    || s.github
    || s.x
    || s.tags.length
  )
}

function suggestionFrom(
  address: string,
  handle: string | null,
  profile: PublicProfile | null,
): ContactPublicSuggestion {
  return {
    address: ValidationUtils.normalizeAddress(address),
    handle,
    verified: !!handle,
    displayName: profile?.display_name?.trim() || null,
    bio: profile?.bio?.trim() || undefined,
    website: profile?.website?.trim() || undefined,
    github: profile?.github?.trim() || undefined,
    x: profile?.x?.trim() || undefined,
    tags: profile?.tags?.filter(t => !!t.trim()) ?? [],
  }
}

/**
 * Fill only empty contact fields from a public suggestion.
 * Never overwrites user-entered values; never touches notes/favorite/type.
 */
export function planEmptyPublicImports(
  suggestion: ContactPublicSuggestion,
  current: ContactFormSnapshot,
): PublicImportPlan {
  const patch: PublicImportPlan['patch'] = {}
  const fields: PublicImportField[] = []
  const labels: string[] = ['Avatar']

  if (suggestion.handle) {
    labels.push('Handle')
    if (suggestion.verified) labels.push('Verified')
  }

  if (!current.name.trim()) {
    const next = suggestion.displayName || suggestion.handle
    if (next) {
      patch.name = next
      fields.push('name')
      labels.push('Name')
    }
  }
  if (!current.bio.trim() && suggestion.bio) {
    patch.bio = suggestion.bio
    fields.push('bio')
    labels.push('Bio')
  }
  if (!current.website.trim() && suggestion.website) {
    patch.website = suggestion.website
    fields.push('website')
    labels.push('Website')
  }
  if (!current.github.trim() && suggestion.github) {
    patch.github = suggestion.github
    fields.push('github')
    labels.push('GitHub')
  }
  if (!current.x.trim() && suggestion.x) {
    patch.x = suggestion.x
    fields.push('x')
    labels.push('X')
  }
  if (!current.tags.length && suggestion.tags.length) {
    patch.tags = [...suggestion.tags]
    fields.push('tags')
    labels.push('Tags')
  }

  return { patch, fields, labels }
}

async function loadPublicFields(address: string): Promise<PublicProfile | null> {
  const remote = await fetchPublicProfile(address)
  return remote?.profile ?? null
}

export async function lookupContactByAddress(address: string): Promise<ContactLookupResult> {
  if (!handlesEnabled()) return { status: 'unavailable' }
  const normalized = ValidationUtils.normalizeAddress(address)
  const key = `addr:${normalized.replace(/\s+/g, '')}`
  const cached = cacheGet(key)
  if (cached) return cached

  try {
    const [claim, profile] = await Promise.all([
      handleForAddress(normalized),
      loadPublicFields(normalized),
    ])
    const handle = claim?.handle ?? null
    const suggestion = suggestionFrom(normalized, handle, profile)
    if (!contactSuggestionHasDetails(suggestion)) {
      return cacheSet(key, { status: 'not_found' })
    }
    return cacheSet(key, { status: 'found', suggestion })
  } catch {
    return { status: 'unavailable' }
  }
}

export async function lookupContactByHandle(handle: string): Promise<ContactLookupResult> {
  if (!handlesEnabled()) return { status: 'unavailable' }
  const key = `handle:${handle}`
  const cached = cacheGet(key)
  if (cached) return cached

  try {
    const claim = await resolveHandleEnriched(handle)
    if (!claim) return cacheSet(key, { status: 'not_found' })

    const address = claimOwnerAddress(claim)
    let profile: PublicProfile | null = null
    try {
      profile = await loadPublicFields(address)
    } catch {
      // Handle resolved; profile fields are optional — still return the claim.
    }

    const suggestion = suggestionFrom(address, claim.handle, profile)
    const result: ContactLookupResult = { status: 'found', suggestion }
    cacheSet(key, result)
    cacheSet(`addr:${address.replace(/\s+/g, '')}`, result)
    return result
  } catch {
    return { status: 'unavailable' }
  }
}

/**
 * Resolve a contact identity from a Nimiq address or @handle.
 * Address remains authoritative; a handle is additional public metadata.
 */
export async function lookupContactPublicIdentity(raw: string): Promise<ContactLookupResult> {
  const parsed = parsePublicLookupQuery(raw)
  if (parsed.kind === 'invalid') return { status: 'not_found' }
  if (parsed.kind === 'handle') return lookupContactByHandle(parsed.handle)
  return lookupContactByAddress(parsed.address)
}

/** Prefill label for the suggestion card: "@alice · Alice" */
export function formatContactSuggestionLabel(s: ContactPublicSuggestion): string {
  const handle = s.handle ? `@${s.handle}` : null
  const name = s.displayName
  if (handle && name) return `${handle} · ${name}`
  if (handle) return handle
  if (name) return name
  return shortAddr(s.address)
}

function shortAddr(address: string): string {
  const parts = address.split(' ')
  if (parts.length < 9) return address
  return `${parts[0]} ${parts[1]}…${parts[8]}`
}
