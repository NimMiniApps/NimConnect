import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { createEncryptedBackup, parseEncryptedBackup } from './backup'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

describe('backup', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
    await db.invoices.clear()
  })

  it('round-trips export through encrypt/decrypt import', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice' })
    const file = await createEncryptedBackup('secret', A)
    expect(file.format).toBe('encrypted-backup')

    await db.profiles.clear()
    setActivePinia(createPinia())
    const store2 = useProfilesStore()
    await store2.load()
    const doc = await parseEncryptedBackup(file, 'secret')
    await store2.importDocument(doc)
    expect(store2.profiles).toHaveLength(1)
    expect(store2.profiles[0].name).toBe('Alice')
  })

  it('rejects wrong passphrase', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice' })
    const file = await createEncryptedBackup('secret', A)
    await expect(parseEncryptedBackup(file, 'wrong')).rejects.toThrow()
  })
})
