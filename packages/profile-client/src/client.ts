import type {
  DisplayIdentity,
  FriendEntry,
  HandleClaim,
  ProfileClientOptions,
  SignMessageFn,
  StoredPublicProfile,
} from './types.js'
import { userSessionChallenge, userSessionChallengeV1 } from './session.js'

/** Strip spaces and uppercase, matching NimConnect backend's `compactAddress`. */
export function compactAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/** Production API origin (SPA is on nimconnect.nimiqminiapps.com; API is separate). */
export const DEFAULT_BASE_URL = 'https://api-nimconnect.nimiqminiapps.com'

export interface ProfileClient {
  getProfileByAddress(address: string): Promise<StoredPublicProfile | null>
  resolveHandle(handle: string): Promise<HandleClaim | null>
  resolveHandleForPayment(handle: string): Promise<HandleClaim | null>
  getHandleByAddress(address: string): Promise<HandleClaim | null>
  getDisplayIdentity(address: string): Promise<DisplayIdentity>
  createSession(args: {
    address: string
    signMessage: SignMessageFn
  }): Promise<{ token: string; expiresAt: number }>
  clearSession(): void
  getSessionToken(): string | null
  listFriends(): Promise<FriendEntry[]>
  listFriendRequests(): Promise<FriendEntry[]>
  sendFriendRequest(to: string): Promise<FriendEntry>
  acceptFriendRequest(id: string): Promise<void>
  declineFriendRequest(id: string): Promise<void>
  removeFriend(address: string): Promise<void>
}

export function createProfileClient(options: ProfileClientOptions = {}): ProfileClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const audience = options.audience
  let sessionToken: string | null = options.sessionToken ?? null

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

  async function resolveHandleForPayment(handle: string): Promise<HandleClaim | null> {
    const res = await fetch(`${baseUrl}/api/pay/resolve/${encodeURIComponent(handle)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`payment handle resolve failed: ${res.status}`)
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
    // allSettled: a 5xx/network failure on one side must not discard the other.
    const [handleResult, profileResult] = await Promise.allSettled([
      getHandleByAddress(address),
      getProfileByAddress(address),
    ])
    const handleClaim = handleResult.status === 'fulfilled' ? handleResult.value : null
    const storedProfile = profileResult.status === 'fulfilled' ? profileResult.value : null
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

  async function createSession(args: {
    address: string
    signMessage: SignMessageFn
  }): Promise<{ token: string; expiresAt: number }> {
    const timestamp = Math.floor(Date.now() / 1000)
    const message = audience
      ? userSessionChallenge(args.address, timestamp, audience)
      : userSessionChallengeV1(args.address, timestamp)
    const { publicKey, signature } = await args.signMessage(message)
    const payload: Record<string, string | number> = {
      address: args.address,
      publicKey,
      signature,
      timestamp,
    }
    if (audience) payload.audience = audience
    const res = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`session create failed: ${res.status}`)
    const body = await res.json()
    sessionToken = body.token
    return { token: body.token, expiresAt: body.expires_at }
  }

  function clearSession(): void {
    sessionToken = null
  }

  function getSessionToken(): string | null {
    return sessionToken
  }

  function requireSessionHeaders(): HeadersInit {
    if (!sessionToken) throw new Error('session required — call createSession first')
    return {
      Accept: 'application/json',
      'X-NimConnect-Session': sessionToken,
    }
  }

  function parseFriendEntry(body: any): FriendEntry {
    return {
      address: body.address,
      handle: body.handle,
      displayName: body.displayName,
      status: body.status,
      friendshipId: body.friendshipId,
    }
  }

  async function listFriends(): Promise<FriendEntry[]> {
    const res = await fetch(`${baseUrl}/api/friends`, { headers: requireSessionHeaders() })
    if (!res.ok) throw new Error(`list friends failed: ${res.status}`)
    const body = await res.json()
    return (body as any[]).map(parseFriendEntry)
  }

  async function listFriendRequests(): Promise<FriendEntry[]> {
    const res = await fetch(`${baseUrl}/api/friends/requests`, { headers: requireSessionHeaders() })
    if (!res.ok) throw new Error(`list friend requests failed: ${res.status}`)
    const body = await res.json()
    return (body as any[]).map(parseFriendEntry)
  }

  async function sendFriendRequest(to: string): Promise<FriendEntry> {
    const res = await fetch(`${baseUrl}/api/friends/requests`, {
      method: 'POST',
      headers: {
        ...requireSessionHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to }),
    })
    if (!res.ok) throw new Error(`send friend request failed: ${res.status}`)
    return parseFriendEntry(await res.json())
  }

  async function acceptFriendRequest(id: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/friends/requests/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      headers: requireSessionHeaders(),
    })
    if (!res.ok) throw new Error(`accept friend request failed: ${res.status}`)
  }

  async function declineFriendRequest(id: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/friends/requests/${encodeURIComponent(id)}/decline`, {
      method: 'POST',
      headers: requireSessionHeaders(),
    })
    if (!res.ok) throw new Error(`decline friend request failed: ${res.status}`)
  }

  async function removeFriend(address: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/friends/${compactAddress(address)}`, {
      method: 'DELETE',
      headers: requireSessionHeaders(),
    })
    if (!res.ok) throw new Error(`remove friend failed: ${res.status}`)
  }

  return {
    getProfileByAddress,
    resolveHandle,
    resolveHandleForPayment,
    getHandleByAddress,
    getDisplayIdentity,
    createSession,
    clearSession,
    getSessionToken,
    listFriends,
    listFriendRequests,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
  }
}
