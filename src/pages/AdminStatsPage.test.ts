import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminStatsChart from '../components/AdminStatsChart.vue'
import AdminStatsPage from './AdminStatsPage.vue'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  fetchStats: vi.fn(),
  fetchAdminHandles: vi.fn(),
  getSessionToken: vi.fn(),
  getDesktopHubAddress: vi.fn(),
}))

vi.mock('../services/adminAuth', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/adminAuth')>()
  return {
    ...actual,
    login: mocks.login,
    fetchStats: mocks.fetchStats,
    fetchAdminHandles: mocks.fetchAdminHandles,
    getSessionToken: mocks.getSessionToken,
  }
})

vi.mock('../services/desktop-session', () => ({
  getDesktopHubAddress: () => mocks.getDesktopHubAddress(),
}))

const summary = {
  unique_wallets: 12,
  unique_handles: 9,
  total_opens: 40,
  days: [
    { day: '2026-07-21', wallets: 5, opens: 15, handles: 4 },
    { day: '2026-07-22', wallets: 7, opens: 25, handles: 5 },
  ],
}

const handles = [
  {
    handle: 'alice',
    address: 'NQ11 ALICE WALLET',
    tx_hash: 'alice-tx',
    claimed_at: Date.UTC(2026, 6, 21),
  },
  {
    handle: 'chuck',
    address: 'NQ22 CHUCK WALLET',
    tx_hash: 'chuck-tx',
    claimed_at: Date.UTC(2026, 6, 22),
  },
]

describe('AdminStatsPage', () => {
  beforeEach(() => {
    mocks.login.mockReset()
    mocks.fetchStats.mockReset()
    mocks.fetchAdminHandles.mockReset()
    mocks.getSessionToken.mockReset()
    mocks.getDesktopHubAddress.mockReset()
    mocks.fetchAdminHandles.mockResolvedValue([])
    mocks.getDesktopHubAddress.mockReturnValue(null)
  })

  it('shows a connect prompt when there is no session', async () => {
    mocks.getSessionToken.mockReturnValue(null)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.find('[data-connect]').exists()).toBe(true)
    expect(wrapper.find('[data-connect]').text()).toBe('Connect wallet')
    expect(mocks.fetchStats).not.toHaveBeenCalled()
  })

  it('asks only for a signature when a desktop Hub address is already connected', async () => {
    mocks.getSessionToken.mockReturnValue(null)
    mocks.getDesktopHubAddress.mockReturnValue('NQ17 VERV F3MQ 283T NRSR FPJG 55BJ PMHC N8MD')
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.find('[data-connect]').text()).toBe('Sign to view stats')
  })

  it('loads and renders stats when a session exists', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    mocks.fetchStats.mockResolvedValue(summary)
    mocks.fetchAdminHandles.mockResolvedValue(handles)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('12')
    expect(wrapper.text()).toContain('40')
    expect(wrapper.text()).toContain('Claimed handles')
    expect(wrapper.find('[data-handles-total]').text()).toBe('9')
    expect(wrapper.text()).toContain('Handles claimed')
    expect(wrapper.findAll('[data-handles]').map(cell => cell.text())).toEqual(['5', '4'])
    expect(wrapper.findAll('[data-day-row]')).toHaveLength(2)
    expect(wrapper.findComponent(AdminStatsChart).exists()).toBe(true)
    const dailyTable = wrapper.get('[data-daily-table]')
    expect((dailyTable.element as HTMLDetailsElement).open).toBe(false)
    expect(dailyTable.get('summary').text()).toBe('View daily table')
    expect(dailyTable.findAll('[data-day-row]')).toHaveLength(2)
    ;(dailyTable.element as HTMLDetailsElement).open = true
    await wrapper.vm.$nextTick()
    expect(dailyTable.text()).toContain('2026-07-22')
    expect(dailyTable.text()).toContain('25')
    expect(wrapper.text()).toContain('Current handles (2)')
    expect(wrapper.findAll('[data-handle-row]').map(row => row.text())).toEqual([
      expect.stringContaining('@alice'),
      expect.stringContaining('@chuck'),
    ])
    expect(wrapper.get('[data-handle-profile="alice"]').attributes('href')).toBe('/#/u/alice')
    expect(wrapper.get('[data-handle-tx="alice"]').attributes('href')).toBe(
      'https://nimiqscan.com/transaction/alice-tx',
    )
    expect(wrapper.get('[data-handle-address="alice"]').attributes('title')).toBe('NQ11 ALICE WALLET')
    expect(wrapper.get('[data-handle-tx="alice"]').attributes('title')).toBe('alice-tx')
  })

  it('filters current handles by handle or compact wallet address', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    mocks.fetchStats.mockResolvedValue(summary)
    mocks.fetchAdminHandles.mockResolvedValue(handles)
    const wrapper = mount(AdminStatsPage)
    await flushPromises()

    await wrapper.get('[data-handle-search]').setValue('chuck')
    expect(wrapper.findAll('[data-handle-row]')).toHaveLength(1)
    expect(wrapper.text()).toContain('@chuck')
    expect(wrapper.text()).not.toContain('@alice')

    await wrapper.get('[data-handle-search]').setValue('NQ11ALICE')
    expect(wrapper.findAll('[data-handle-row]')).toHaveLength(1)
    expect(wrapper.text()).toContain('@alice')
    expect(wrapper.text()).not.toContain('@chuck')
  })

  it('shows empty registry and empty search result states', async () => {
    mocks.getSessionToken.mockReturnValue('tok')
    mocks.fetchStats.mockResolvedValue(summary)
    mocks.fetchAdminHandles.mockResolvedValue([])
    const wrapper = mount(AdminStatsPage)
    await flushPromises()
    expect(wrapper.text()).toContain('No handles are currently claimed.')

    mocks.fetchAdminHandles.mockResolvedValue(handles)
    const populated = mount(AdminStatsPage)
    await flushPromises()
    await populated.get('[data-handle-search]').setValue('nobody')
    expect(populated.text()).toContain('No matching handles.')
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
