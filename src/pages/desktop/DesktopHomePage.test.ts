import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DesktopHomePage from './DesktopHomePage.vue'
import { NIMPAY_OPEN_URL } from '../../config/host-app'

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

describe('DesktopHomePage', () => {
  it('markets identity with a brand-first hero and headline', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    expect(wrapper.text()).toContain('NimConnect')
    expect(wrapper.text()).toContain('Claim your Nimiq identity.')
    expect(wrapper.text()).toContain(
      'Create a permanent @handle, public profile and payment page that works across the Nimiq ecosystem.',
    )
  })

  it('sends the primary CTA to /me to authorize identity via the Hub', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    const primary = wrapper.find('a[href="/me"]')
    expect(primary.exists()).toBe(true)
    expect(primary.text()).toBe('Authorize identity')
  })

  it('links the secondary CTA to Nimiq Pay', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    const secondary = wrapper.find(`a[href="${NIMPAY_OPEN_URL}"]`)
    expect(secondary.exists()).toBe(true)
    expect(secondary.text()).toBe('Open in Nimiq Pay')
  })

  it('lists the identity benefits', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    for (const benefit of [
      'Permanent @handle',
      'Public payment page',
      'Developer profile',
      'Works across Mini Apps',
      'Privacy-first',
    ]) {
      expect(wrapper.text()).toContain(benefit)
    }
  })
})
