import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useInvoicesStore } from './invoices'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const B = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

describe('invoices store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.invoices.clear()
  })

  it('creates pending invoices and lists them per address, newest first', async () => {
    const store = useInvoicesStore()
    await store.load()
    const first = await store.create({ address: A, amountNim: 10, description: 'Logo design' })
    await new Promise(r => setTimeout(r, 2))
    await store.create({ address: A, amountNim: 5, description: 'Hosting' })
    await store.create({ address: B, amountNim: 1, description: 'Other person' })

    expect(first.status).toBe('pending')
    const forA = store.byAddress(A)
    expect(forA.map(i => i.description)).toEqual(['Hosting', 'Logo design'])
    expect(store.byAddress(B)).toHaveLength(1)
  })

  it('rejects non-positive amounts', async () => {
    const store = useInvoicesStore()
    await store.load()
    await expect(store.create({ address: A, amountNim: 0, description: 'x' })).rejects.toThrow('invalid-amount')
  })

  it('marks paid and back to pending', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 10, description: 'Logo' })
    await store.setStatus(inv.id, 'paid')
    expect(store.byAddress(A)[0].status).toBe('paid')
    expect(store.byAddress(A)[0].paidAt).toBeTypeOf('number')
    await store.setStatus(inv.id, 'pending')
    expect(store.byAddress(A)[0].status).toBe('pending')
    expect(store.byAddress(A)[0].paidAt).toBeUndefined()
  })

  it('removes invoices and persists to db', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 2, description: 'x' })
    expect(await db.invoices.get(inv.id)).toBeTruthy()
    await store.remove(inv.id)
    expect(store.byAddress(A)).toHaveLength(0)
    expect(await db.invoices.get(inv.id)).toBeUndefined()
  })

  it('importMany skips duplicates and junk', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 2, description: 'existing' })
    const added = await store.importMany([
      inv, // duplicate id
      { id: 'new-1', address: B, amountNim: 3, description: 'ok', status: 'paid', createdAt: 1, paidAt: 2 },
      { id: '', address: B, amountNim: 3, description: 'no id', status: 'pending', createdAt: 1 },
    ] as never)
    expect(added).toBe(1)
    expect(store.byAddress(B)[0].status).toBe('paid')
  })
})
