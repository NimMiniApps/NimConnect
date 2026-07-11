import { describe, it, expect, vi } from 'vitest'
import { cloudBackupExists } from './cloud-backup'

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
