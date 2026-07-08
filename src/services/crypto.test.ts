import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, deriveKey } from './crypto'

describe('crypto', () => {
  it('round-trips JSON through encrypt/decrypt', async () => {
    const plain = JSON.stringify({ hello: 'world' })
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveKey('test-passphrase', salt)
    const blob = await encrypt(plain, key)
    expect(await decrypt(blob, key)).toBe(plain)
  })

  it('fails decrypt with wrong passphrase', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveKey('right', salt)
    const blob = await encrypt('secret', key)
    const wrong = await deriveKey('wrong', salt)
    await expect(decrypt(blob, wrong)).rejects.toThrow()
  })
})
