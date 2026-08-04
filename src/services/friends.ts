import { createProfileClient, type FriendEntry, type ProfileClient } from '@nimconnect/profile-client'
import { resolveApiBase } from './api'
import { getDesktopHubAddress } from './desktop-session'
import { chooseHubAddress, hubSignMessage } from './hub'
import { getMyAddress, insideNimiqPay, signChallenge } from './nimiq'

const SESSION_KEY = 'nimconnect:user-session'

interface StoredSession {
  token: string
  expiresAt: number
}

let client: ProfileClient | null = null

function readStored(): StoredSession | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function writeStored(session: StoredSession): void {
  try {
    globalThis.sessionStorage?.setItem(SESSION_KEY, JSON.stringify(session))
  } catch { /* best-effort */ }
}

export function clearFriendsSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(SESSION_KEY)
  } catch { /* best-effort */ }
  client?.clearSession()
  client = null
}

export function getStoredFriendsSessionToken(): string | null {
  const stored = readStored()
  if (!stored) return null
  if (stored.expiresAt * 1000 <= Date.now()) {
    clearFriendsSession()
    return null
  }
  return stored.token
}

function getClient(): ProfileClient {
  if (!client) {
    client = createProfileClient({
      baseUrl: resolveApiBase(),
      sessionToken: getStoredFriendsSessionToken(),
      audience: 'nimconnect',
    })
  }
  return client
}

async function resolveAddressAndSigner(): Promise<{
  address: string
  signMessage: (message: string) => Promise<{ publicKey: string; signature: string }>
}> {
  if (insideNimiqPay.value) {
    const address = await getMyAddress()
    if (!address) throw new Error('Wallet unavailable')
    return { address, signMessage: signChallenge }
  }
  const address = getDesktopHubAddress() ?? await chooseHubAddress()
  return {
    address,
    signMessage: (message) => hubSignMessage(message, address),
  }
}

/** Ensure a valid NimConnect user session exists (wallet sign once if needed). */
export async function ensureFriendsSession(): Promise<ProfileClient> {
  const c = getClient()
  if (c.getSessionToken()) return c

  const { address, signMessage } = await resolveAddressAndSigner()
  const { token, expiresAt } = await c.createSession({ address, signMessage })
  writeStored({ token, expiresAt })
  return c
}

export async function listFriends(): Promise<FriendEntry[]> {
  const c = await ensureFriendsSession()
  return c.listFriends()
}

export async function listFriendRequests(): Promise<FriendEntry[]> {
  const c = await ensureFriendsSession()
  return c.listFriendRequests()
}

export async function sendFriendRequest(to: string): Promise<FriendEntry> {
  const c = await ensureFriendsSession()
  return c.sendFriendRequest(to.trim())
}

export async function acceptFriendRequest(id: string): Promise<void> {
  const c = await ensureFriendsSession()
  await c.acceptFriendRequest(id)
}

export async function declineFriendRequest(id: string): Promise<void> {
  const c = await ensureFriendsSession()
  await c.declineFriendRequest(id)
}

export async function removeFriend(address: string): Promise<void> {
  const c = await ensureFriendsSession()
  await c.removeFriend(address)
}

export type { FriendEntry }
