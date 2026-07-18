import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopLookupPage from './DesktopLookupPage.vue'

const mocks = vi.hoisted(() => ({
  resolveHandle: vi.fn(),
  handleForAddress: vi.fn(),
  fetchPublicProfile: vi.fn(),
  checkHandle: vi.fn(),
}))

vi.mock('../../services/handles', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/handles')>()
  return {
    ...actual,
    resolveHandle: mocks.resolveHandle,
    handleForAddress: mocks.handleForAddress,
    fetchPublicProfile: mocks.fetchPublicProfile,
    checkHandle: mocks.checkHandle,
  }
})

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  Identicon: { template: '<div data-identicon />' },
  QrCode: { template: '<div data-qr />' },
}

const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

describe('DesktopLookupPage', () => {
  beforeEach(() => {
    mocks.resolveHandle.mockReset()
    mocks.handleForAddress.mockReset()
    mocks.fetchPublicProfile.mockReset()
    mocks.checkHandle.mockReset()
    mocks.fetchPublicProfile.mockResolvedValue(null)
  })

  it('shows stronger identity-focused copy and a premium search form', () => {
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })

    expect(wrapper.text()).toContain('NimConnect')
    expect(wrapper.text()).toContain('Find a public profile.')
    expect(wrapper.text()).toContain('Find any public Nimiq identity by @handle or wallet address.')
    expect(wrapper.text()).toContain('View public profiles, payment pages and verified identities.')
    expect(wrapper.find('[data-desktop-lookup] input').attributes('placeholder')).toBe('@maestro or NQ26…')
    expect(wrapper.text()).toContain('Public profile')
    expect(wrapper.text()).toContain('Verified handle')
    expect(wrapper.text()).toContain('Try searching for')
    expect(wrapper.text()).toContain('@maestro')
    expect(wrapper.text()).toContain('@demo')
  })

  it('shows an inline result card after a successful handle lookup', async () => {
    mocks.resolveHandle.mockResolvedValue({
      handle: 'ada',
      address,
      tx_hash: 't',
      block_height: 1,
      tx_index: 0,
    })
    mocks.fetchPublicProfile.mockResolvedValue({
      updatedAt: 1,
      profile: {
        display_name: 'Ada',
        bio: 'Builder',
        github: 'ada',
        website: 'https://ada.dev',
        tags: ['dev'],
      },
    })
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })

    await wrapper.get('[data-desktop-lookup] input').setValue('@ada')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(mocks.resolveHandle).toHaveBeenCalledWith('ada')
    expect(wrapper.find('[data-desktop-lookup-result]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Found by @handle')
    expect(wrapper.text()).toContain('@ada')
    expect(wrapper.text()).toContain('/@ada')
    expect(wrapper.text()).toContain('Ada')
    expect(wrapper.text()).toContain('Builder')
    expect(wrapper.text()).toContain('ada.dev')
    expect(wrapper.text()).toContain('github.com/ada')
    expect(wrapper.text()).toContain('dev')
    expect(wrapper.find('[data-qr]').exists()).toBe(true)
    expect(wrapper.find('a[href="/u/ada"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('View full profile')
    expect(wrapper.text()).not.toContain('Try searching for')
  })

  it('resolves addresses through by-address then shows a result card', async () => {
    mocks.handleForAddress.mockResolvedValue({
      handle: 'ada',
      address,
      tx_hash: 't',
      block_height: 1,
      tx_index: 0,
    })
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })

    await wrapper.get('[data-desktop-lookup] input').setValue(address)
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(mocks.handleForAddress).toHaveBeenCalled()
    expect(wrapper.find('[data-desktop-lookup-result]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Found by wallet address')
    expect(wrapper.find('a[href="/u/ada"]').exists()).toBe(true)
  })

  it('shows a clearer not-found message when no claim exists', async () => {
    mocks.handleForAddress.mockResolvedValue(null)
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })

    await wrapper.get('[data-desktop-lookup] input').setValue(address)
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain("We couldn't find that public identity.")
    expect(wrapper.text()).toContain('Check the @handle or wallet address and try again.')
    expect(wrapper.find('[data-desktop-lookup-result]').exists()).toBe(false)
  })

  it('offers a claim path when a missing handle is still available', async () => {
    mocks.resolveHandle.mockResolvedValue(null)
    mocks.checkHandle.mockResolvedValue({ available: true })
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })

    await wrapper.get('[data-desktop-lookup] input').setValue('ghost')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain("We couldn't find that public identity.")
    expect(wrapper.find('a[href="/me"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Claim @ghost')
  })

  it('fills the search box from example chips', async () => {
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })
    const examples = wrapper.findAll('.desktop-lookup__example')
    expect(examples.length).toBeGreaterThan(0)
    await examples[0]!.trigger('click')
    expect((wrapper.get('[data-desktop-lookup] input').element as HTMLInputElement).value).toBe('@maestro')
  })

  it('shows a result skeleton while lookup is pending', async () => {
    let resolveClaim!: (value: unknown) => void
    mocks.resolveHandle.mockReturnValue(new Promise(resolve => {
      resolveClaim = resolve
    }))
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })

    await wrapper.get('[data-desktop-lookup] input').setValue('@ada')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-desktop-lookup-skeleton]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Looking up…')
    expect(wrapper.text()).not.toContain('Try searching for')

    resolveClaim({
      handle: 'ada',
      address,
      tx_hash: 't',
      block_height: 1,
      tx_index: 0,
    })
    await flushPromises()

    expect(wrapper.find('[data-desktop-lookup-skeleton]').exists()).toBe(false)
    expect(wrapper.find('[data-desktop-lookup-result]').exists()).toBe(true)
  })

  it('clears the lookup on Escape', async () => {
    mocks.resolveHandle.mockResolvedValue({
      handle: 'ada',
      address,
      tx_hash: 't',
      block_height: 1,
      tx_index: 0,
    })
    const wrapper = mount(DesktopLookupPage, { attachTo: document.body, global: { stubs } })

    await wrapper.get('[data-desktop-lookup] input').setValue('@ada')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[data-desktop-lookup-result]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect((wrapper.get('[data-desktop-lookup] input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('[data-desktop-lookup-result]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Try searching for')
    wrapper.unmount()
  })

  it('validates garbage input without calling the network', async () => {
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })

    await wrapper.get('[data-desktop-lookup] input').setValue('nope!')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Enter an @handle or Nimiq address')
    expect(mocks.resolveHandle).not.toHaveBeenCalled()
    expect(mocks.handleForAddress).not.toHaveBeenCalled()
  })

  it('shows a failure message when lookup throws', async () => {
    mocks.resolveHandle.mockRejectedValue(new Error('network'))
    const wrapper = mount(DesktopLookupPage, { global: { stubs } })

    await wrapper.get('[data-desktop-lookup] input').setValue('@ada')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Lookup failed — try again')
    expect(wrapper.find('[data-desktop-lookup-result]').exists()).toBe(false)
  })
})
