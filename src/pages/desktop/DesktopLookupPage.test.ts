import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopLookupPage from './DesktopLookupPage.vue'

const mocks = vi.hoisted(() => ({
  resolveHandle: vi.fn(),
  handleForAddress: vi.fn(),
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('../../services/handles', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/handles')>()
  return {
    ...actual,
    resolveHandle: mocks.resolveHandle,
    handleForAddress: mocks.handleForAddress,
  }
})

const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

describe('DesktopLookupPage', () => {
  beforeEach(() => {
    mocks.resolveHandle.mockReset()
    mocks.handleForAddress.mockReset()
    mocks.push.mockReset()
  })

  it('shows a headline and the lookup form', () => {
    const wrapper = mount(DesktopLookupPage)

    expect(wrapper.text()).toContain('NimConnect')
    expect(wrapper.text()).toContain('Find a public profile.')
    expect(wrapper.find('[data-desktop-lookup] input').attributes('placeholder'))
      .toBe('@handle or Nimiq address')
  })

  it('navigates to /u/:handle after a successful handle lookup', async () => {
    mocks.resolveHandle.mockResolvedValue({
      handle: 'ada',
      address,
      tx_hash: 't',
      block_height: 1,
      tx_index: 0,
    })
    const wrapper = mount(DesktopLookupPage)

    await wrapper.get('[data-desktop-lookup] input').setValue('@ada')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(mocks.resolveHandle).toHaveBeenCalledWith('ada')
    expect(mocks.push).toHaveBeenCalledWith('/u/ada')
  })

  it('resolves addresses through by-address then navigates', async () => {
    mocks.handleForAddress.mockResolvedValue({
      handle: 'ada',
      address,
      tx_hash: 't',
      block_height: 1,
      tx_index: 0,
    })
    const wrapper = mount(DesktopLookupPage)

    await wrapper.get('[data-desktop-lookup] input').setValue(address)
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(mocks.handleForAddress).toHaveBeenCalled()
    expect(mocks.push).toHaveBeenCalledWith('/u/ada')
  })

  it('shows a not-found message when no claim exists for the address', async () => {
    mocks.handleForAddress.mockResolvedValue(null)
    const wrapper = mount(DesktopLookupPage)

    await wrapper.get('[data-desktop-lookup] input').setValue(address)
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('No public @handle found')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('shows a not-found message when no claim exists for the handle', async () => {
    mocks.resolveHandle.mockResolvedValue(null)
    const wrapper = mount(DesktopLookupPage)

    await wrapper.get('[data-desktop-lookup] input').setValue('ghost')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('No public @handle found')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('validates garbage input without calling the network', async () => {
    const wrapper = mount(DesktopLookupPage)

    await wrapper.get('[data-desktop-lookup] input').setValue('nope!')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Enter an @handle or Nimiq address')
    expect(mocks.resolveHandle).not.toHaveBeenCalled()
    expect(mocks.handleForAddress).not.toHaveBeenCalled()
  })

  it('shows a failure message when lookup throws', async () => {
    mocks.resolveHandle.mockRejectedValue(new Error('network'))
    const wrapper = mount(DesktopLookupPage)

    await wrapper.get('[data-desktop-lookup] input').setValue('@ada')
    await wrapper.get('[data-desktop-lookup]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Lookup failed — try again')
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
