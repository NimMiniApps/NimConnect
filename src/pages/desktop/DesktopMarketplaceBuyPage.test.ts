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

import { chooseHubAddress, hubSignMessage } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { fetchListings, reserveTrade } from '../../services/marketplace'

async function mountWithQuery(handle: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/marketplace', component: { template: '<div />' } },
      { path: '/me', component: { template: '<div />' } },
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
    vi.mocked(chooseHubAddress).mockReset()
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue('NQ22 BUYER')
  })

  it('shows the listing price for the handle in the query string', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    expect(wrapper.text()).toContain('1 NIM')
  })

  it('explains the escrow handoff and seller payout before reservation', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()

    expect(wrapper.get('[data-buy-card]').text()).toContain('@chuck')
    expect(wrapper.get('[data-buy-card]').text()).toContain('NQ22 BUYER')
    expect(wrapper.get('[data-buy-card]').text()).toContain('Fund escrow')
    expect(wrapper.get('[data-buy-card]').text()).toContain('Seller releases')
    expect(wrapper.get('[data-buy-card]').text()).toContain('You claim')
    expect(wrapper.get('[data-seller-payout]').text()).toContain('0.95 NIM')
    expect(wrapper.get('[data-confirm-buy]').text()).toBe('Reserve @chuck')
    expect(wrapper.get('[data-back-marketplace]').attributes('href')).toBe('/marketplace')
  })

  it('renders deliberate loading and unavailable states', async () => {
    let resolveListings: (value: never[]) => void = () => {}
    vi.mocked(fetchListings).mockReturnValue(new Promise((resolve) => { resolveListings = resolve }))
    const wrapper = await mountWithQuery('gone')

    expect(wrapper.find('[data-buy-loading]').exists()).toBe(true)
    resolveListings([])
    await flushPromises()

    expect(wrapper.find('[data-buy-unavailable]').exists()).toBe(true)
    expect(wrapper.text()).toContain('This listing is no longer available')
    expect(wrapper.get('[data-back-marketplace]').attributes('href')).toBe('/marketplace')
  })

  it('offers wallet connection without hiding the purchase context', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue(null)
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()

    expect(wrapper.text()).toContain('@chuck')
    expect(wrapper.get('[data-connect-wallet]').text()).toBe('Connect wallet to continue')
  })

  it('surfaces a listing load failure inside the confirmation shell', async () => {
    vi.mocked(fetchListings).mockRejectedValue(new Error('marketplace unavailable'))
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()

    expect(wrapper.get('[data-buy-load-error][role="alert"]').text()).toContain('marketplace unavailable')
    expect(wrapper.get('[data-back-marketplace]').attributes('href')).toBe('/marketplace')
  })

  it('reserves without another wallet signature and routes to its status page', async () => {
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
      expect.objectContaining({ handle: 'chuck', buyer: 'NQ22 BUYER', nonce: 'the-nonce' }),
    )
    expect(hubSignMessage).not.toHaveBeenCalled()
    expect(wrapper.vm.$router.currentRoute.value.path).toBe('/marketplace/trades/trade-1')
  })

  it('ignores a second confirm click while the first purchase is still in flight', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    let resolveReserve: (v: { trade_id: string; escrow_address: string; reference: string; price_luna: number; fee_luna: number }) => void = () => {}
    vi.mocked(reserveTrade).mockReturnValue(new Promise((resolve) => { resolveReserve = resolve }))
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    const button = wrapper.find('[data-confirm-buy]')
    await button.trigger('click')
    await button.trigger('click')
    resolveReserve({ trade_id: 't1', escrow_address: 'NQ99', reference: 'r', price_luna: 1, fee_luna: 0 })
    await flushPromises()
    expect(reserveTrade).toHaveBeenCalledTimes(1)
  })

  it('does not ask the Hub to sign an individual reservation', async () => {
    vi.mocked(fetchListings).mockResolvedValue([
      { handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 100000, fee_luna: 5000, status: 'active', ownership_epoch_tx_hash: 't1', created_at: 1 },
    ])
    vi.mocked(reserveTrade).mockResolvedValue({ trade_id: 'trade-1', escrow_address: 'NQ99', reference: 'r', price_luna: 1, fee_luna: 0 })
    const wrapper = await mountWithQuery('chuck')
    await flushPromises()
    await wrapper.find('[data-confirm-buy]').trigger('click')
    await flushPromises()
    expect(hubSignMessage).not.toHaveBeenCalled()
    expect(reserveTrade).toHaveBeenCalledOnce()
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
