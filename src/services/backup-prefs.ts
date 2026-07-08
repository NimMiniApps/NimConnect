import { ref, watch } from 'vue'

const ENABLED_KEY = 'nimconnect:cloud-backup-enabled'
const LOCAL_AT_KEY = 'nimconnect:last-local-backup-at'
const CLOUD_AT_KEY = 'nimconnect:last-cloud-sync-at'
const PASSPHRASE_SET_KEY = 'nimconnect:backup-passphrase-set'

export const cloudBackupEnabled = ref(globalThis.localStorage?.getItem(ENABLED_KEY) === '1')
export const lastLocalBackupAt = ref(Number(globalThis.localStorage?.getItem(LOCAL_AT_KEY) || 0))
export const lastCloudSyncAt = ref(Number(globalThis.localStorage?.getItem(CLOUD_AT_KEY) || 0))
export const backupPassphraseSet = ref(globalThis.localStorage?.getItem(PASSPHRASE_SET_KEY) === '1')

watch(cloudBackupEnabled, v => {
  try { globalThis.localStorage?.setItem(ENABLED_KEY, v ? '1' : '0') } catch { /* best-effort */ }
})

export function markLocalBackup() {
  lastLocalBackupAt.value = Date.now()
  try { globalThis.localStorage?.setItem(LOCAL_AT_KEY, String(lastLocalBackupAt.value)) } catch {}
}

export function markCloudSync() {
  lastCloudSyncAt.value = Date.now()
  try { globalThis.localStorage?.setItem(CLOUD_AT_KEY, String(lastCloudSyncAt.value)) } catch {}
}

export function markPassphraseSet() {
  backupPassphraseSet.value = true
  try { globalThis.localStorage?.setItem(PASSPHRASE_SET_KEY, '1') } catch {}
}

export function formatBackupAge(ts: number): string {
  if (!ts) return 'Never'
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return new Date(ts).toLocaleDateString()
}
