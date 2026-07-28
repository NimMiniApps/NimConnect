import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DesktopMarketplacePage from './DesktopMarketplacePage.vue'

vi.mock('../../services/marketplace', () => ({
  fetchListings: vi.fn(),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => null),
}))

import { fetchListings } from '../../services/marketplace'
import { getDesktopHubAddress } from '../../services/desktop-session'

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

describe('DesktopMarketplacePage', () => {
  beforeEach(() => {
    vi.mocked(fetchListings).mockReset()
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue(null)
  })

  it('renders fetched listings', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = mount(DesktopMarketplacePage, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('chuck')
    expect(wrapper.text()).toContain('1 NIM') // 100000 luna -> 1 NIM
  })

  it('filters the visible listings by handle prefix without re-fetching', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
      { handle: 'alice', seller: 'NQ22', price_luna: 200000, fee_luna: 10000, status: 'active', ownership_epoch_tx_hash: 't2', created_at: 2 },
    ])
    const wrapper = mount(DesktopMarketplacePage, { global: { stubs } })
    await flushPromises()
    await wrapper.find('input[type="search"]').setValue('ch')
    expect(wrapper.text()).toContain('chuck')
    expect(wrapper.text()).not.toContain('alice')
    expect(fetchListings).toHaveBeenCalledTimes(1)
  })

  it('hides the Buy action for the connected user\'s own listing', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = mount(DesktopMarketplacePage, { global: { stubs } })
    await flushPromises()
    expect(wrapper.find('[data-buy-handle="chuck"]').exists()).toBe(false)
  })

  it('shows a retry affordance when the fetch fails', async () => {
    vi.mocked(fetchListings).mockRejectedValue(new Error('marketplace unavailable'))
    const wrapper = mount(DesktopMarketplacePage, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('marketplace unavailable')
    expect(wrapper.find('[data-retry]').exists()).toBe(true)
  })
})
