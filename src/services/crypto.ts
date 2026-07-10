import { gcm } from '@noble/ciphers/aes'
import { sha256 } from '@noble/hashes/sha256'
import { pbkdf2Async } from '@noble/hashes/pbkdf2'

const PBKDF2_ITERATIONS = 100_000
type DerivedKey = CryptoKey | Uint8Array

function subtleCrypto(): SubtleCrypto | undefined {
  return globalThis.crypto?.subtle
}

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<DerivedKey> {
  const subtle = subtleCrypto()
  const password = new TextEncoder().encode(passphrase)
  if (!subtle) {
    return pbkdf2Async(sha256, password, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 })
  }
  const base = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export async function encrypt(plaintext: string, key: DerivedKey): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ct = key instanceof Uint8Array
    ? gcm(key, iv).encrypt(encoded)
    : await subtleCrypto()!.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return out
}

export async function decrypt(blob: Uint8Array, key: DerivedKey): Promise<string> {
  const iv = blob.slice(0, 12)
  const ct = blob.slice(12)
  const plain = key instanceof Uint8Array
    ? gcm(key, iv).decrypt(ct)
    : await subtleCrypto()!.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(plain)
}
