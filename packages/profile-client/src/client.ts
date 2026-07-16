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

export interface ProfileClient {
  getProfileByAddress(address: string): Promise<StoredPublicProfile | null>
  resolveHandle(handle: string): Promise<HandleClaim | null>
  getHandleByAddress(address: string): Promise<HandleClaim | null>
  getDisplayIdentity(address: string): Promise<DisplayIdentity>
}

export function createProfileClient(options: ProfileClientOptions): ProfileClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')

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

  async function resolveHandle(): Promise<HandleClaim | null> {
    throw new Error('not implemented')
  }

  async function getHandleByAddress(): Promise<HandleClaim | null> {
    throw new Error('not implemented')
  }

  async function getDisplayIdentity(): Promise<DisplayIdentity> {
    throw new Error('not implemented')
  }

  return { getProfileByAddress, resolveHandle, getHandleByAddress, getDisplayIdentity }
}
