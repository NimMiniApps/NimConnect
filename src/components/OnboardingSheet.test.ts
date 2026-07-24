import { DOMWrapper, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import OnboardingSheet from './OnboardingSheet.vue'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { onboardingDone, clearOnboardingDone } from '../services/onboarding'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

describe('OnboardingSheet embedded mode', () => {
  beforeEach(async () => {
    stubLocalStorage()
    clearOnboardingDone()
    setActivePinia(createPinia())
    await db.profiles.clear()
    const store = useProfilesStore()
    await store.load()
  })

  it('emits defer without marking onboarding done when skipped', async () => {
    const wrapper = mount(OnboardingSheet, {
      props: { open: true, embedded: true },
      attachTo: document.body,
    })
    await wrapper.get('.skip').trigger('click')
    expect(wrapper.emitted('defer')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(onboardingDone()).toBe(false)
    wrapper.unmount()
  })

  it('standalone skip still marks onboarding done and emits close', async () => {
    const wrapper = mount(OnboardingSheet, {
      props: { open: true },
      attachTo: document.body,
    })
    // Standalone ActionSheet teleports; query the live DOM.
    const skip = document.body.querySelector('.skip')
    expect(skip).not.toBeNull()
    await new DOMWrapper(skip!).trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('defer')).toBeUndefined()
    expect(onboardingDone()).toBe(true)
    wrapper.unmount()
  })
})
