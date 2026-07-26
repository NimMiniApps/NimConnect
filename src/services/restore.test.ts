import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { onboardingWizardShown, clearOnboardingWizardShown } from './onboarding'
import { resolveIdentitySetup, clearIdentitySetupState } from './identity-setup'
import { cloudBackupEnabled } from './backup-prefs'
import { afterRestore } from './restore'

vi.mock('../services/inbox', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/inbox')>()),
  fetchInbox: vi.fn().mockResolvedValue([]),
  deleteInboxMessage: vi.fn().mockResolvedValue(undefined),
}))

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

describe('afterRestore', () => {
  beforeEach(async () => {
    stubLocalStorage()
    clearOnboardingWizardShown()
    clearIdentitySetupState()
    cloudBackupEnabled.value = false
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  it('marks the onboarding wizard as shown, so it does not auto-launch after a restore', async () => {
    expect(onboardingWizardShown()).toBe(false)
    await afterRestore()
    expect(onboardingWizardShown()).toBe(true)
  })

  it('reports the whole identity-setup checklist complete after a restore, so nothing resumes it', async () => {
    const store = useProfilesStore()
    await store.ensureSelf('NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF')
    await store.update(store.self!.id, { name: 'Alice', handle: 'alice' })
    await store.add({ address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', name: 'Bob' })
    cloudBackupEnabled.value = true

    await afterRestore()

    const result = resolveIdentitySetup({
      handlesEnabled: true,
      handle: store.self!.handle ?? null,
      profileFilled: true,
      backupDone: true,
      contactCount: store.contacts.length,
    })
    expect(result.complete).toBe(true)
  })

  it('marks the onboarding flags before reloading stores, so a reactive self-watcher racing the reload sees them already set', async () => {
    const store = useProfilesStore()
    let flagsSetBeforeReload = false
    const originalReload = store.reload.bind(store)
    vi.spyOn(store, 'reload').mockImplementation(async () => {
      // App.vue watches profilesStore.self and reacts the instant reload() runs —
      // simulate that by checking the flags right as reload is invoked, not after.
      flagsSetBeforeReload = onboardingWizardShown()
      return originalReload()
    })

    await afterRestore()

    expect(flagsSetBeforeReload).toBe(true)
  })
})
