import { describe, it, expect, vi, afterEach } from 'vitest'
import { createProfileClient } from './client.js'
import { userSessionChallenge } from './session.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('userSessionChallenge', () => {
  it('matches the backend challenge format', () => {
    expect(userSessionChallenge('NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD', 1700000000)).toBe(
      'nimconnect-session:v1:NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD:1700000000',
    )
  })
})

describe('createSession', () => {
  it('signs the challenge and stores the returned token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'tok-1', expires_at: 1700086400 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const signMessage = vi.fn().mockResolvedValue({
      publicKey: 'aa',
      signature: 'bb',
    })

    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const result = await client.createSession({
      address: 'NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD',
      signMessage,
    })

    expect(result).toEqual({ token: 'tok-1', expiresAt: 1700086400 })
    expect(client.getSessionToken()).toBe('tok-1')
    expect(signMessage).toHaveBeenCalledWith(
      'nimconnect-session:v1:NQ17VERVF3MQ283TNRSRFPJG55BJPMHCN8MD:1700000000',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://nc.example/api/session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          address: 'NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD',
          publicKey: 'aa',
          signature: 'bb',
          timestamp: 1700000000,
        }),
      }),
    )

    client.clearSession()
    expect(client.getSessionToken()).toBeNull()
    nowSpy.mockRestore()
  })

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    await expect(
      client.createSession({
        address: 'NQ01',
        signMessage: async () => ({ publicKey: 'a', signature: 'b' }),
      }),
    ).rejects.toThrow(/session/)
  })
})
