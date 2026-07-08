import type { EncryptedBackup, ExportDocument } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { deriveKey, encrypt, decrypt } from './crypto'

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

export async function createEncryptedBackup(passphrase: string, address?: string): Promise<EncryptedBackup> {
  const store = useProfilesStore()
  const doc = await store.exportDocument()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt)
  const ciphertext = await encrypt(JSON.stringify(doc), key)
  return {
    app: 'NimConnect',
    format: 'encrypted-backup',
    version: 1,
    address,
    salt: b64(salt),
    exportedAt: doc.exportedAt,
    ciphertext: b64(ciphertext),
  }
}

export async function parseEncryptedBackup(file: EncryptedBackup, passphrase: string): Promise<ExportDocument> {
  if (file.app !== 'NimConnect' || file.format !== 'encrypted-backup' || file.version !== 1) {
    throw new Error('invalid-backup')
  }
  const salt = fromB64(file.salt)
  const key = await deriveKey(passphrase, salt)
  const plain = await decrypt(fromB64(file.ciphertext), key)
  return JSON.parse(plain) as ExportDocument
}
