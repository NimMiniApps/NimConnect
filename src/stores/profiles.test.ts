import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from './profiles'

const ADDR_A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const ADDR_B = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

describe('profiles store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  it('adds a profile with normalized address and defaults', async () => {
    const store = useProfilesStore()
    await store.load()
    const p = await store.add({ address: 'nq07 0000 0000 0000 0000 0000 0000 0000 0000', name: 'Alice' })
    expect(p.address).toBe(ADDR_A)
    expect(p.type).toBe('person')
    expect(p.isSelf).toBe(false)
    expect(store.profiles).toHaveLength(1)
    expect(await db.profiles.get(p.id)).toBeTruthy()
  })

  it('rejects invalid addresses', async () => {
    const store = useProfilesStore()
    await store.load()
    await expect(store.add({ address: 'NQ00 not valid', name: 'X' })).rejects.toThrow('invalid-address')
  })

  it('rejects duplicate addresses', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: ADDR_A, name: 'Alice' })
    await expect(store.add({ address: ADDR_A.toLowerCase(), name: 'Alice 2' })).rejects.toThrow('duplicate-address')
  })

  it('updates, toggles favorite, touches interaction, removes', async () => {
    const store = useProfilesStore()
    await store.load()
    const p = await store.add({ address: ADDR_A, name: 'Alice' })
    await store.update(p.id, { name: 'Alicia', notes: 'rent' })
    expect(store.getById(p.id)!.name).toBe('Alicia')
    expect(store.getById(p.id)!.updatedAt).toBeGreaterThanOrEqual(p.updatedAt)

    await store.toggleFavorite(p.id)
    expect(store.getById(p.id)!.favorite).toBe(true)

    await store.touchInteraction(p.id)
    expect(store.getById(p.id)!.lastInteractionAt).toBeTypeOf('number')

    await store.remove(p.id)
    expect(store.profiles).toHaveLength(0)
    expect(await db.profiles.get(p.id)).toBeUndefined()
  })

  it('ensureSelf creates one self profile and is idempotent', async () => {
    const store = useProfilesStore()
    await store.load()
    const self1 = await store.ensureSelf(ADDR_B)
    const self2 = await store.ensureSelf(ADDR_B)
    expect(self1.id).toBe(self2.id)
    expect(self1.isSelf).toBe(true)
    expect(store.profiles.filter(p => p.isSelf)).toHaveLength(1)
  })
})
