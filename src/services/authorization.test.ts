import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAuthorization: vi.fn(),
  getAuthorization: vi.fn(),
  revokeAuthorization: vi.fn(),
  getMyAddress: vi.fn(),
  signChallenge: vi.fn(),
  kvGet: vi.fn(),
  kvPut: vi.fn(),
  kvDelete: vi.fn(),
}))

vi.mock('@nimconnect/profile-client', () => ({
  createProfileClient: () => ({
    createAuthorization: mocks.createAuthorization,
    getAuthorization: mocks.getAuthorization,
    revokeAuthorization: mocks.revokeAuthorization,
  }),
}))
vi.mock('../db/db', () => ({ db: { kv: { get: mocks.kvGet, put: mocks.kvPut, delete: mocks.kvDelete } } }))
vi.mock('./nimiq', () => ({ insideNimiqPay: { value: true }, getMyAddress: mocks.getMyAddress, signChallenge: mocks.signChallenge }))
vi.mock('./desktop-session', () => ({ getDesktopHubAddress: () => null }))
vi.mock('./hub', () => ({ chooseHubAddress: vi.fn(), hubSignMessage: vi.fn() }))
vi.mock('./api', () => ({ resolveApiBase: () => '' }))

describe('ensureAuthorization', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.getMyAddress.mockResolvedValue('NQ17 TEST') })

  it('deduplicates concurrent authorization and persists the seven-day grant', async () => {
    mocks.kvGet.mockResolvedValue(undefined)
    mocks.createAuthorization.mockResolvedValue({
      token: 'token', address: 'NQ17 TEST', audience: 'nimconnect',
      scopes: ['friends:read', 'friends:write', 'inbox:read', 'inbox:send', 'inbox:delete', 'profile:write', 'backup:read', 'backup:write', 'marketplace:read', 'marketplace:trade'],
      expiresAt: 2_000_000_000,
    })
    const { ensureAuthorization } = await import('./authorization')
    const [a, b] = await Promise.all([
      ensureAuthorization(['friends:read']), ensureAuthorization(['inbox:read']),
    ])
    expect(a.token).toBe('token'); expect(b.token).toBe('token')
    expect(mocks.createAuthorization).toHaveBeenCalledTimes(1)
    expect(mocks.kvPut).toHaveBeenCalledOnce()
  })
})
