import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DesktopMarketplaceTradesPage from './DesktopMarketplaceTradesPage.vue'

vi.mock('../../services/hub', () => ({
  chooseHubAddress: vi.fn(),
  hubSignMessage: vi.fn(),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => null),
  setDesktopHubAddress: vi.fn(),
}))
vi.mock('../../services/marketplace', () => ({
  fetchTradesForWallet: vi.fn(),
  marketplaceTradesLookupMessage: vi.fn(() => 'the-message'),
  generateNonce: vi.fn(() => 'the-nonce'),
}))

import { chooseHubAddress, hubSignMessage } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { fetchTradesForWallet } from '../../services/marketplace'

describe('DesktopMarketplaceTradesPage', () => {
  beforeEach(() => {
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue(null)
    vi.mocked(chooseHubAddress).mockReset()
    vi.mocked(hubSignMessage).mockReset()
    vi.mocked(fetchTradesForWallet).mockReset()
  })

  it('shows a connect-and-load prompt when no Hub wallet is connected, and does not fetch until clicked', async () => {
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Connect')
    expect(fetchTradesForWallet).not.toHaveBeenCalled()
  })

  it('signs a fresh lookup message and fetches trades on load, even with a previously stored address', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(fetchTradesForWallet).mockResolvedValue([
      { id: 't1', handle: 'chuck', seller: 'NQ11 SELLER', buyer: 'NQ22 BUYER', state: 'AWAITING_RELEASE' },
      { id: 't2', handle: 'alice', seller: 'NQ33 OTHER', buyer: 'NQ11 SELLER', state: 'SETTLED' },
    ])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    await wrapper.find('[data-load-trades]').trigger('click')
    await flushPromises()

    expect(hubSignMessage).toHaveBeenCalledWith('the-message', 'NQ11 SELLER')
    expect(fetchTradesForWallet).toHaveBeenCalledWith('NQ11 SELLER', 'the-nonce', expect.any(Number), 'pub', 'sig')
    expect(wrapper.text()).toContain('chuck')
    expect(wrapper.text()).toContain('Selling')
    expect(wrapper.text()).toContain('alice')
    expect(wrapper.text()).toContain('Buying')
  })

  it('shows an empty state with a link back to browse when there are no trades', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(fetchTradesForWallet).mockResolvedValue([])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    await wrapper.find('[data-load-trades]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('No trades yet')
    expect(wrapper.find('a[href="#/marketplace"]').exists()).toBe(true)
  })

  it('links each trade to its status page', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(fetchTradesForWallet).mockResolvedValue([
      { id: 't1', handle: 'chuck', seller: 'NQ11 SELLER', buyer: 'NQ22 BUYER', state: 'AWAITING_RELEASE' },
    ])
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    await wrapper.find('[data-load-trades]').trigger('click')
    await flushPromises()
    expect(wrapper.find('a[href="#/marketplace/trades/t1"]').exists()).toBe(true)
  })

  it('maps a Hub rejection during signing to a quiet message', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(hubSignMessage).mockRejectedValue(new Error('canceled'))
    const wrapper = mount(DesktopMarketplaceTradesPage)
    await flushPromises()
    await wrapper.find('[data-load-trades]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('canceled')
    expect(fetchTradesForWallet).not.toHaveBeenCalled()
  })
})
