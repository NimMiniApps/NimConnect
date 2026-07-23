import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminStatsPage from './AdminStatsPage.vue'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  fetchStats: vi.fn(),
  getSessionToken: vi.fn(),
}))

vi.mock('../services/adminAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/adminAuth')>()
  return {
    ...actual,
    login: mocks.login,
    fetchStats: mocks.fetchStats,
    getSessionToken: mocks.getSessionToken,
  }
})

const summary = {
  unique_wallets: 12,
  total_opens: 40,
  days: [
    { day: '2026-07-21', wallets: 5, opens: 15 },
    { day: '2026-07-22', wallets: 7, opens: 25 },
  ],
}

describe('AdminStatsPage', () => {
  beforeEach(() => {
    mocks.login.mockReset()
    mocks.fetchStats.mockReset()
    mocks.getSessionToken.mockReset()
  })

  it('shows a connect prompt when there is no session', async () => {
    mocks.getSessionToken.mockReturnValue(null)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.find('[data-connect]').exists()).toBe(true)
    expect(mocks.fetchStats).not.toHaveBeenCalled()
  })

  it('loads and renders stats when a session exists', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    mocks.fetchStats.mockResolvedValue(summary)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('12')
    expect(wrapper.text()).toContain('40')
    expect(wrapper.findAll('[data-day-row]')).toHaveLength(2)
  })

  it('falls back to the connect prompt on AdminSessionExpiredError', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    const { AdminSessionExpiredError } = await import('../services/adminAuth')
    mocks.fetchStats.mockRejectedValue(new AdminSessionExpiredError())
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.find('[data-connect]').exists()).toBe(true)
  })

  it('shows a retryable error and keeps the session on a network/5xx failure', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    mocks.fetchStats.mockRejectedValue(new Error('stats fetch failed (500)'))
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.find('[data-connect]').exists()).toBe(false)
    expect(wrapper.find('[data-retry]').exists()).toBe(true)
  })

  it('connect button calls login() then loads stats', async () => {
    mocks.getSessionToken.mockReturnValue(null)
    mocks.login.mockResolvedValue(undefined)
    mocks.fetchStats.mockResolvedValue(summary)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()

    await wrapper.find('[data-connect]').trigger('click')
    await flushPromises()

    expect(mocks.login).toHaveBeenCalled()
    expect(wrapper.text()).toContain('12')
  })
})
