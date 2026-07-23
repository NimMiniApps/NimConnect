import { apiUrl } from './api'
import { chooseHubAddress, hubSignMessage } from './hub'

const SESSION_KEY = 'nimconnect:admin-session'

interface StoredSession {
  token: string
  expiresAt: number // unix seconds
}

export class AdminSessionExpiredError extends Error {
  constructor() {
    super('admin session expired')
    this.name = 'AdminSessionExpiredError'
  }
}

function compactAddress(address: string): string {
  return address.replace(/\s+/g, '')
}

function adminLoginChallenge(address: string, timestamp: number): string {
  return `nimconnect-admin-login:v1:${compactAddress(address)}:${timestamp}`
}

function readStored(): StoredSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function writeStored(session: StoredSession): void {
  try {
    globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(session))
  } catch { /* best-effort */ }
}

export function logout(): void {
  try {
    globalThis.localStorage?.removeItem(SESSION_KEY)
  } catch { /* best-effort */ }
}

/** Stored session token, or null if missing/expired (clearing storage when expired). */
export function getSessionToken(): string | null {
  const stored = readStored()
  if (!stored) return null
  if (stored.expiresAt * 1000 <= Date.now()) {
    logout()
    return null
  }
  return stored.token
}

/** Hub sign-in flow → POST /api/admin/login → stores the returned session. */
export async function login(): Promise<void> {
  const address = await chooseHubAddress()
  const timestamp = Math.floor(Date.now() / 1000)
  const challenge = adminLoginChallenge(address, timestamp)
  const { publicKey, signature } = await hubSignMessage(challenge, address)

  const res = await fetch(apiUrl('/api/admin/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, publicKey, signature, timestamp }),
  })
  if (!res.ok) throw new Error(`admin login failed (${res.status})`)
  const body = await res.json() as { token: string; expires_at: number }
  writeStored({ token: body.token, expiresAt: body.expires_at })
}

export interface DayStats {
  day: string
  wallets: number
  opens: number
}

export interface StatsSummary {
  unique_wallets: number
  total_opens: number
  days: DayStats[]
}

/** GET /api/stats with the stored session. 401 clears the session; other failures do not. */
export async function fetchStats(): Promise<StatsSummary> {
  const token = getSessionToken()
  const res = await fetch(apiUrl('/api/stats'), {
    headers: token ? { 'X-Admin-Session': token } : {},
  })
  if (res.status === 401) {
    logout()
    throw new AdminSessionExpiredError()
  }
  if (!res.ok) throw new Error(`stats fetch failed (${res.status})`)
  return (await res.json()) as StatsSummary
}
