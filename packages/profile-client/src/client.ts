import type {
  Achievement,
  AppAuthorization,
  DisplayIdentity,
  AuthScope,
  AuthSession,
  FriendEntry,
  HandleClaim,
  ProfileClientOptions,
  RegisteredApp,
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
  getApp(audience: string): Promise<RegisteredApp | null>
  createSession(args: {
    address: string
    signMessage: SignMessageFn
  }): Promise<{ token: string; expiresAt: number }>
  clearSession(): void
  getSessionToken(): string | null
  createAuthorization(args: { address: string; scopes: AuthScope[]; signMessage: SignMessageFn }): Promise<AuthSession>
  getAuthorization(): AuthSession | null
  revokeAuthorization(all?: boolean): Promise<void>
  listAuthorizations(): Promise<AppAuthorization[]>
  listAchievements(address: string): Promise<Achievement[]>
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
  // First-party session (X-NimConnect-Session). Kept separate from scoped
  // authorization so listAuthorizations still works after createAuthorization.
  let sessionToken: string | null = options.sessionToken ?? null
  let authorization: AuthSession | null = options.authorization ?? null

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

  async function getApp(audienceSlug: string): Promise<RegisteredApp | null> {
    const res = await fetch(`${baseUrl}/api/apps/${encodeURIComponent(audienceSlug)}`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`app fetch failed: ${res.status}`)
    const body = await res.json()
    return {
      audience: body.audience,
      displayName: body.display_name,
      iconUrl: body.icon_url ?? '',
      verified: !!body.verified,
      scopes: body.scopes ?? [],
      origins: body.origins ?? [],
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

  async function createAuthorization(args: {
    address: string
    scopes: AuthScope[]
    signMessage: SignMessageFn
  }): Promise<AuthSession> {
    if (!audience) throw new Error('audience required for scoped authorization')
    const scopes = [...new Set(args.scopes)].sort()
    const challengeRes = await fetch(`${baseUrl}/api/auth/challenges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ address: args.address, audience, scopes }),
    })
    if (!challengeRes.ok) throw new Error(`authorization challenge failed: ${challengeRes.status}`)
    const challenge = await challengeRes.json()
    const { publicKey, signature } = await args.signMessage(challenge.message)
    const sessionRes = await fetch(`${baseUrl}/api/auth/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ challenge_id: challenge.challenge_id, public_key: publicKey, signature }),
    })
    if (!sessionRes.ok) throw new Error(`authorization create failed: ${sessionRes.status}`)
    const body = await sessionRes.json()
    authorization = {
      token: body.token, address: body.address, audience: body.audience,
      scopes: body.scopes, expiresAt: body.expires_at,
    }
    return authorization
  }

  function getAuthorization(): AuthSession | null { return authorization }

  async function revokeAuthorization(all = false): Promise<void> {
    if (!authorization) return
    const res = await fetch(`${baseUrl}${all ? '/api/auth/sessions' : '/api/auth/session'}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${authorization.token}` },
    })
    if (!res.ok && res.status !== 401) throw new Error(`authorization revoke failed: ${res.status}`)
    authorization = null
  }

  function clearSession(): void {
    sessionToken = null
    authorization = null
  }

  function getSessionToken(): string | null {
    return authorization?.token ?? sessionToken
  }

  function requireSessionHeaders(): HeadersInit {
    if (authorization) {
      return { Accept: 'application/json', Authorization: `Bearer ${authorization.token}` }
    }
    if (!sessionToken) throw new Error('session required — call createSession first')
    return {
      Accept: 'application/json',
      'X-NimConnect-Session': sessionToken,
    }
  }

  function requireFirstPartySessionHeaders(): HeadersInit {
    if (!sessionToken) throw new Error('session required — call createSession first')
    return {
      Accept: 'application/json',
      'X-NimConnect-Session': sessionToken,
    }
  }

  async function listAuthorizations(): Promise<AppAuthorization[]> {
    const res = await fetch(`${baseUrl}/api/authorizations`, {
      headers: requireFirstPartySessionHeaders(),
    })
    if (!res.ok) throw new Error(`list authorizations failed: ${res.status}`)
    const body = await res.json()
    return (body.authorizations ?? []).map((g: any) => ({
      audience: g.audience,
      displayName: g.display_name,
      iconUrl: g.icon_url ?? '',
      verified: !!g.verified,
      scopes: g.scopes ?? [],
      grantedAt: g.granted_at,
      expiresAt: g.expires_at,
    }))
  }

  async function listAchievements(address: string): Promise<Achievement[]> {
    const headers: HeadersInit = authorization
      ? { Accept: 'application/json', Authorization: `Bearer ${authorization.token}` }
      : { Accept: 'application/json' }
    const res = await fetch(`${baseUrl}/api/profiles/${compactAddress(address)}/achievements`, {
      headers,
    })
    if (!res.ok) throw new Error(`list achievements failed: ${res.status}`)
    const body = await res.json()
    return (body.achievements ?? []).map((a: any) => ({
      appId: a.app_id,
      achievementId: a.achievement_id,
      address: a.address,
      title: a.title,
      description: a.description ?? '',
      rarity: a.rarity ?? '',
      visibility: a.visibility,
      grantedAt: a.granted_at,
      ...(a.progress !== undefined ? { progress: a.progress } : {}),
    }))
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
    getApp,
    createSession,
    createAuthorization,
    getAuthorization,
    revokeAuthorization,
    clearSession,
    getSessionToken,
    listAuthorizations,
    listAchievements,
    listFriends,
    listFriendRequests,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
  }
}
