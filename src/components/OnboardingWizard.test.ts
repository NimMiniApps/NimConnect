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
import { insideNimiqPay } from '../services/nimiq'

const mocks = vi.hoisted(() => ({
  syncPublicProfile: vi.fn().mockResolvedValue('published'),
  handlesEnabled: vi.fn().mockReturnValue(true),
  cloudBackupExists: vi.fn().mockResolvedValue(false),
  findMyHandle: vi.fn().mockResolvedValue(null),
}))

vi.mock('../services/handles', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/handles')>()
  return {
    ...actual,
    syncPublicProfile: mocks.syncPublicProfile,
    handlesEnabled: mocks.handlesEnabled,
    findMyHandle: mocks.findMyHandle,
  }
})

vi.mock('../services/cloud-backup', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/cloud-backup')>()
  return { ...actual, cloudBackupAvailable: () => true, cloudBackupExists: mocks.cloudBackupExists }
})

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
    insideNimiqPay.value = false
    mocks.syncPublicProfile.mockClear()
    mocks.cloudBackupExists.mockClear()
    mocks.cloudBackupExists.mockResolvedValue(false)
    mocks.findMyHandle.mockClear()
    mocks.findMyHandle.mockResolvedValue(null)
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

  it('skips claim-handle when the registry already has a handle for this wallet, even with no local cache', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    mocks.findMyHandle.mockResolvedValue({
      handle: 'demo', address: store.self!.address, tx_hash: 'abc', block_height: 1, tx_index: 0,
    })
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('Claim your @handle')
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
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Back up your contacts')
    const skipButtons = wrapper.findAll('.item').filter(b => b.text() === 'Skip for now')
    await skipButtons[0]!.trigger('click')
    expect(localStorage.getItem('nimconnect:identity-setup-backup-dismissed')).toBe('1')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('jumps straight to the backup step when a cloud backup already exists for this address', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    insideNimiqPay.value = true
    mocks.cloudBackupExists.mockResolvedValue(true)
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(mocks.cloudBackupExists).toHaveBeenCalledWith('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    expect(wrapper.text()).toContain('Back up your contacts')
    wrapper.unmount()
  })

  it('does not jump to the backup step when no cloud backup exists for this address', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    insideNimiqPay.value = true
    mocks.cloudBackupExists.mockResolvedValue(false)
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Claim your @handle')
    wrapper.unmount()
  })

  it('does not jump to the backup step when the user already chose "Start fresh"', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    insideNimiqPay.value = true
    mocks.cloudBackupExists.mockResolvedValue(true)
    localStorage.setItem('nimconnect:skipped-restore', '1')
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(mocks.cloudBackupExists).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Claim your @handle')
    wrapper.unmount()
  })

  it('publishes filled-in profile fields when the share step is reached, inside Nimiq Pay', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    await store.update(store.self!.id, { name: 'Alice', handle: 'alice', bio: 'Coffee enthusiast' })
    insideNimiqPay.value = true
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Share your public profile')
    expect(mocks.syncPublicProfile).toHaveBeenCalledTimes(1)
    const [profile, share] = mocks.syncPublicProfile.mock.calls[0]!
    expect(profile.name).toBe('Alice')
    expect(share).toEqual(expect.objectContaining({ name: true, bio: true, website: false }))
    wrapper.unmount()
  })

  it('does not attempt to publish outside Nimiq Pay', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    await store.update(store.self!.id, { name: 'Alice', handle: 'alice' })
    insideNimiqPay.value = false
    const wrapper = await mountWizard()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Share your public profile')
    expect(mocks.syncPublicProfile).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
