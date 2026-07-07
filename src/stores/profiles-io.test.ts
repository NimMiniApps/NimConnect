import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from './profiles'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const B = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

describe('import/export', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  it('round-trips through export → import', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice', tags: ['family'], notes: 'n', favorite: true })
    const doc = store.exportDocument()
    expect(doc.app).toBe('NimConnect')
    expect(doc.version).toBe(1)
    expect(doc.profiles).toHaveLength(1)

    await db.profiles.clear()
    setActivePinia(createPinia())
    const store2 = useProfilesStore()
    await store2.load()
    const result = await store2.importDocument(JSON.parse(JSON.stringify(doc)))
    expect(result).toEqual({ added: 1, skipped: 0 })
    expect(store2.profiles[0].name).toBe('Alice')
    expect(store2.profiles[0].favorite).toBe(true)
  })

  it('skips duplicates and strips isSelf on import', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice' })
    const doc = {
      app: 'NimConnect', version: 1, exportedAt: Date.now(),
      profiles: [
        { id: 'x', address: A, name: 'Dup', type: 'person', isSelf: true, notes: '', tags: [], favorite: false, createdAt: 1, updatedAt: 1 },
        { id: 'y', address: B, name: 'Bob', type: 'person', isSelf: true, notes: '', tags: [], favorite: false, createdAt: 1, updatedAt: 1 },
      ],
    }
    const result = await store.importDocument(doc)
    expect(result).toEqual({ added: 1, skipped: 1 })
    expect(store.getByAddress(B)!.isSelf).toBe(false)
  })

  it('rejects malformed documents', async () => {
    const store = useProfilesStore()
    await store.load()
    await expect(store.importDocument({ nope: true })).rejects.toThrow('invalid-export')
    await expect(store.importDocument('[]')).rejects.toThrow('invalid-export')
  })
})
