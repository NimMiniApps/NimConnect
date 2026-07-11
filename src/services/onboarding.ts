import type { Profile } from '../types/profile'
import {
  backupPassphraseSet,
  cloudBackupEnabled,
  lastLocalBackupAt,
} from './backup-prefs'

const DONE_KEY = 'nimconnect:onboarding-done'
const BACKUP_DONE_KEY = 'nimconnect:backup-onboarding-done'

export function onboardingDone(): boolean {
  return globalThis.localStorage?.getItem(DONE_KEY) === '1'
}

export function markOnboardingDone(): void {
  try { globalThis.localStorage?.setItem(DONE_KEY, '1') } catch { /* best-effort */ }
}

export function clearOnboardingDone(): void {
  try { globalThis.localStorage?.removeItem(DONE_KEY) } catch { /* best-effort */ }
}

export function backupOnboardingDone(): boolean {
  return globalThis.localStorage?.getItem(BACKUP_DONE_KEY) === '1'
}

export function markBackupOnboardingDone(): void {
  try { globalThis.localStorage?.setItem(BACKUP_DONE_KEY, '1') } catch { /* best-effort */ }
}

export function clearBackupOnboardingDone(): void {
  try { globalThis.localStorage?.removeItem(BACKUP_DONE_KEY) } catch { /* best-effort */ }
}

/** True when the user still has the auto-created stub profile and hasn't finished onboarding. */
export function needsOnboarding(self: Profile | null | undefined): boolean {
  if (!self) return false
  if (onboardingDone()) return false
  return self.name === 'Me'
}

/** True when the user hasn't set up a backup yet and hasn't dismissed the backup prompt. */
export function needsBackupOnboarding(): boolean {
  if (backupOnboardingDone()) return false
  if (backupPassphraseSet.value) return false
  if (lastLocalBackupAt.value > 0) return false
  if (cloudBackupEnabled.value) return false
  return true
}
