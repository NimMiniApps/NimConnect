import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ActionSheet from './ActionSheet.vue'

describe('ActionSheet', () => {
  it('teleports to body and shows a backdrop by default', () => {
    const wrapper = mount(ActionSheet, {
      props: { open: true, title: 'Test' },
      slots: { default: '<p>Body</p>' },
      attachTo: document.body,
    })
    expect(document.querySelector('.backdrop')).not.toBeNull()
    expect(document.body.textContent).toContain('Body')
    wrapper.unmount()
  })

  it('renders inline with no backdrop or teleport when embedded', () => {
    const wrapper = mount(ActionSheet, {
      props: { open: true, title: 'Test', embedded: true },
      slots: { default: '<p>Body</p>' },
      attachTo: document.body,
    })
    expect(document.querySelector('.backdrop')).toBeNull()
    expect(wrapper.find('h2').text()).toBe('Test')
    expect(wrapper.text()).toContain('Body')
    wrapper.unmount()
  })

  it('renders nothing when embedded and closed', () => {
    const wrapper = mount(ActionSheet, {
      props: { open: false, title: 'Test', embedded: true },
      slots: { default: '<p>Body</p>' },
    })
    expect(wrapper.text()).not.toContain('Body')
  })
})
