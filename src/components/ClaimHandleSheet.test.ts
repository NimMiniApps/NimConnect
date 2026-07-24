// src/components/ClaimHandleSheet.test.ts
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import ClaimHandleSheet from './ClaimHandleSheet.vue'
import { db } from '../db/db'

describe('ClaimHandleSheet embedded mode', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  it('shows a Skip for now control and emits defer without emitting close', async () => {
    const wrapper = mount(ClaimHandleSheet, {
      props: { open: true, embedded: true },
      attachTo: document.body,
    })
    const skip = wrapper.get('.skip')
    await skip.trigger('click')
    expect(wrapper.emitted('defer')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not show a Skip for now control in standalone mode', () => {
    const wrapper = mount(ClaimHandleSheet, {
      props: { open: true },
      attachTo: document.body,
    })
    expect(wrapper.find('.skip').exists()).toBe(false)
    wrapper.unmount()
  })
})
