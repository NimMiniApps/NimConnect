import type {
  DisplayIdentity,
  HandleClaim,
  ProfileClientOptions,
  StoredPublicProfile,
} from './types'

/** Strip spaces and uppercase, matching NimConnect backend's `compactAddress`. */
export function compactAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/** Same default as `PUBLIC_APP_ORIGIN` in `backend/main.go`. */
export const DEFAULT_BASE_URL = 'https://nimconnect.nimiqminiapps.com'

export interface ProfileClient {
  getProfileByAddress(address: string): Promise<StoredPublicProfile | null>
  resolveHandle(handle: string): Promise<HandleClaim | null>
  getHandleByAddress(address: string): Promise<HandleClaim | null>
  getDisplayIdentity(address: string): Promise<DisplayIdentity>
}

export function createProfileClient(options: ProfileClientOptions = {}): ProfileClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

  async function getProfileByAddress(address: string): Promise<StoredPublicProfile | null> {
    const res = await fetch(`${baseUrl}/api/profile/${compactAddress(address)}`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`)
    const body = await res.json()
    return {
      address: body.address,
      updatedAt: body.updated_at,
      profile: body.profile ?? {},
    }
  }

  function parseHandleClaim(body: any): HandleClaim {
    return {
      handle: body.handle,
      address: body.address,
      txHash: body.tx_hash,
      blockHeight: body.block_height,
      txIndex: body.tx_index,
    }
  }

  async function resolveHandle(handle: string): Promise<HandleClaim | null> {
    const res = await fetch(`${baseUrl}/api/resolve/${handle}`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`resolve handle failed: ${res.status}`)
    return parseHandleClaim(await res.json())
  }

  async function getHandleByAddress(address: string): Promise<HandleClaim | null> {
    const res = await fetch(`${baseUrl}/api/handles/by-address/${compactAddress(address)}`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`handle by address fetch failed: ${res.status}`)
    return parseHandleClaim(await res.json())
  }

  async function getDisplayIdentity(address: string): Promise<DisplayIdentity> {
    const [handleClaim, storedProfile] = await Promise.all([
      getHandleByAddress(address),
      getProfileByAddress(address),
    ])
    const profile = storedProfile?.profile

    return {
      address,
      handle: handleClaim?.handle,
      displayName: profile?.display_name,
      bio: profile?.bio,
      links: profile
        ? { website: profile.website, github: profile.github, x: profile.x }
        : undefined,
    }
  }

  return { getProfileByAddress, resolveHandle, getHandleByAddress, getDisplayIdentity }
}
