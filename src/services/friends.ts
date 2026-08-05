import { createProfileClient, type AuthScope, type FriendEntry, type ProfileClient } from '@nimconnect/profile-client'
import { resolveApiBase } from './api'
import { clearLocalAuthorization, currentAuthorization, ensureAuthorization } from './authorization'

let client: ProfileClient | null = null
let clientToken = ''

function scopedClient(token: string, grant: NonNullable<ReturnType<typeof currentAuthorization>>): ProfileClient {
  if (!client || clientToken !== token) {
    client = createProfileClient({ baseUrl: resolveApiBase(), audience: 'nimconnect', authorization: grant })
    clientToken = token
  }
  return client
}

async function ensureFriendsSession(scope: AuthScope): Promise<ProfileClient> {
  const grant = await ensureAuthorization([scope])
  return scopedClient(grant.token, grant)
}

export function clearFriendsSession(): void {
  void clearLocalAuthorization()
  client = null; clientToken = ''
}

export function getStoredFriendsSessionToken(): string | null {
  return currentAuthorization()?.token ?? null
}

export async function listFriends(): Promise<FriendEntry[]> {
  return (await ensureFriendsSession('friends:read')).listFriends()
}

export async function listFriendRequests(): Promise<FriendEntry[]> {
  return (await ensureFriendsSession('friends:read')).listFriendRequests()
}

export async function sendFriendRequest(to: string): Promise<FriendEntry> {
  return (await ensureFriendsSession('friends:write')).sendFriendRequest(to.trim())
}

export async function acceptFriendRequest(id: string): Promise<void> {
  await (await ensureFriendsSession('friends:write')).acceptFriendRequest(id)
}

export async function declineFriendRequest(id: string): Promise<void> {
  await (await ensureFriendsSession('friends:write')).declineFriendRequest(id)
}

export async function removeFriend(address: string): Promise<void> {
  await (await ensureFriendsSession('friends:write')).removeFriend(address)
}

export { ensureFriendsSession }
export type { FriendEntry }
