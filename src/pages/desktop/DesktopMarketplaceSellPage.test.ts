import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DesktopMarketplaceSellPage from './DesktopMarketplaceSellPage.vue'

vi.mock('../../services/hub', () => ({
  hubSignMessage: vi.fn(),
  hubErrorMessage: (e: unknown) => `HUB:${e instanceof Error ? e.message : String(e)}`,
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => null),
}))
vi.mock('../../services/handles', () => ({
  findMyHandle: vi.fn(),
}))
vi.mock('../../services/marketplace', () => ({
  createListing: vi.fn(),
  marketplaceListingMessage: vi.fn(() => 'the-message'),
  generateNonce: vi.fn(() => 'the-nonce'),
}))

import { hubSignMessage } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { findMyHandle } from '../../services/handles'
import { createListing } from '../../services/marketplace'

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

describe('DesktopMarketplaceSellPage', () => {
  beforeEach(() => {
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue(null)
    vi.mocked(findMyHandle).mockReset()
    vi.mocked(hubSignMessage).mockReset()
    vi.mocked(createListing).mockReset()
  })

  it('shows a connect prompt when no Hub wallet is connected', async () => {
    const wrapper = mount(DesktopMarketplaceSellPage, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('Connect')
  })

  it('shows a claim prompt when connected but no handle is owned', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue(null)
    const wrapper = mount(DesktopMarketplaceSellPage, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('claim')
  })

  it('computes and displays the fixed fee for an entered price', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue({ handle: 'chuck', address: 'NQ11 SELLER', tx_hash: 't1', block_height: 5, tx_index: 0 })
    const wrapper = mount(DesktopMarketplaceSellPage, { global: { stubs } })
    await flushPromises()
    await wrapper.find('input[type="number"]').setValue('10')
    expect(wrapper.text()).toContain('0.5 NIM') // 5% of 10 NIM
  })

  it('signs and submits the exact listing message', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue({ handle: 'chuck', address: 'NQ11 SELLER', tx_hash: 't1', block_height: 5, tx_index: 0 })
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(createListing).mockResolvedValue({
      handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 1000000, fee_luna: 50000,
      status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1,
    })
    const wrapper = mount(DesktopMarketplaceSellPage, { global: { stubs } })
    await flushPromises()
    await wrapper.find('input[type="number"]').setValue('10')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(hubSignMessage).toHaveBeenCalledWith('the-message', 'NQ11 SELLER')
    expect(createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 1000000, fee_luna: 50000,
        ownership_epoch_tx_hash: 't1', nonce: 'the-nonce', public_key: 'pub', signature: 'sig',
      }),
    )
    expect(wrapper.text()).toContain('/marketplace/buy?handle=chuck')
  })

  it('maps a Hub rejection to a quiet message', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue({ handle: 'chuck', address: 'NQ11 SELLER', tx_hash: 't1', block_height: 5, tx_index: 0 })
    vi.mocked(hubSignMessage).mockRejectedValue(new Error('canceled'))
    const wrapper = mount(DesktopMarketplaceSellPage, { global: { stubs } })
    await flushPromises()
    await wrapper.find('input[type="number"]').setValue('10')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('HUB:canceled')
    expect(createListing).not.toHaveBeenCalled()
  })

  it('shows the backend error verbatim instead of routing it through hubErrorMessage', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(findMyHandle).mockResolvedValue({ handle: 'chuck', address: 'NQ11 SELLER', tx_hash: 't1', block_height: 5, tx_index: 0 })
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(createListing).mockRejectedValue(new Error('fee exceeds the maximum allowed'))
    const wrapper = mount(DesktopMarketplaceSellPage, { global: { stubs } })
    await flushPromises()
    await wrapper.find('input[type="number"]').setValue('10')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('fee exceeds the maximum allowed')
    expect(wrapper.text()).not.toContain('HUB:')
  })
})
