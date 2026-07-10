import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { createEncryptedBackup, parseEncryptedBackup } from './backup'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const nativeCrypto = globalThis.crypto

describe('backup', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
    await db.invoices.clear()
  })

  afterEach(() => {
    vi.stubGlobal('crypto', nativeCrypto)
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

  it('round-trips when the embedded browser has no WebCrypto subtle API', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    })

    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice' })

    const file = await createEncryptedBackup('test password', A)
    const doc = await parseEncryptedBackup(file, 'test password')

    expect(doc.profiles).toHaveLength(1)
    expect(doc.profiles[0].name).toBe('Alice')
  })

  it('opens an existing WebCrypto backup without the subtle API', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice' })
    const file = await createEncryptedBackup('test password', A)

    vi.stubGlobal('crypto', {
      getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    })
    const doc = await parseEncryptedBackup(file, 'test password')

    expect(doc.profiles[0].name).toBe('Alice')
  })

  it('opens a fallback-encrypted backup with WebCrypto', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    })
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice' })
    const file = await createEncryptedBackup('test password', A)

    vi.stubGlobal('crypto', nativeCrypto)
    const doc = await parseEncryptedBackup(file, 'test password')

    expect(doc.profiles[0].name).toBe('Alice')
  })
})
