import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PublicAddressCopy from './PublicAddressCopy.vue'

const address = 'NQ12 TEST 1234 TEST 5678 TEST 9012 TEST 3456'
const clipboard = { writeText: vi.fn() }

describe('PublicAddressCopy', () => {
  afterEach(() => {
    clipboard.writeText.mockReset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders the full selectable address', () => {
    const wrapper = mount(PublicAddressCopy, {
      props: { address },
    })

    expect(wrapper.get('[data-public-address]').text()).toBe(address)
    expect(wrapper.get('[data-public-address]').attributes('data-selectable')).toBe('true')
  })

  it('copies the exact address and shows local confirmation', async () => {
    vi.useFakeTimers()
    clipboard.writeText.mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard })
    const wrapper = mount(PublicAddressCopy, {
      props: { address },
    })

    await wrapper.get('button').trigger('click')

    expect(clipboard.writeText).toHaveBeenCalledWith(address)
    expect(wrapper.get('button').text()).toBe('Copied ✓')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(wrapper.get('button').text()).toBe('Copy address')
  })

  it('keeps the selectable address available when copying fails', async () => {
    clipboard.writeText.mockRejectedValue(new Error('Clipboard unavailable'))
    vi.stubGlobal('navigator', { clipboard })
    const wrapper = mount(PublicAddressCopy, {
      props: { address },
    })

    await wrapper.get('button').trigger('click')

    expect(wrapper.get('[data-public-address]').text()).toBe(address)
    expect(wrapper.get('button').text()).toBe('Copy address')
  })

  it('does not schedule copy feedback when the clipboard resolves after unmount', async () => {
    vi.useFakeTimers()
    let resolveWrite!: () => void
    const writeText = vi.fn(() => new Promise<void>((resolve) => {
      resolveWrite = resolve
    }))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const wrapper = mount(PublicAddressCopy, {
      props: { address },
    })

    await wrapper.get('button').trigger('click')
    wrapper.unmount()
    resolveWrite()
    await Promise.resolve()

    expect(vi.getTimerCount()).toBe(0)
  })
})
