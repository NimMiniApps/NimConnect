import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FriendsPage from './FriendsPage.vue'

const mocks = vi.hoisted(() => ({
  getStoredFriendsSessionToken: vi.fn(),
  listFriends: vi.fn(),
  listFriendRequests: vi.fn(),
  sendFriendRequest: vi.fn(),
  acceptFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(),
  removeFriend: vi.fn(),
  clearFriendsSession: vi.fn(),
}))

vi.mock('../services/friends', () => ({
  getStoredFriendsSessionToken: mocks.getStoredFriendsSessionToken,
  listFriends: mocks.listFriends,
  listFriendRequests: mocks.listFriendRequests,
  sendFriendRequest: mocks.sendFriendRequest,
  acceptFriendRequest: mocks.acceptFriendRequest,
  declineFriendRequest: mocks.declineFriendRequest,
  removeFriend: mocks.removeFriend,
  clearFriendsSession: mocks.clearFriendsSession,
}))

vi.mock('../services/links', () => ({
  shortAddress: (a: string) => a.slice(0, 8),
}))

describe('FriendsPage', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset()
    mocks.getStoredFriendsSessionToken.mockReturnValue(null)
    mocks.listFriends.mockResolvedValue([])
    mocks.listFriendRequests.mockResolvedValue([])
  })

  it('prompts to connect when there is no session', () => {
    const wrapper = mount(FriendsPage, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, EmptyState: true } },
    })
    expect(wrapper.find('[data-connect]').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/Sign once with your wallet/)
  })

  it('renders empty friends and request lists after session load', async () => {
    mocks.getStoredFriendsSessionToken.mockReturnValue('tok')
    mocks.listFriends.mockResolvedValue([])
    mocks.listFriendRequests.mockResolvedValue([
      {
        address: 'NQ26AAAA',
        handle: 'bob',
        displayName: 'Bob',
        status: 'pending_in',
        friendshipId: 'r1',
      },
    ])

    const wrapper = mount(FriendsPage, {
      global: {
        stubs: {
          RouterLink: { template: '<a><slot /></a>' },
          EmptyState: { template: '<div data-empty>No friends yet</div>', props: ['icon', 'title', 'hint'] },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Incoming')
    expect(wrapper.text()).toContain('Bob')
    expect(wrapper.text()).toContain('No friends yet')
    expect(wrapper.find('#friend-to').exists()).toBe(true)
  })
})
