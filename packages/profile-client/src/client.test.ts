import { describe, it, expect, vi, afterEach } from 'vitest'
import { createProfileClient } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getProfileByAddress', () => {
  it('returns parsed profile on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        address: 'NQ01 TEST',
        updated_at: 1,
        profile: { display_name: 'Ada', bio: 'hi' },
      }),
    }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.getProfileByAddress('NQ01 TEST')
    expect(result).toEqual({
      address: 'NQ01 TEST',
      updatedAt: 1,
      profile: { display_name: 'Ada', bio: 'hi' },
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://nc.example/api/profile/NQ01TEST',
      expect.any(Object),
    )
  })

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    expect(await client.getProfileByAddress('NQ01 MISSING')).toBeNull()
  })
})
