import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DesktopAboutPage from './DesktopAboutPage.vue'
import { NIMPAY_OPEN_URL } from '../../config/host-app'

describe('DesktopAboutPage', () => {
  it('states NimConnect is the identity portal for the Nimiq ecosystem', () => {
    const wrapper = mount(DesktopAboutPage)

    expect(wrapper.text()).toContain('NimConnect')
    expect(wrapper.text()).toContain('The identity portal for the Nimiq ecosystem.')
    expect(wrapper.text()).toContain('Permanent @handles.')
    expect(wrapper.text()).toContain('One identity across every Mini App.')
  })

  it('shows skimmable feature cards for identity, payments, and privacy', () => {
    const wrapper = mount(DesktopAboutPage)

    expect(wrapper.text()).toContain('Identity')
    expect(wrapper.text()).toContain('Payments')
    expect(wrapper.text()).toContain('Privacy')
    expect(wrapper.text()).toContain('Permanent @handle')
    expect(wrapper.text()).toContain('Public payment page')
    expect(wrapper.text()).toContain('No private key custody')
  })

  it('lists ecosystem partners as pills and closes with desktop vs Pay roles', () => {
    const wrapper = mount(DesktopAboutPage)

    expect(wrapper.text()).toContain('Works with')
    expect(wrapper.text()).toContain('Nimiq Pay')
    expect(wrapper.text()).toContain('Mini Apps')
    expect(wrapper.text()).toContain('Built for the Nimiq Mini Apps ecosystem.')
    expect(wrapper.text()).toContain('Desktop is your identity manager.')
    expect(wrapper.text()).toContain('Your everyday payments stay inside Nimiq Pay.')
  })

  it('adds a concise developer landing section with real integration links', () => {
    const wrapper = mount(DesktopAboutPage)
    const section = wrapper.get('[data-desktop-about-developers]')

    expect(section.text()).toContain('For Mini App Developers')
    expect(section.text()).toContain('simple public identity layer')
    expect(section.text()).toContain('Resolve @handles')
    expect(section.text()).toContain('Public profiles')
    expect(section.text()).toContain('Payment pages')
    expect(section.text()).toContain('Simple integration')
    expect(section.text()).toContain('reusable identity layer')

    expect(section.find('a[href="https://github.com/NimMiniApps/NimConnect/tree/main/docs/api"]').text())
      .toBe('API Documentation')
    expect(section.find('a[href="https://www.npmjs.com/package/@nimconnect/profile-client"]').text())
      .toBe('Integration Guide')
    expect(section.find('a[href="https://github.com/NimMiniApps/NimConnect"]').text())
      .toBe('GitHub Repository')
  })

  it('links to open Nimiq Pay', () => {
    const wrapper = mount(DesktopAboutPage)

    const link = wrapper.find(`a[href="${NIMPAY_OPEN_URL}"]`)
    expect(link.exists()).toBe(true)
    expect(link.text()).toBe('Open in Nimiq Pay')
    expect(link.classes()).toContain('nq-button')
  })
})

