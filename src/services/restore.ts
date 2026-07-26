import { ref } from 'vue'
import { router } from '../router'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore } from '../stores/invoices'
import { useInboxStore } from '../stores/inbox'
import { useBucketsStore } from '../stores/buckets'
import { cloudBackupEnabled, markCloudSync, markPassphraseSet } from './backup-prefs'
import { setBackupSession } from './cloud-backup'
import { markOnboardingDone, markBackupOnboardingDone, markOnboardingWizardShown } from './onboarding'
import { dismissShareProfile } from './identity-setup'

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
  const buckets = useBucketsStore()

  // Set before any reload: App.vue watches profilesStore.self and reactively opens
  // the onboarding wizard the instant it changes, which profiles.reload() below
  // triggers immediately — these flags must already be in place or that watcher
  // races ahead of us and opens the wizard mid-restore.
  markOnboardingDone()
  markBackupOnboardingDone()
  markOnboardingWizardShown()
  dismissShareProfile()

  await profiles.reload()
  await invoices.reload()
  await inbox.reload()
  await buckets.reload()

  if (profiles.self) {
    inbox.selfAddress = profiles.self.address
    await inbox.refresh(profiles.self.address)
  }

  dataRefreshEpoch.value++

  if (router.currentRoute.value.path !== '/') {
    await router.push('/')
  }
}
