import { mount, DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BackupOnboardingSheet from './BackupOnboardingSheet.vue'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { backupOnboardingDone, clearBackupOnboardingDone } from '../services/onboarding'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

describe('BackupOnboardingSheet embedded mode', () => {
  beforeEach(async () => {
    stubLocalStorage()
    clearBackupOnboardingDone()
    setActivePinia(createPinia())
    await db.profiles.clear()
    const store = useProfilesStore()
    await store.load()
  })

  it('emits defer without marking backup onboarding done when skipped', async () => {
    const wrapper = mount(BackupOnboardingSheet, {
      props: { open: true, embedded: true },
      attachTo: document.body,
    })
    const skipButtons = wrapper.findAll('.item').filter(b => b.text() === 'Skip for now')
    await skipButtons[0]!.trigger('click')
    expect(wrapper.emitted('defer')?.length).toBeGreaterThan(0)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(backupOnboardingDone()).toBe(false)
    wrapper.unmount()
  })

  it('standalone skip still marks backup onboarding done and emits close', async () => {
    const wrapper = mount(BackupOnboardingSheet, {
      props: { open: true },
      attachTo: document.body,
    })
    // Teleported — find Skip in document
    const body = new DOMWrapper(document.body)
    const skipButtons = body.findAll('.item').filter(b => b.text() === 'Skip for now')
    await skipButtons[0]!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('defer')).toBeUndefined()
    expect(backupOnboardingDone()).toBe(true)
    wrapper.unmount()
  })
})
