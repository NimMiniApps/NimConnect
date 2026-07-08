import { apiUrl, hasApiBase } from './api'
import { createEncryptedBackup } from './backup'
import { cloudBackupEnabled, markCloudSync } from './backup-prefs'
import { signChallenge } from './nimiq'
import type { EncryptedBackup } from '../types/profile'

export interface BackupSession {
  passphrase: string
  address: string
}

let session: BackupSession | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null

function compactAddress(address: string) {
  return address.replace(/\s+/g, '')
}

function challenge(address: string, exportedAt: number) {
  return `nimconnect-backup:v1:${compactAddress(address)}:${exportedAt}`
}

function backupPath(address: string) {
  return `/api/backup/${encodeURIComponent(compactAddress(address))}`
}

async function backupErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string }
    if (res.status === 401) {
      return 'Wallet signature was rejected. Use Nimiq Pay with the same wallet as your profile.'
    }
    if (body.error === 'newer backup exists') return 'A newer cloud backup already exists for this wallet.'
    if (body.error) return `Cloud backup failed: ${body.error}`
  } catch { /* ignore */ }
  if (res.status >= 500) return 'Cloud backup server error — is the API running?'
  return `Cloud backup failed (${res.status})`
}

export function setBackupSession(passphrase: string, address: string) {
  session = { passphrase, address }
}

export function clearBackupSession() {
  session = null
}

export function getBackupSession(): BackupSession | null {
  return session
}

export function cloudBackupAvailable(): boolean {
  return hasApiBase()
}

export async function uploadCloudBackup(passphrase: string, address: string): Promise<void> {
  if (!hasApiBase()) throw new Error('cloud-backup-unavailable')
  const file = await createEncryptedBackup(passphrase, address)
  const { publicKey, signature } = await signChallenge(challenge(address, file.exportedAt))
  const res = await fetch(apiUrl(backupPath(address)), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      exported_at: file.exportedAt,
      salt: file.salt,
      ciphertext: file.ciphertext,
      public_key: publicKey,
      signature,
    }),
  })
  if (!res.ok) throw new Error(await backupErrorMessage(res))
  markCloudSync()
}

export async function downloadCloudBackup(address: string): Promise<EncryptedBackup | null> {
  if (!hasApiBase()) return null
  const res = await fetch(apiUrl(backupPath(address)))
  if (res.status === 404) return null
  if (!res.ok) throw new Error(await backupErrorMessage(res))
  const body = await res.json()
  return {
    app: 'NimConnect',
    format: 'encrypted-backup',
    version: 1,
    address: body.address,
    salt: body.salt,
    exportedAt: body.exported_at,
    ciphertext: body.ciphertext,
  }
}

export function scheduleCloudSync(passphrase?: string, address?: string) {
  if (!cloudBackupEnabled.value || !hasApiBase()) return
  const s = session ?? (passphrase && address ? { passphrase, address } : null)
  if (!s) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    uploadCloudBackup(s.passphrase, s.address).catch(() => {})
  }, 30_000)
}

export function notifyDataChanged() {
  scheduleCloudSync()
}
