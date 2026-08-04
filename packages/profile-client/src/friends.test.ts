import { describe, it, expect, vi, afterEach } from 'vitest'
import { createProfileClient } from './client.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function clientWithSession(token = 'sess') {
  const client = createProfileClient({ baseUrl: 'https://nc.example', sessionToken: token })
  return client
}

describe('friends methods', () => {
  it('listFriends sends the session header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          address: 'NQ26…',
          handle: 'bob',
          displayName: 'Bob',
          status: 'accepted',
          friendshipId: 'f1',
        },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)

    const friends = await clientWithSession().listFriends()
    expect(friends).toEqual([
      {
        address: 'NQ26…',
        handle: 'bob',
        displayName: 'Bob',
        status: 'accepted',
        friendshipId: 'f1',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://nc.example/api/friends',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-NimConnect-Session': 'sess' }),
      }),
    )
  })

  it('listFriendRequests hits /api/friends/requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    })
    vi.stubGlobal('fetch', fetchMock)
    await clientWithSession().listFriendRequests()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://nc.example/api/friends/requests',
      expect.any(Object),
    )
  })

  it('sendFriendRequest posts { to }', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        address: 'NQ26',
        status: 'pending_out',
        friendshipId: 'f2',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const entry = await clientWithSession().sendFriendRequest('bob')
    expect(entry.friendshipId).toBe('f2')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://nc.example/api/friends/requests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: 'bob' }),
      }),
    )
  })

  it('acceptFriendRequest / declineFriendRequest / removeFriend', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const client = clientWithSession()

    await client.acceptFriendRequest('id-1')
    await client.declineFriendRequest('id-2')
    await client.removeFriend('NQ26 TEST')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://nc.example/api/friends/requests/id-1/accept',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://nc.example/api/friends/requests/id-2/decline',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://nc.example/api/friends/NQ26TEST',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('throws when no session is set', async () => {
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    await expect(client.listFriends()).rejects.toThrow(/session/)
  })

  it('surfaces 401 and 409 errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(clientWithSession().listFriends()).rejects.toThrow(/401/)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 409 }),
    )
    await expect(clientWithSession().sendFriendRequest('bob')).rejects.toThrow(/409/)
  })
})
