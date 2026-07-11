import { ref } from 'vue'
import { router } from '../router'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore } from '../stores/invoices'
import { useInboxStore } from '../stores/inbox'
import { cloudBackupEnabled, markCloudSync, markPassphraseSet } from './backup-prefs'
import { setBackupSession } from './cloud-backup'
import { markOnboardingDone, markBackupOnboardingDone } from './onboarding'

/** Bumped after restore so mounted pages reload store data from Dexie. */
export const dataRefreshEpoch = ref(0)

/** Turn cloud sync back on after restoring from an existing cloud backup. */
export function enableCloudAfterRestore(passphrase: string, address: string): void {
  setBackupSession(passphrase, address)
  cloudBackupEnabled.value = true
  markPassphraseSet()
  markCloudSync()
}

/** Refresh all stores after a backup restore so the UI reflects imported data. */
export async function afterRestore(): Promise<void> {
  const profiles = useProfilesStore()
  const invoices = useInvoicesStore()
  const inbox = useInboxStore()

  await profiles.reload()
  await invoices.reload()
  await inbox.reload()

  if (profiles.self) {
    inbox.selfAddress = profiles.self.address
    await inbox.refresh(profiles.self.address)
  }

  markOnboardingDone()
  markBackupOnboardingDone()
  dataRefreshEpoch.value++

  if (router.currentRoute.value.path !== '/') {
    await router.push('/')
  }
}
