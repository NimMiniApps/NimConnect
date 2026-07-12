import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from './profiles'
import { useInvoicesStore } from './invoices'
import { useBucketsStore } from './buckets'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const B = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

describe('import/export', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
    await db.invoices.clear()
    await db.buckets.clear()
  })

  it('round-trips invoices in a v2 export and accepts v1 without them', async () => {
    const store = useProfilesStore()
    const invoicesStore = useInvoicesStore()
    await store.load()
    await invoicesStore.load()
    await store.add({ address: A, name: 'Alice' })
    await invoicesStore.create({ address: A, amountNim: 12, description: 'Logo' })
    const doc = await store.exportDocument()
    expect(doc.invoices).toHaveLength(1)

    await db.profiles.clear()
    await db.invoices.clear()
    setActivePinia(createPinia())
    const store2 = useProfilesStore()
    const invoices2 = useInvoicesStore()
    await store2.load()
    await invoices2.load()
    await store2.importDocument(JSON.parse(JSON.stringify(doc)))
    expect(invoices2.byAddress(A)).toHaveLength(1)
    expect(invoices2.byAddress(A)[0].description).toBe('Logo')

    // v1 doc (no invoices key) still imports
    await expect(store2.importDocument({ app: 'NimConnect', version: 1, exportedAt: 1, profiles: [] }))
      .resolves.toEqual({ added: 0, skipped: 0, merged: 0 })
  })

  it('round-trips through export → import', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({
      address: A, name: 'Alice', tags: ['family'], notes: 'n', favorite: true,
      bio: 'Sister', website: 'https://alice.example', github: 'alice', x: 'alice',
    })
    const doc = await store.exportDocument()
    expect(doc.app).toBe('NimConnect')
    expect(doc.version).toBe(3)
    expect(doc.profiles).toHaveLength(1)

    await db.profiles.clear()
    setActivePinia(createPinia())
    const store2 = useProfilesStore()
    await store2.load()
    const result = await store2.importDocument(JSON.parse(JSON.stringify(doc)))
    expect(result).toEqual({ added: 1, skipped: 0, merged: 0 })
    expect(store2.profiles[0].name).toBe('Alice')
    expect(store2.profiles[0].favorite).toBe(true)
    expect(store2.profiles[0].bio).toBe('Sister')
    expect(store2.profiles[0].website).toBe('https://alice.example/')
    expect(store2.profiles[0].github).toBe('alice')
    expect(store2.profiles[0].x).toBe('alice')
  })

  it('merges duplicates and restores isSelf on import', async () => {
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
    expect(result).toEqual({ added: 1, skipped: 0, merged: 1 })
    expect(store.getByAddress(A)!.name).toBe('Dup')
    expect(store.getByAddress(A)!.isSelf).toBe(false)
    expect(store.getByAddress(B)!.isSelf).toBe(true)
  })

  it('strips unsafe URLs and handles on save/import', async () => {
    const store = useProfilesStore()
    await store.load()
    const p = await store.add({
      address: A, name: 'Evil',
      website: 'javascript:alert(1)', github: 'a/../b', x: '@way_too_long_for_an_x_handle',
    })
    expect(p.website).toBeUndefined()
    expect(p.github).toBeUndefined()
    expect(p.x).toBeUndefined()

    await store.update(p.id, { website: 'example.com', github: '@octocat', x: 'jack' })
    const updated = store.getById(p.id)!
    expect(updated.website).toBe('https://example.com/')
    expect(updated.github).toBe('octocat')
    expect(updated.x).toBe('jack')

    await store.update(p.id, { website: 'data:text/html,x' })
    expect(store.getById(p.id)!.website).toBeUndefined()
  })

  it('rejects malformed documents', async () => {
    const store = useProfilesStore()
    await store.load()
    await expect(store.importDocument({ nope: true })).rejects.toThrow('invalid-export')
    await expect(store.importDocument('[]')).rejects.toThrow('invalid-export')
  })
})

describe('bucket export/import round trip', () => {
  it('exports version 3 with buckets and imports them back', async () => {
    const profiles = useProfilesStore()
    const buckets = useBucketsStore()
    await profiles.load()
    await buckets.load()
    await buckets.create({ name: 'Barcelona', goalNim: 100 })

    const doc = await profiles.exportDocument()
    expect(doc.version).toBe(3)
    expect(doc.buckets).toHaveLength(1)

    await profiles.resetAll()
    expect(buckets.buckets).toHaveLength(0)
    expect(await db.buckets.count()).toBe(0)

    await profiles.importDocument(JSON.parse(JSON.stringify(doc)))
    expect(buckets.buckets.map(b => b.name)).toEqual(['Barcelona'])
  })

  it('still accepts v1 and v2 documents without buckets', async () => {
    const profiles = useProfilesStore()
    await profiles.load()
    await expect(profiles.importDocument({
      app: 'NimConnect', version: 2, exportedAt: Date.now(), profiles: [],
    })).resolves.toBeTruthy()
  })
})
