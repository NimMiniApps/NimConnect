import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import DesktopMarketplaceBuyPage from './DesktopMarketplaceBuyPage.vue'

vi.mock('../../services/hub', () => ({
  chooseHubAddress: vi.fn(),
  hubSignMessage: vi.fn(),
  hubErrorMessage: (e: unknown) => `HUB:${e instanceof Error ? e.message : String(e)}`,
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => 'NQ22 BUYER'),
  setDesktopHubAddress: vi.fn(),
}))
vi.mock('../../services/marketplace', () => ({
  fetchListings: vi.fn(),
  reserveTrade: vi.fn(),
  marketplacePurchaseMessage: vi.fn(() => 'the-message'),
  generateNonce: vi.fn(() => 'the-nonce'),
}))

import { hubSignMessage } from '../../services/hub'
import { fetchListings, reserveTrade } from '../../services/marketplace'

async function mountWithQuery(handle: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/marketplace/buy', component: DesktopMarketplaceBuyPage },
      { path: '/marketplace/trades/:id', component: { template: '<div />' } },
    ],
  })
  router.push({ path: '/marketplace/buy', query: { handle } })
  await router.isReady()
  return mount(DesktopMarketplaceBuyPage, { global: { plugins: [router] } })
}

describe('DesktopMarketplaceBuyPage', () => {
  beforeEach(() => {
    vi.mocked(fetchListings).mockReset()
    vi.mocked(reserveTrade).mockReset()
    vi.mocked(hubSignMessage).mockReset()
  })

  it('shows the listing price for the handle in the query string', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    expect(wrapper.text()).toContain('1 NIM')
  })

  it('signs the purchase intent, reserves the trade, and routes to its status page', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(reserveTrade).mockResolvedValue({
      trade_id: 'trade-1', escrow_address: 'NQ99 ESCROW', reference: 'ref1', price_luna: 100000, fee_luna: 5000,
    })
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    await wrapper.find('[data-confirm-buy]').trigger('click')
    await flushPromises()

    expect(reserveTrade).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'chuck', buyer: 'NQ22 BUYER', nonce: 'the-nonce', public_key: 'pub', signature: 'sig' }),
    )
    expect(wrapper.vm.$router.currentRoute.value.path).toBe('/marketplace/trades/trade-1')
  })

  it('ignores a second confirm click while the first purchase is still in flight', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    let resolveSign: (v: { publicKey: string; signature: string }) => void = () => {}
    vi.mocked(hubSignMessage).mockReturnValue(new Promise((resolve) => { resolveSign = resolve }))
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    const button = wrapper.find('[data-confirm-buy]')
    await button.trigger('click')
    await button.trigger('click')
    resolveSign({ publicKey: 'pub', signature: 'sig' })
    await flushPromises()
    expect(hubSignMessage).toHaveBeenCalledTimes(1)
  })

  it('maps a Hub rejection to the quiet Hub message', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    vi.mocked(hubSignMessage).mockRejectedValue(new Error('canceled'))
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    await wrapper.find('[data-confirm-buy]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('HUB:canceled')
    expect(reserveTrade).not.toHaveBeenCalled()
  })

  it('shows the backend error verbatim instead of routing it through hubErrorMessage', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    vi.mocked(hubSignMessage).mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    vi.mocked(reserveTrade).mockRejectedValue(new Error('listing is no longer active'))
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    await wrapper.find('[data-confirm-buy]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('listing is no longer active')
    expect(wrapper.text()).not.toContain('HUB:')
  })
})
