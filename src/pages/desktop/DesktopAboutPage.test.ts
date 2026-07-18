import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DesktopAboutPage from './DesktopAboutPage.vue'
import { NIMPAY_OPEN_URL } from '../../config/host-app'

describe('DesktopAboutPage', () => {
  it('states NimConnect is the identity portal for the Nimiq ecosystem', () => {
    const wrapper = mount(DesktopAboutPage)

    expect(wrapper.text()).toContain('NimConnect')
    expect(wrapper.text()).toContain('The identity portal for the Nimiq ecosystem.')
  })

  it('explains desktop is for identity and payments stay in Nimiq Pay', () => {
    const wrapper = mount(DesktopAboutPage)

    expect(wrapper.text()).toMatch(/set up and manage that identity/i)
    expect(wrapper.text()).toContain('Nimiq Pay')
    expect(wrapper.text()).toMatch(/Everyday payments.*stay in/i)
  })

  it('links to open Nimiq Pay', () => {
    const wrapper = mount(DesktopAboutPage)

    const link = wrapper.find(`a[href="${NIMPAY_OPEN_URL}"]`)
    expect(link.exists()).toBe(true)
    expect(link.text()).toBe('Open in Nimiq Pay')
    expect(link.classes()).toContain('nq-button')
  })
})
