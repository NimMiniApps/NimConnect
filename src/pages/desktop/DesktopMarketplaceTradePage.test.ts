import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import DesktopMarketplaceTradePage from './DesktopMarketplaceTradePage.vue'

vi.mock('../../services/hub', () => ({
  hubCheckoutPayment: vi.fn(),
  hubSignReleaseTransaction: vi.fn(),
  hubSignClaimTransaction: vi.fn(),
  hubErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
vi.mock('../../services/desktop-session', () => ({
  getDesktopHubAddress: vi.fn(() => 'NQ22 BUYER'),
}))
vi.mock('../../services/marketplace', () => ({
  getTrade: vi.fn(),
  submitRelease: vi.fn(),
  submitClaim: vi.fn(),
  fetchChainHeight: vi.fn(),
}))

import { hubCheckoutPayment, hubSignReleaseTransaction, hubSignClaimTransaction } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { getTrade, submitRelease, submitClaim, fetchChainHeight } from '../../services/marketplace'

async function mountForTrade(id: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/marketplace/trades/:id', component: DesktopMarketplaceTradePage }],
  })
  router.push(`/marketplace/trades/${id}`)
  await router.isReady()
  return mount(DesktopMarketplaceTradePage, { global: { plugins: [router] } })
}

const baseTrade = {
  id: 'trade-1', reference: 'ref1', handle: 'chuck', buyer: 'NQ22 BUYER', seller: 'NQ11 SELLER',
  price_luna: 100000, fee_luna: 5000, version: 1, created_at: 1, updated_at: 1,
}

describe('DesktopMarketplaceTradePage', () => {
  beforeEach(() => {
    vi.mocked(getTrade).mockReset()
    vi.mocked(submitRelease).mockReset()
    vi.mocked(submitClaim).mockReset()
    vi.mocked(fetchChainHeight).mockReset()
    vi.mocked(hubCheckoutPayment).mockReset()
    vi.mocked(hubSignReleaseTransaction).mockReset()
    vi.mocked(hubSignClaimTransaction).mockReset()
    vi.mocked(getDesktopHubAddress).mockReset().mockReturnValue('NQ22 BUYER')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a not-found state for an unknown trade', async () => {
    vi.mocked(getTrade).mockRejectedValue(new Error('no such trade'))
    const wrapper = await mountForTrade('nope')
    await flushPromises()
    expect(wrapper.text()).toContain('no such trade')
  })

  it('shows the pay panel and calls hubCheckoutPayment with the escrow reference and the buyer as sender', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_DEPOSIT', escrow_address: 'NQ99 ESCROW' })
    vi.mocked(hubCheckoutPayment).mockResolvedValue({ txHash: 'd1' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    await wrapper.find('[data-pay-button]').trigger('click')
    await flushPromises()
    expect(hubCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'NQ99 ESCROW', valueLuna: 100000, data: 'NME1:ref1', sender: 'NQ22 BUYER',
      }),
    )
  })

  it('disables paying when the trade has no escrow_address', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_DEPOSIT' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    expect(wrapper.find('[data-pay-button]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Escrow address unavailable')
  })

  it('ignores a second pay click while the first checkout is still in flight', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_DEPOSIT', escrow_address: 'NQ99 ESCROW' })
    let resolveCheckout: (v: { txHash: string }) => void = () => {}
    vi.mocked(hubCheckoutPayment).mockReturnValue(new Promise((resolve) => { resolveCheckout = resolve }))
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    const button = wrapper.find('[data-pay-button]')
    await button.trigger('click')
    await button.trigger('click')
    resolveCheckout({ txHash: 'd1' })
    await flushPromises()
    expect(hubCheckoutPayment).toHaveBeenCalledTimes(1)
  })

  it('shows a release button for the seller when AWAITING_RELEASE', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_RELEASE' })
    vi.mocked(fetchChainHeight).mockResolvedValue(42)
    vi.mocked(hubSignReleaseTransaction).mockResolvedValue({ rawHex: 'deadbeef', hash: 'r1' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    await wrapper.find('[data-release-button]').trigger('click')
    await flushPromises()
    expect(hubSignReleaseTransaction).toHaveBeenCalledWith('chuck', 'NQ11 SELLER', 42)
    expect(submitRelease).toHaveBeenCalledWith('trade-1', { kind: 'hub', raw_hex: 'deadbeef' })
  })

  it('ignores a second release click while the first is still in flight', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ11 SELLER')
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_RELEASE' })
    vi.mocked(fetchChainHeight).mockResolvedValue(42)
    let resolveSign: (v: { rawHex: string; hash: string }) => void = () => {}
    vi.mocked(hubSignReleaseTransaction).mockReturnValue(new Promise((resolve) => { resolveSign = resolve }))
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    const button = wrapper.find('[data-release-button]')
    await button.trigger('click')
    await button.trigger('click')
    resolveSign({ rawHex: 'deadbeef', hash: 'r1' })
    await flushPromises()
    expect(hubSignReleaseTransaction).toHaveBeenCalledTimes(1)
  })

  it('shows a passive waiting panel for the buyer when AWAITING_RELEASE', async () => {
    vi.mocked(getDesktopHubAddress).mockReturnValue('NQ22 BUYER')
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_RELEASE' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    expect(wrapper.find('[data-release-button]').exists()).toBe(false)
    expect(wrapper.text()).toContain('waiting')
  })

  it('shows a claim button for the buyer when AWAITING_CLAIM', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_CLAIM' })
    vi.mocked(fetchChainHeight).mockResolvedValue(43)
    vi.mocked(hubSignClaimTransaction).mockResolvedValue({ rawHex: 'cafebabe', hash: 'c1' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    await wrapper.find('[data-claim-button]').trigger('click')
    await flushPromises()
    expect(hubSignClaimTransaction).toHaveBeenCalledWith('chuck', 'NQ22 BUYER', 43)
    expect(submitClaim).toHaveBeenCalledWith('trade-1', { kind: 'hub', raw_hex: 'cafebabe' })
  })

  it('ignores a second claim click while the first is still in flight', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'AWAITING_CLAIM' })
    vi.mocked(fetchChainHeight).mockResolvedValue(43)
    let resolveSign: (v: { rawHex: string; hash: string }) => void = () => {}
    vi.mocked(hubSignClaimTransaction).mockReturnValue(new Promise((resolve) => { resolveSign = resolve }))
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    const button = wrapper.find('[data-claim-button]')
    await button.trigger('click')
    await button.trigger('click')
    resolveSign({ rawHex: 'cafebabe', hash: 'c1' })
    await flushPromises()
    expect(hubSignClaimTransaction).toHaveBeenCalledTimes(1)
  })

  it('shows a settled confirmation and stops polling', async () => {
    vi.useFakeTimers()
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'SETTLED' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    expect(wrapper.text()).toMatch(/own @chuck|paid/)
    vi.mocked(getTrade).mockClear()
    await vi.advanceTimersByTimeAsync(10000)
    expect(getTrade).not.toHaveBeenCalled()
  })

  it('shows a refunded failure panel', async () => {
    vi.mocked(getTrade).mockResolvedValue({ ...baseTrade, state: 'REFUNDED' })
    const wrapper = await mountForTrade('trade-1')
    await flushPromises()
    expect(wrapper.text()).toContain('refunded')
  })
})
