import { beforeEach, describe, expect, it, vi } from 'vitest'

const chooseHubAddress = vi.fn()
const hubSignMessage = vi.fn()
const getDesktopHubAddress = vi.fn()

vi.mock('./hub', () => ({ chooseHubAddress, hubSignMessage }))
vi.mock('./desktop-session', () => ({ getDesktopHubAddress }))

const address = 'NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD'

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }))
}

describe('adminAuth', () => {
  beforeEach(() => {
    vi.resetModules()
    chooseHubAddress.mockReset()
    hubSignMessage.mockReset()
    getDesktopHubAddress.mockReset()
    getDesktopHubAddress.mockReturnValue(null)
    globalThis.localStorage?.clear()
    vi.useRealTimers()
  })

  it('login signs the exact challenge string and stores the returned session via apiUrl()', async () => {
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
    chooseHubAddress.mockResolvedValue(address)
    hubSignMessage.mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    mockFetchOnce(200, { token: 'tok-1', expires_at: 1785000000 })

    const { login, getSessionToken } = await import('./adminAuth')
    await login()

    const ts = Math.floor(new Date('2026-07-22T12:00:00Z').getTime() / 1000)
    expect(chooseHubAddress).toHaveBeenCalled()
    expect(hubSignMessage).toHaveBeenCalledWith(
      `nimconnect-admin-login:v1:${address.replace(/\s+/g, '')}:${ts}`,
      address,
    )
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/login'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(getSessionToken()).toBe('tok-1')
    vi.useRealTimers()
  })

  it('login reuses the connected desktop Hub address and skips chooseHubAddress', async () => {
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
    getDesktopHubAddress.mockReturnValue(address)
    hubSignMessage.mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    mockFetchOnce(200, { token: 'tok-reuse', expires_at: 1785000000 })

    const { login, getSessionToken } = await import('./adminAuth')
    await login()

    expect(chooseHubAddress).not.toHaveBeenCalled()
    const ts = Math.floor(new Date('2026-07-22T12:00:00Z').getTime() / 1000)
    expect(hubSignMessage).toHaveBeenCalledWith(
      `nimconnect-admin-login:v1:${address.replace(/\s+/g, '')}:${ts}`,
      address,
    )
    expect(getSessionToken()).toBe('tok-reuse')
    vi.useRealTimers()
  })

  it('getSessionToken returns null and clears storage once expired', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'stale', expiresAt: 1 }), // expired long ago
    )
    const { getSessionToken } = await import('./adminAuth')
    expect(getSessionToken()).toBeNull()
    expect(globalThis.localStorage?.getItem('nimconnect:admin-session')).toBeNull()
  })

  it('fetchStats sends the session token in X-Admin-Session', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'tok-2', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    )
    mockFetchOnce(200, { unique_wallets: 3, unique_handles: 2, total_opens: 10, days: [] })

    const { fetchStats } = await import('./adminAuth')
    const summary = await fetchStats()

    expect(summary.unique_wallets).toBe(3)
    expect(summary.unique_handles).toBe(2)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/stats'),
      expect.objectContaining({ headers: { 'X-Admin-Session': 'tok-2' } }),
    )
  })

  it('fetchStats clears the session and throws AdminSessionExpiredError on 401', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'tok-3', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    )
    mockFetchOnce(401, { error: 'unauthorized' })

    const { fetchStats, AdminSessionExpiredError, getSessionToken } = await import('./adminAuth')
    await expect(fetchStats()).rejects.toBeInstanceOf(AdminSessionExpiredError)
    expect(getSessionToken()).toBeNull()
  })

  it('fetchStats leaves the session intact on a network/5xx failure', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'tok-4', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    )
    mockFetchOnce(500, { error: 'boom' })

    const { fetchStats, getSessionToken } = await import('./adminAuth')
    await expect(fetchStats()).rejects.toThrow()
    expect(getSessionToken()).toBe('tok-4')
  })

  it('fetchAdminHandles returns the authenticated current handle directory', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'tok-handles', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    )
    mockFetchOnce(200, {
      handles: [
        { handle: 'alice', address: 'NQ11 OWNER', tx_hash: 'tx-1', claimed_at: 1785270866171 },
      ],
    })

    const { fetchAdminHandles } = await import('./adminAuth')
    const handles = await fetchAdminHandles()

    expect(handles).toEqual([
      { handle: 'alice', address: 'NQ11 OWNER', tx_hash: 'tx-1', claimed_at: 1785270866171 },
    ])
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/handles'),
      expect.objectContaining({ headers: { 'X-Admin-Session': 'tok-handles' } }),
    )
  })

  it('fetchAdminHandles clears the session and throws AdminSessionExpiredError on 401', async () => {
    globalThis.localStorage?.setItem(
      'nimconnect:admin-session',
      JSON.stringify({ token: 'tok-handles-expired', expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    )
    mockFetchOnce(401, { error: 'unauthorized' })

    const { fetchAdminHandles, AdminSessionExpiredError, getSessionToken } = await import('./adminAuth')
    await expect(fetchAdminHandles()).rejects.toBeInstanceOf(AdminSessionExpiredError)
    expect(getSessionToken()).toBeNull()
  })
})
