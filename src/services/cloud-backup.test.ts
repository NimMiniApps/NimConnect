import { describe, it, expect, vi } from 'vitest'
import {
  backupChallengeV2,
  ciphertextSHA256Hex,
  cloudBackupExists,
} from './cloud-backup'

describe('cloudBackupExists', () => {
  it('returns true when HEAD succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true }))
    await expect(cloudBackupExists('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).resolves.toBe(true)
  })

  it('returns false when HEAD is 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }))
    await expect(cloudBackupExists('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).resolves.toBe(false)
  })
})

describe('backupChallengeV2', () => {
  it('binds address, timestamp, salt, and ciphertext hash', () => {
    const ct = btoa('ciphertext')
    const hash = ciphertextSHA256Hex(ct)
    expect(backupChallengeV2('NQ07 0000 0000 0000 0000 0000 0000 0000 0000', 1710000000000, 'c2FsdA==', hash)).toBe(
      'nimconnect-backup:v2'
      + '\naddress=NQ0700000000000000000000000000000000'
      + '\nenvelope=2'
      + '\nexportedAt=1710000000000'
      + '\nsalt=c2FsdA=='
      + `\nciphertextHash=${hash}`,
    )
  })

  it('changes when ciphertext changes', () => {
    const a = ciphertextSHA256Hex(btoa('a'))
    const b = ciphertextSHA256Hex(btoa('b'))
    expect(a).not.toBe(b)
  })
})
