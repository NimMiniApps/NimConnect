import { flushPromises, mount } from '@vue/test-utils'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OpenInNimiqPayLanding from './OpenInNimiqPayLanding.vue'
import PublicPayLanding from './PublicPayLanding.vue'
import PublicProfileLanding from './PublicProfileLanding.vue'
import { NIMPAY_APP_STORE_URL, NIMPAY_OPEN_URL, NIMPAY_PLAY_STORE_URL } from '../config/host-app'
import { makeNimiqPayDeepLink, makeWalletRequestLink } from '../services/links'
import { makeNimiqPayProfileLink } from '../services/profile-share'

const mocks = vi.hoisted(() => ({
  resolveHandle: vi.fn(),
  handleForAddress: vi.fn(),
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('../services/handles', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/handles')>()
  return {
    ...actual,
    resolveHandle: mocks.resolveHandle,
    handleForAddress: mocks.handleForAddress,
  }
})

const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
const stubs = {
  QrCode: { template: '<div data-qr-code />' },
  Identicon: { template: '<div data-identicon />' },
}

describe('public landings', () => {
  beforeEach(() => {
    mocks.resolveHandle.mockReset()
    mocks.handleForAddress.mockReset()
    mocks.push.mockReset()
  })

  it('places the generic Nimiq Pay handoff in the common public surface', async () => {
    const wrapper = mount(OpenInNimiqPayLanding)

    expect(wrapper.find('.public-surface').exists()).toBe(true)
    expect(wrapper.get('[data-public-context]').text()).toBe('NimConnect')
    expect(wrapper.get('[data-public-primary] a').attributes('href')).toBe(NIMPAY_OPEN_URL)
    expect(wrapper.text()).toContain('People, not wallet addresses.')
    expect(wrapper.text()).toContain('Manage contacts, share public @handles, and receive payments.')
    expect(wrapper.text()).toContain('Public @handles')
    expect(wrapper.text()).toContain('Payment pages')
    expect(wrapper.text()).toContain('Wallet contacts')
    expect(wrapper.get(`[href="${NIMPAY_PLAY_STORE_URL}"]`).text()).toContain('Get it on Google Play')
    expect(wrapper.get(`[href="${NIMPAY_APP_STORE_URL}"]`).text()).toContain('Download on the App Store')

    const continueButton = wrapper.findAll('button').find(button =>
      button.text().includes('Continue in browser'))
    expect(continueButton).toBeTruthy()
    await continueButton!.trigger('click')
    expect(wrapper.emitted('continue')).toHaveLength(1)

    const desktop = mount(OpenInNimiqPayLanding, {
      props: { allowBrowserContinue: false },
    })
    expect(desktop.findAll('button').some(button => button.text().includes('Continue in browser'))).toBe(false)
    expect(desktop.get('[data-public-primary] a').attributes('href')).toBe(NIMPAY_OPEN_URL)
    expect(desktop.get('[data-public-primary] a').classes()).toContain('nq-button')
    expect(desktop.get('[data-public-lookup] button').classes()).toContain('light-blue')
    expect(desktop.find('[data-public-lookup]').exists()).toBe(true)
  })

  it('shows public profile lookup only on the desktop handoff', async () => {
    const wrapper = mount(OpenInNimiqPayLanding)
    expect(wrapper.find('[data-public-lookup]').exists()).toBe(false)

    await wrapper.setProps({ allowBrowserContinue: false })
    expect(wrapper.find('[data-public-lookup]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Look up a public profile')
    expect(wrapper.get('[data-public-lookup] input').attributes('placeholder'))
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
    const wrapper = mount(OpenInNimiqPayLanding, {
      props: { allowBrowserContinue: false },
    })
    await wrapper.get('[data-public-lookup] input').setValue('@ada')
    await wrapper.get('[data-public-lookup]').trigger('submit')
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
    const wrapper = mount(OpenInNimiqPayLanding, {
      props: { allowBrowserContinue: false },
    })
    await wrapper.get('[data-public-lookup] input').setValue(address)
    await wrapper.get('[data-public-lookup]').trigger('submit')
    await flushPromises()
    expect(mocks.handleForAddress).toHaveBeenCalledWith(ValidationUtils.normalizeAddress(address))
    expect(mocks.push).toHaveBeenCalledWith('/u/ada')
  })

  it('shows an empty-state message when no public handle exists for an address', async () => {
    mocks.handleForAddress.mockResolvedValue(null)
    const wrapper = mount(OpenInNimiqPayLanding, {
      props: { allowBrowserContinue: false },
    })
    await wrapper.get('[data-public-lookup] input').setValue(address)
    await wrapper.get('[data-public-lookup]').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('No public @handle found')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('shows an empty-state message when no public handle exists', async () => {
    mocks.resolveHandle.mockResolvedValue(null)
    const wrapper = mount(OpenInNimiqPayLanding, {
      props: { allowBrowserContinue: false },
    })
    await wrapper.get('[data-public-lookup] input').setValue('ghost')
    await wrapper.get('[data-public-lookup]').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('No public @handle found')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('validates garbage input without calling the network', async () => {
    const wrapper = mount(OpenInNimiqPayLanding, {
      props: { allowBrowserContinue: false },
    })
    await wrapper.get('[data-public-lookup] input').setValue('nope!')
    await wrapper.get('[data-public-lookup]').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Enter an @handle or Nimiq address')
    expect(mocks.resolveHandle).not.toHaveBeenCalled()
    expect(mocks.handleForAddress).not.toHaveBeenCalled()
  })

  it('shows a failure message when lookup throws', async () => {
    mocks.resolveHandle.mockRejectedValue(new Error('network'))
    const wrapper = mount(OpenInNimiqPayLanding, {
      props: { allowBrowserContinue: false },
    })
    await wrapper.get('[data-public-lookup] input').setValue('@ada')
    await wrapper.get('[data-public-lookup]').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Lookup failed - try again')
    expect(wrapper.text()).not.toMatch(/[—–]/)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('keeps handoff copy free of em/en dashes', () => {
    const wrapper = mount(OpenInNimiqPayLanding, {
      props: { allowBrowserContinue: false },
    })
    expect(wrapper.text()).toContain('People, not wallet addresses.')
    expect(wrapper.text()).toContain('Save people, not long wallet addresses.')
    expect(wrapper.text()).not.toMatch(/[—–]/)
  })

  it('uses a supplied Nimiq Pay deep link for a browser handoff', () => {
    const wrapper = mount(OpenInNimiqPayLanding, {
      props: { openUrl: 'https://nimpay.app/miniapps/open/nimconnect.nimiqminiapps.com#/add?address=NQ26' },
    })

    expect(wrapper.get('[data-public-primary] a').attributes('href')).toContain('#/add?address=NQ26')
  })

  it('places a shared profile in the common public surface without chain verification', async () => {
    const wrapper = mount(PublicProfileLanding, {
      props: {
        profile: {
          v: 1,
          address,
          name: 'Ada Lovelace',
          type: 'person',
          bio: 'Computing pioneer',
          tags: ['Friends'],
        },
      },
      global: { stubs },
    })

    expect(wrapper.find('.public-surface').exists()).toBe(true)
    expect(wrapper.find('.public-landing__identity, .public-landing__panel, .public-landing__footer').exists()).toBe(false)
    expect(wrapper.get('[data-public-context]').text()).toBe('Shared profile')
    expect(wrapper.text()).toContain('Ada Lovelace')
    expect(wrapper.text()).toContain('Add to NimConnect')
    expect(wrapper.text()).not.toMatch(/chain verification|on-chain verified/i)
    expect(wrapper.get('[data-public-tertiary]').text()).toContain('Google Play')
    expect(wrapper.get('[data-public-secondary]').text()).not.toContain('Google Play')
    expect(wrapper.get('[data-public-primary] a').attributes('href')).toBe(makeNimiqPayDeepLink(address))
    expect(wrapper.get('[data-public-secondary] a').attributes('href')).toBe(makeWalletRequestLink(address))
    expect(wrapper.get('[data-public-secondary] a').attributes('target')).toBe('_blank')
    expect(wrapper.get('[data-public-secondary] a').attributes('rel')).toBe('noopener noreferrer')
    expect(wrapper.get('[data-public-secondary] a.public-action--outline').attributes('href')).toBe(makeNimiqPayProfileLink({
      v: 1, address, name: 'Ada Lovelace', type: 'person', bio: 'Computing pioneer', tags: ['Friends'],
    }))
    expect(wrapper.get(`[data-public-tertiary] a[href="${NIMPAY_PLAY_STORE_URL}"]`).attributes('target')).toBe('_blank')
    const continueButton = wrapper.get('.public-surface__footer button')
    await continueButton!.trigger('click')
    expect(wrapper.emitted('continue')).toHaveLength(1)
  })

  it('places a payment request in the common public surface with its payment actions', () => {
    const wrapper = mount(PublicPayLanding, {
      props: {
        payment: {
          recipient: address,
          amountNim: 12.5,
          message: 'Dinner split',
          label: 'Ada Lovelace',
        },
      },
      global: { stubs },
    })

    expect(wrapper.find('.public-surface').exists()).toBe(true)
    expect(wrapper.find('.public-landing__identity, .public-landing__panel, .public-landing__footer').exists()).toBe(false)
    expect(wrapper.get('[data-public-context]').text()).toBe('Payment request')
    expect(wrapper.text()).toContain('12.5 NIM')
    expect(wrapper.text()).toContain('Dinner split')
    expect(wrapper.text()).toContain('Pay with Nimiq Pay')
    expect(wrapper.text()).toContain('Pay with Nimiq Wallet')
    expect(wrapper.get('[data-public-tertiary]').text()).toContain('App Store')
    expect(wrapper.get('[data-public-secondary]').text()).not.toContain('App Store')
    expect(wrapper.get('[data-public-primary] a').attributes('href')).toBe(makeNimiqPayDeepLink(address, 12.5, 'Dinner split'))
    expect(wrapper.get('[data-public-secondary] a').attributes('href')).toBe(makeWalletRequestLink(address, 12.5, 'Dinner split'))
    expect(wrapper.get('[data-public-secondary] a').attributes('target')).toBe('_blank')
    expect(wrapper.get(`[data-public-tertiary] a[href="${NIMPAY_APP_STORE_URL}"]`).attributes('rel')).toBe('noopener noreferrer')
  })

  it('hides the browser handoff when it is explicitly disabled', () => {
    const wrapper = mount(PublicPayLanding, {
      props: {
        payment: { recipient: address },
        allowBrowserContinue: false,
      },
      global: { stubs },
    })

    expect(wrapper.findAll('button').some(button => button.text() === 'Open NimConnect in the browser')).toBe(false)
  })
})
