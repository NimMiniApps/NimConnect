import { describe, it, expect, vi, afterEach } from 'vitest'
import { createProfileClient, DEFAULT_BASE_URL } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createProfileClient', () => {
  it('uses the default base URL when options omit baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)
    const client = createProfileClient()
    await client.getProfileByAddress('NQ01 TEST')
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEFAULT_BASE_URL}/api/profile/NQ01TEST`,
      expect.any(Object),
    )
  })
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

describe('resolveHandle', () => {
  it('returns parsed claim on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        handle: 'ada',
        address: 'NQ01 TEST',
        tx_hash: 'abc123',
        block_height: 42,
        tx_index: 1,
      }),
    }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.resolveHandle('ada')
    expect(result).toEqual({
      handle: 'ada',
      address: 'NQ01 TEST',
      txHash: 'abc123',
      blockHeight: 42,
      txIndex: 1,
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://nc.example/api/resolve/ada',
      expect.any(Object),
    )
  })

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    expect(await client.resolveHandle('missing')).toBeNull()
  })
})

describe('getHandleByAddress', () => {
  it('returns parsed claim on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        handle: 'ada',
        address: 'NQ01 TEST',
        tx_hash: 'abc123',
        block_height: 42,
        tx_index: 1,
      }),
    }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.getHandleByAddress('NQ01 TEST')
    expect(result).toEqual({
      handle: 'ada',
      address: 'NQ01 TEST',
      txHash: 'abc123',
      blockHeight: 42,
      txIndex: 1,
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://nc.example/api/handles/by-address/NQ01TEST',
      expect.any(Object),
    )
  })

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    expect(await client.getHandleByAddress('NQ01 MISSING')).toBeNull()
  })
})

describe('getDisplayIdentity', () => {
  it('merges handle + profile', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/handles/by-address/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            handle: 'ada',
            address: 'NQ01 TEST',
            tx_hash: 'abc123',
            block_height: 42,
            tx_index: 1,
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          address: 'NQ01 TEST',
          updated_at: 1,
          profile: { display_name: 'Ada Lovelace', bio: 'hi', website: 'https://ada.dev' },
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.getDisplayIdentity('NQ01 TEST')
    expect(result).toEqual({
      address: 'NQ01 TEST',
      handle: 'ada',
      displayName: 'Ada Lovelace',
      bio: 'hi',
      links: { website: 'https://ada.dev', github: undefined, x: undefined },
    })
  })

  it('parallelizes the two GET requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    vi.stubGlobal('fetch', fetchMock)
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    await client.getDisplayIdentity('NQ01 TEST')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns address with undefined handle/displayName when both 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.getDisplayIdentity('NQ01 MISSING')
    expect(result).toEqual({
      address: 'NQ01 MISSING',
      handle: undefined,
      displayName: undefined,
      bio: undefined,
      links: undefined,
    })
  })

  it('does not throw when only the handle lookup is missing', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/handles/by-address/')) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          address: 'NQ01 TEST',
          updated_at: 1,
          profile: { display_name: 'Ada Lovelace' },
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.getDisplayIdentity('NQ01 TEST')
    expect(result.handle).toBeUndefined()
    expect(result.displayName).toBe('Ada Lovelace')
  })

  it('does not throw when only the profile lookup is missing', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/profile/')) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          handle: 'ada',
          address: 'NQ01 TEST',
          tx_hash: 'abc123',
          block_height: 42,
          tx_index: 1,
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.getDisplayIdentity('NQ01 TEST')
    expect(result.handle).toBe('ada')
    expect(result.displayName).toBeUndefined()
  })

  it('keeps profile data when handle lookup returns 500', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/handles/by-address/')) {
        return Promise.resolve({ ok: false, status: 500 })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          address: 'NQ01 TEST',
          updated_at: 1,
          profile: { display_name: 'Ada Lovelace' },
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.getDisplayIdentity('NQ01 TEST')
    expect(result.handle).toBeUndefined()
    expect(result.displayName).toBe('Ada Lovelace')
  })
})
