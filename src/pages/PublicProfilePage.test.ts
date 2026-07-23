import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicProfilePage from './PublicProfilePage.vue'
import publicProfilePageSource from './PublicProfilePage.vue?raw'
import { makeNimiqPayAddLink, makeWalletRequestLink } from '../services/links'

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
      profile: {
        display_name: 'Ada Lovelace', bio: 'Computing pioneer',
        website: 'https://ada.example', github: 'ada', x: 'ada_x', tags: ['Builder'],
      },
    })

    const wrapper = await mountPage()

    expect(wrapper.find('.public-surface').exists()).toBe(true)
    expect(wrapper.get('[data-public-context]').text()).toBe('Public profile')
    expect(wrapper.text()).toContain('Ada Lovelace')
    expect(wrapper.text()).toContain('@ada')
    expect(wrapper.get('[data-public-panel]').text()).toMatch(/Handle verified on the Nimiq chain/i)
    expect(wrapper.get('[data-public-panel] a').attributes('href')).toContain('claim-tx')
    expect(wrapper.get('[data-public-primary]').text()).toContain('Send in Nimiq Pay')
    expect(wrapper.get('[data-public-identity]').text()).toContain('Website')
    expect(wrapper.get('[data-public-identity]').text()).toContain('GitHub')
    expect(wrapper.get('[data-public-identity]').text()).toContain('X')
    expect(wrapper.get('[data-public-secondary] a').attributes('href')).toBe(makeWalletRequestLink(address))
    expect(wrapper.get('[data-public-secondary] a.public-action--outline').attributes('href')).toBe(makeNimiqPayAddLink(address))
  })

  it('does not expose Refresh while the initial profile lookup is loading', () => {
    mocks.resolveHandleEnriched.mockReturnValue(new Promise(() => {}))

    const wrapper = mount(PublicProfilePage, { global: { stubs } })

    expect(wrapper.get('[data-public-panel]').text()).toContain('Loading @ada…')
    expect(wrapper.find('[data-public-primary]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Refresh')
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

describe('PublicProfilePage visual sizing and hero polish', () => {
  it('uses the 96px avatar and 200px QR code sizes', () => {
    expect(publicProfilePageSource).toMatch(/<Identicon :address="payAddress" :size="96"/)
    expect(publicProfilePageSource).toMatch(/<QrCode :text="payUri" :size="200"/)
  })

  it('keeps footer copy free of em/en dashes', () => {
    expect(publicProfilePageSource).not.toMatch(/[—–]/)
  })

  it('wraps the avatar in a glow container that never blocks interaction and never animates', () => {
    expect(publicProfilePageSource).toMatch(/class="identity__avatar"/)
    const glowBlock = publicProfilePageSource.match(/\.identity__avatar::before\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(glowBlock).toMatch(/pointer-events:\s*none;/)
    expect(glowBlock).not.toMatch(/transition|animation/)
  })

  it('styles the verified badge as a pill with theme-safe text on a green tint', () => {
    const verifiedBlock = publicProfilePageSource.match(/\.verified\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(verifiedBlock).toMatch(/border-radius:\s*var\(--nimiq-radius-pill\);/)
    expect(verifiedBlock).toMatch(/--nimiq-green/)
    expect(verifiedBlock).toMatch(/color:\s*var\(--text\);/)
  })

  it('uses the shared .nq-button class on its filled actions instead of a bespoke implementation', () => {
    expect(publicProfilePageSource.match(/class="nq-button"/g)?.length).toBe(2)
    expect(publicProfilePageSource).toContain('class="nq-button light-blue"')
  })
})
