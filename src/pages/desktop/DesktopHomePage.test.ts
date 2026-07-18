import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DesktopHomePage from './DesktopHomePage.vue'
import { NIMPAY_OPEN_URL } from '../../config/host-app'

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  Identicon: { template: '<div data-identicon />' },
  QrCode: { template: '<div data-qr />' },
}

describe('DesktopHomePage', () => {
  it('markets identity as complementary to the Mini App', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    expect(wrapper.text()).toContain('NimConnect')
    expect(wrapper.text()).toContain('Claim your Nimiq identity.')
    expect(wrapper.text()).toContain('Claim your identity on desktop. Use it everywhere in Nimiq Pay.')
  })

  it('keeps Claim @handle primary and Continue in Nimiq Pay as a prominent secondary CTA', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    const primary = wrapper.find('a[href="/me"]')
    expect(primary.exists()).toBe(true)
    expect(primary.text()).toBe('Claim your @handle')
    expect(primary.classes()).toContain('nq-button')

    const pay = wrapper.find(`a[href="${NIMPAY_OPEN_URL}"]`)
    expect(pay.exists()).toBe(true)
    expect(pay.text()).toBe('Continue in Nimiq Pay')
    expect(pay.classes()).toContain('nq-button')
    expect(pay.classes()).toContain('light-blue')
  })

  it('offers lookup as a tertiary path for existing handles', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    expect(wrapper.text()).toContain('Already have a handle?')
    const lookup = wrapper.find('a[href="/lookup"]')
    expect(lookup.exists()).toBe(true)
    expect(lookup.classes()).toContain('desktop-home__lookup-cta')
    expect(lookup.text()).toContain('Look up a public profile')
  })

  it('shows a before→claim→identity mockup with a fictional profile', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    expect(wrapper.find('[data-identity-transform]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Wallet address')
    expect(wrapper.text()).toContain('NQ26…9YDF')
    expect(wrapper.text()).toContain('Claim @alex')
    expect(wrapper.text()).toContain('Public identity')
    expect(wrapper.text()).toContain('@alex')
    expect(wrapper.text()).toContain('/@alex')
    expect(wrapper.text()).toContain('Alex Morgan')
    expect(wrapper.text()).toContain('Tell people who you are.')
    expect(wrapper.text()).toContain('Verified on-chain')
    expect(wrapper.text()).not.toContain('Chuck')
    expect(wrapper.find('[data-identicon]').exists()).toBe(true)
    expect(wrapper.find('[data-qr]').exists()).toBe(true)
  })

  it('lists a single scannable benefits row', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    for (const benefit of [
      'Permanent @handle',
      'Public profile',
      'Payment page',
      'Works across Mini Apps',
      'Privacy-first',
    ]) {
      expect(wrapper.text()).toContain(benefit)
    }
    expect(wrapper.text()).not.toContain('Works with')
    expect(wrapper.text()).not.toContain('Developer profile')
  })

  it('explains why NimConnect exists with scannable icon bullets', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })

    expect(wrapper.text()).toContain('Why NimConnect?')
    expect(wrapper.text()).toContain('People remember people—not wallet addresses.')
    expect(wrapper.text()).toContain('One public identity for every Mini App.')
    expect(wrapper.findAll('.desktop-home__why-icon')).toHaveLength(4)
    expect(wrapper.find('.desktop-home__why-icon--people').exists()).toBe(true)
    expect(wrapper.find('.desktop-home__flow').text()).not.toContain('Payment page')
  })

  it('does not bury store install links in the homepage hero', () => {
    const wrapper = mount(DesktopHomePage, { global: { stubs } })
    expect(wrapper.text()).not.toContain("Don't have Nimiq Pay yet?")
  })
})
