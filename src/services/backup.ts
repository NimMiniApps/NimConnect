import type { EncryptedBackup, ExportDocument } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import {
  DEFAULT_ARGON2ID_PARAMS,
  PBKDF2_ITERATIONS_V1,
  deriveKeyV1,
  deriveKeyV2,
  encrypt,
  decrypt,
} from './crypto'

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
  const key = await deriveKeyV2(passphrase, salt, DEFAULT_ARGON2ID_PARAMS)
  const ciphertext = await encrypt(JSON.stringify(doc), key)
  return {
    app: 'NimConnect',
    format: 'encrypted-backup',
    version: 2,
    address,
    salt: b64(salt),
    exportedAt: doc.exportedAt,
    ciphertext: b64(ciphertext),
    kdf: {
      name: 'argon2id',
      m: DEFAULT_ARGON2ID_PARAMS.m,
      t: DEFAULT_ARGON2ID_PARAMS.t,
      p: DEFAULT_ARGON2ID_PARAMS.p,
    },
  }
}

export async function parseEncryptedBackup(file: EncryptedBackup, passphrase: string): Promise<ExportDocument> {
  if (file.app !== 'NimConnect' || file.format !== 'encrypted-backup') {
    throw new Error('invalid-backup')
  }
  if (file.version !== 1 && file.version !== 2) {
    throw new Error('invalid-backup')
  }
  const salt = fromB64(file.salt)
  const key = file.version === 2
    ? await deriveKeyV2(passphrase, salt, {
      m: file.kdf?.name === 'argon2id' ? file.kdf.m : DEFAULT_ARGON2ID_PARAMS.m,
      t: file.kdf?.name === 'argon2id' ? file.kdf.t : DEFAULT_ARGON2ID_PARAMS.t,
      p: file.kdf?.name === 'argon2id' ? file.kdf.p : DEFAULT_ARGON2ID_PARAMS.p,
    })
    : await deriveKeyV1(passphrase, salt)
  const plain = await decrypt(fromB64(file.ciphertext), key)
  return JSON.parse(plain) as ExportDocument
}

/** Build a legacy v1 envelope for tests / migration checks. */
export async function createLegacyV1EncryptedBackup(
  passphrase: string,
  address?: string,
): Promise<EncryptedBackup> {
  const store = useProfilesStore()
  const doc = await store.exportDocument()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKeyV1(passphrase, salt)
  const ciphertext = await encrypt(JSON.stringify(doc), key)
  return {
    app: 'NimConnect',
    format: 'encrypted-backup',
    version: 1,
    address,
    salt: b64(salt),
    exportedAt: doc.exportedAt,
    ciphertext: b64(ciphertext),
    kdf: { name: 'pbkdf2-sha256', iterations: PBKDF2_ITERATIONS_V1 },
  }
}
