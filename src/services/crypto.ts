import { gcm } from '@noble/ciphers/aes'
import { sha256 } from '@noble/hashes/sha256'
import { pbkdf2Async } from '@noble/hashes/pbkdf2'
import { argon2idAsync } from '@noble/hashes/argon2'

/** Legacy PBKDF2 work factor for encrypted-backup v1 (SEC-002). */
export const PBKDF2_ITERATIONS_V1 = 100_000

/** OWASP Argon2id baseline (m=19 MiB, t=2, p=1). */
export const ARGON2ID_MEMORY_KIB = 19_456
export const ARGON2ID_TIME = 2
export const ARGON2ID_PARALLELISM = 1

export type DerivedKey = CryptoKey | Uint8Array

export type Argon2idParams = {
  m: number
  t: number
  p: number
}

export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  m: ARGON2ID_MEMORY_KIB,
  t: ARGON2ID_TIME,
  p: ARGON2ID_PARALLELISM,
}

function subtleCrypto(): SubtleCrypto | undefined {
  return globalThis.crypto?.subtle
}

/** PBKDF2-HMAC-SHA256 — only for decrypting legacy v1 backups. */
export async function deriveKeyV1(passphrase: string, salt: Uint8Array): Promise<DerivedKey> {
  const subtle = subtleCrypto()
  const password = new TextEncoder().encode(passphrase)
  if (!subtle) {
    return pbkdf2Async(sha256, password, salt, { c: PBKDF2_ITERATIONS_V1, dkLen: 32 })
  }
  const base = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS_V1, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

/** Argon2id for new v2 backups — stronger offline guessing resistance (SEC-002). */
export async function deriveKeyV2(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): Promise<Uint8Array> {
  const password = new TextEncoder().encode(passphrase)
  return argon2idAsync(password, salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: 32,
  })
}

/** @deprecated Prefer deriveKeyV1 / deriveKeyV2 explicitly. */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<DerivedKey> {
  return deriveKeyV1(passphrase, salt)
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
