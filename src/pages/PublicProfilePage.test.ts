import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicProfilePage from './PublicProfilePage.vue'

const mocks = vi.hoisted(() => ({
  resolveHandleEnriched: vi.fn(),
  fetchPublicProfile: vi.fn(),
  checkHandle: vi.fn(),
  route: {
    params: { handle: 'ada' },
    query: {},
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
}))

vi.mock('../services/handles', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/handles')>()
  return {
    ...actual,
    resolveHandleEnriched: mocks.resolveHandleEnriched,
    fetchPublicProfile: mocks.fetchPublicProfile,
    checkHandle: mocks.checkHandle,
  }
})

const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
const stubs = {
  QrCode: { template: '<div data-qr-code />' },
  Identicon: { template: '<div data-identicon />' },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

async function mountPage() {
  const wrapper = mount(PublicProfilePage, { global: { stubs } })
  await flushPromises()
  return wrapper
}

describe('PublicProfilePage', () => {
  beforeEach(() => {
    mocks.route.params.handle = 'ada'
    mocks.route.query = {}
    mocks.resolveHandleEnriched.mockReset()
    mocks.fetchPublicProfile.mockReset()
    mocks.checkHandle.mockReset()
  })

  it('places a resolved public handle in the shared public surface', async () => {
    mocks.resolveHandleEnriched.mockResolvedValue({
      handle: 'ada', address, tx_hash: 'claim-tx', block_height: 1, tx_index: 0,
    })
    mocks.fetchPublicProfile.mockResolvedValue({
      updatedAt: 1,
      profile: { display_name: 'Ada Lovelace', bio: 'Computing pioneer' },
    })

    const wrapper = await mountPage()

    expect(wrapper.find('.public-surface').exists()).toBe(true)
    expect(wrapper.get('[data-public-context]').text()).toBe('Public profile')
    expect(wrapper.text()).toContain('Ada Lovelace')
    expect(wrapper.text()).toContain('@ada')
    expect(wrapper.get('[data-public-panel]').text()).toMatch(/Handle verified on the Nimiq chain/i)
    expect(wrapper.get('[data-public-panel] a').attributes('href')).toContain('claim-tx')
    expect(wrapper.get('[data-public-primary]').text()).toContain('Send in Nimiq Pay')
  })

  it('keeps an unclaimed handle inside the shared surface with its claim path', async () => {
    mocks.resolveHandleEnriched.mockResolvedValue(null)
    mocks.checkHandle.mockResolvedValue({ available: true })

    const wrapper = await mountPage()

    expect(wrapper.find('.public-surface').exists()).toBe(true)
    expect(wrapper.get('[data-public-context]').text()).toBe('Public profile')
    expect(wrapper.text()).toContain('@ada is free')
    expect(wrapper.get('[data-public-panel]').text()).toContain('Claim it in NimConnect')
    expect(wrapper.get('[data-public-panel] a[href="/"]').text()).toContain('Claim it in NimConnect')
  })
})
