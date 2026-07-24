import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHashHistory } from 'vue-router'
import OnboardingWizard from './OnboardingWizard.vue'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { clearIdentitySetupState } from '../services/identity-setup'
import { clearOnboardingDone, clearBackupOnboardingDone } from '../services/onboarding'
import {
  backupPassphraseSet,
  cloudBackupEnabled,
  lastLocalBackupAt,
  markPassphraseSet,
} from '../services/backup-prefs'
import { handlesEnabled } from '../services/handles'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

async function mountWizard(props = { open: true }) {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/add', component: { template: '<div />' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return mount(OnboardingWizard, {
    props,
    global: { plugins: [router] },
    attachTo: document.body,
  })
}

describe('OnboardingWizard', () => {
  beforeEach(async () => {
    stubLocalStorage()
    clearIdentitySetupState()
    clearOnboardingDone()
    clearBackupOnboardingDone()
    // Module-level refs survive localStorage stubs — reset them each test.
    backupPassphraseSet.value = false
    cloudBackupEnabled.value = false
    lastLocalBackupAt.value = 0
    setActivePinia(createPinia())
    await db.profiles.clear()
    const store = useProfilesStore()
    await store.load()
  })

  it('shows the step counter starting at step 1', async () => {
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toMatch(/STEP 1 OF \d/)
    wrapper.unmount()
  })

  it('closes immediately when everything is already done', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    const profilePatch = handlesEnabled()
      ? { name: 'Alice', handle: 'alice' }
      : { name: 'Alice' }
    await store.update(store.self!.id, profilePatch)
    markPassphraseSet() // NOT localStorage alone — ref must update
    localStorage.setItem('nimconnect:identity-setup-shared', '1')
    await store.add({ address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', name: 'Bob' })
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('exits only from the wizard-level close control, not from inside a step', async () => {
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    await wrapper.get('.wizard-exit').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('skipping share-profile dismisses it permanently rather than just deferring', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    const profilePatch = handlesEnabled() ? { name: 'Alice', handle: 'alice' } : { name: 'Alice' }
    await store.update(store.self!.id, profilePatch)
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Share your public profile')
    await wrapper.get('.skip').trigger('click')
    expect(localStorage.getItem('nimconnect:identity-setup-share-dismissed')).toBe('1')
    expect(wrapper.text()).toContain('Add your first contact')
    wrapper.unmount()
  })

  it('backup is the last step, and skipping it dismisses it permanently and closes the wizard', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    const profilePatch = handlesEnabled() ? { name: 'Alice', handle: 'alice' } : { name: 'Alice' }
    await store.update(store.self!.id, profilePatch)
    localStorage.setItem('nimconnect:identity-setup-shared', '1')
    await store.add({ address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', name: 'Bob' })
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Back up your contacts')
    const skipButtons = wrapper.findAll('.item').filter(b => b.text() === 'Skip for now')
    await skipButtons[0]!.trigger('click')
    expect(localStorage.getItem('nimconnect:identity-setup-backup-dismissed')).toBe('1')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
