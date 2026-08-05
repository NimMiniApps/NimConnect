import { createProfileClient, type AuthScope, type AuthSession, type ProfileClient } from '@nimconnect/profile-client'
import { db } from '../db/db'
import { resolveApiBase, apiUrl } from './api'
import { getDesktopHubAddress } from './desktop-session'
import { chooseHubAddress, hubSignMessage } from './hub'
import { getMyAddress, insideNimiqPay, signChallenge } from './nimiq'

export const NIMCONNECT_SCOPES: AuthScope[] = [
  'friends:read', 'friends:write', 'inbox:read', 'inbox:send', 'inbox:delete',
  'profile:write', 'backup:read', 'backup:write', 'marketplace:read', 'marketplace:trade',
]

const compact = (address: string) => address.replace(/\s+/g, '').toUpperCase()
const storageKey = (address: string) => `authorization:nimconnect:${compact(address)}`

let client: ProfileClient | null = null
let active: AuthSession | null = null
let authorizationPromise: Promise<AuthSession> | null = null

async function addressAndSigner() {
  if (insideNimiqPay.value) {
    const address = await getMyAddress()
    if (!address) throw new Error('Wallet unavailable')
    return { address, signMessage: signChallenge }
  }
  const address = getDesktopHubAddress() ?? await chooseHubAddress()
  return { address, signMessage: (message: string) => hubSignMessage(message, address) }
}

function getClient(grant?: AuthSession | null): ProfileClient {
  if (!client || (grant && client.getAuthorization()?.token !== grant.token)) {
    client = createProfileClient({ baseUrl: resolveApiBase(), audience: 'nimconnect', authorization: grant })
  }
  return client
}

function hasScopes(grant: AuthSession, scopes: AuthScope[]): boolean {
  const held = new Set(grant.scopes)
  return scopes.every(scope => held.has(scope))
}

export async function ensureAuthorization(scopes: AuthScope[]): Promise<AuthSession> {
  if (active && active.expiresAt * 1000 > Date.now() && hasScopes(active, scopes)) return active
  if (authorizationPromise) return authorizationPromise
  authorizationPromise = (async () => {
    const { address, signMessage } = await addressAndSigner()
    const stored = (await db.kv.get(storageKey(address)))?.value as AuthSession | undefined
    if (stored && compact(stored.address) === compact(address) && stored.expiresAt * 1000 > Date.now() && hasScopes(stored, scopes)) {
      active = stored; getClient(stored); return stored
    }
    if (stored) await db.kv.delete(storageKey(address))
    const grant = await getClient().createAuthorization({ address, scopes: NIMCONNECT_SCOPES, signMessage })
    active = grant
    await db.kv.put({ key: storageKey(address), value: grant })
    return grant
  })()
  try { return await authorizationPromise } finally { authorizationPromise = null }
}

export async function authorizedFetch(path: string, scopes: AuthScope[], init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const grant = await ensureAuthorization(scopes)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${grant.token}`)
    const response = await fetch(apiUrl(path), { ...init, headers })
    if (response.status !== 401 || attempt === 1) return response
    await clearLocalAuthorization(grant.address)
  }
  throw new Error('authorization unavailable')
}

export async function clearLocalAuthorization(address?: string): Promise<void> {
  if (address) await db.kv.delete(storageKey(address))
  else if (active) await db.kv.delete(storageKey(active.address))
  active = null; client = null
}

export async function revokeAuthorization(all = false): Promise<void> {
  if (!active) return
  const address = active.address
  try { await getClient(active).revokeAuthorization(all) } finally { await clearLocalAuthorization(address) }
}

export function currentAuthorization(): AuthSession | null { return active }
