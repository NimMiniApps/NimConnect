import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from './profiles'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const B = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

describe('profiles store views', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  async function seed() {
    const store = useProfilesStore()
    await store.load()
    const alice = await store.add({ address: A, name: 'Alice', tags: ['family'], notes: 'pays rent' })
    const bob = await store.add({ address: B, name: 'Bob Café', tags: ['merchant', 'coffee'], favorite: true })
    return { store, alice, bob }
  }

  it('sorts contacts alphabetically and favorites first list', async () => {
    const { store } = await seed()
    expect(store.sortedContacts.map(p => p.name)).toEqual(['Alice', 'Bob Café'])
    expect(store.favorites.map(p => p.name)).toEqual(['Bob Café'])
  })

  it('recent lists interacted profiles, most recent first, max 5', async () => {
    const { store, alice, bob } = await seed()
    expect(store.recent).toHaveLength(0)
    await store.update(alice.id, { lastInteractionAt: 1000 })
    await store.update(bob.id, { lastInteractionAt: 2000 })
    expect(store.recent.map(p => p.name)).toEqual(['Bob Café', 'Alice'])
  })

  it('collects unique sorted tags', async () => {
    const { store } = await seed()
    expect(store.allTags).toEqual(['coffee', 'family', 'merchant'])
  })

  it('searches across name, address, notes, tags, and @handles', async () => {
    const { store, alice } = await seed()
    await store.update(alice.id, { handle: 'alice' })
    expect(store.search('coffee').map(p => p.name)).toEqual(['Bob Café'])
    expect(store.search('RENT').map(p => p.name)).toEqual(['Alice'])
    expect(store.search('nq268mmt').map(p => p.name)).toEqual(['Bob Café'])
    expect(store.search('family').map(p => p.name)).toEqual(['Alice'])
    expect(store.search('@alice').map(p => p.name)).toEqual(['Alice'])
    expect(store.search('alice').map(p => p.name)).toEqual(['Alice'])
    expect(store.search('')).toHaveLength(2)
    expect(store.search('zzz')).toHaveLength(0)
  })
})
