import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useInvoicesStore, matchPayments, isOverdue, addMonthClamped } from './invoices'
import type { Invoice } from '../types/profile'
import type { IncomingPayment } from '../services/history'

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

  it('summarizes pending invoices across contacts', async () => {
    const store = useInvoicesStore()
    await store.load()
    const older = await store.create({ address: A, amountNim: 10, description: 'Logo design' })
    await new Promise(r => setTimeout(r, 2))
    const newer = await store.create({ address: B, amountNim: 2.5, description: 'Lunch' })
    await store.setStatus(older.id, 'paid')
    await new Promise(r => setTimeout(r, 2))
    await store.create({ address: A, amountNim: 1.25, description: 'Hosting' })

    expect(store.pending.map(i => i.description)).toEqual(['Hosting', 'Lunch'])
    expect(store.pendingByAddress(A).map(i => i.description)).toEqual(['Hosting'])
    expect(store.pendingByAddress(B).map(i => i.id)).toEqual([newer.id])
    expect(store.pendingTotalNim).toBe(3.75)
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

  it('sorts overdue pending invoices first', async () => {
    const store = useInvoicesStore()
    await store.load()
    await store.create({ address: A, amountNim: 1, description: 'no due date' })
    await new Promise(r => setTimeout(r, 2))
    await store.create({ address: A, amountNim: 2, description: 'future', dueAt: Date.now() + 86_400_000 })
    await new Promise(r => setTimeout(r, 2))
    const overdue = await store.create({ address: A, amountNim: 3, description: 'overdue', dueAt: Date.now() - 1000 })

    expect(store.pending[0].id).toBe(overdue.id)
    expect(isOverdue(store.pending[0])).toBe(true)
    expect(isOverdue(store.pending[1])).toBe(false)
  })

  it('lists paid invoices newest-paid first', async () => {
    const store = useInvoicesStore()
    await store.load()
    const first = await store.create({ address: A, amountNim: 1, description: 'first paid' })
    const second = await store.create({ address: A, amountNim: 2, description: 'second paid' })
    await store.create({ address: A, amountNim: 3, description: 'still pending' })
    await store.setStatus(first.id, 'paid')
    await new Promise(r => setTimeout(r, 2))
    await store.setStatus(second.id, 'paid')

    expect(store.paid.map(i => i.description)).toEqual(['second paid', 'first paid'])
  })

  it('duplicates an invoice as a fresh pending copy', async () => {
    const store = useInvoicesStore()
    await store.load()
    const source = await store.create({
      address: A, amountNim: 7, description: 'Rent', fiatAmount: 10, fiatCurrency: 'EUR',
    })
    await store.setStatus(source.id, 'paid')
    await new Promise(r => setTimeout(r, 2))
    const copy = await store.duplicate(source.id)

    expect(copy).toBeTruthy()
    expect(copy!.id).not.toBe(source.id)
    expect(copy!.status).toBe('pending')
    expect(copy!.paidAt).toBeUndefined()
    expect(copy!.amountNim).toBe(7)
    expect(copy!.description).toBe('Rent')
    expect(copy!.fiatAmount).toBe(10)
    expect(copy!.fiatCurrency).toBe('EUR')
    expect(copy!.createdAt).toBeGreaterThan(source.createdAt)
    expect(await store.duplicate('missing-id')).toBeUndefined()
  })

  it('importMany preserves due dates', async () => {
    const store = useInvoicesStore()
    await store.load()
    await store.importMany([
      { id: 'due-1', address: A, amountNim: 3, description: 'x', status: 'pending', createdAt: 1, dueAt: 99 },
    ] as never)
    expect(store.byAddress(A)[0].dueAt).toBe(99)
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

describe('matchPayments', () => {
  // Realistic ms epoch — timestamps below 1e12 get treated as seconds and scaled
  const T0 = Date.parse('2026-01-01T00:00:00Z')
  const inv = (id: string, address: string, amountNim: number, createdAt: number): Invoice =>
    ({ id, address, amountNim, description: '', status: 'pending', createdAt })
  const pay = (hash: string, sender: string, valueNim: number, timestamp: number): IncomingPayment =>
    ({ hash, sender, valueNim, timestamp })

  it('matches an incoming payment to a pending invoice from the same address', () => {
    const matches = matchPayments(
      [inv('i1', A, 10, T0)],
      [pay('tx1', A, 10, T0 + 1000)],
    )
    expect(matches.get('i1')?.hash).toBe('tx1')
  })

  it('ignores payments that are too small, too early, or from someone else', () => {
    const matches = matchPayments(
      [inv('i1', A, 10, T0)],
      [
        pay('small', A, 9.99, T0 + 1000),
        pay('early', A, 10, T0 - 1000),
        pay('other', B, 10, T0 + 1000),
      ],
    )
    expect(matches.size).toBe(0)
  })

  it('matches compact and spaced address forms', () => {
    const matches = matchPayments(
      [inv('i1', A, 10, T0)],
      [pay('tx1', A.replace(/\s+/g, '').toLowerCase(), 10, T0 + 1000)],
    )
    expect(matches.get('i1')?.hash).toBe('tx1')
  })

  it('settles each payment against at most one invoice, oldest invoice first', () => {
    const matches = matchPayments(
      [inv('newer', A, 10, T0 + 1000), inv('older', A, 10, T0)],
      [pay('tx1', A, 10, T0 + 2000)],
    )
    expect(matches.get('older')?.hash).toBe('tx1')
    expect(matches.has('newer')).toBe(false)
  })

  it('normalizes second-based chain timestamps before comparing', () => {
    // Invoice created at ms epoch; payment timestamp in seconds
    const createdAt = Date.parse('2026-01-01T00:00:00Z')
    const matches = matchPayments(
      [inv('i1', A, 10, createdAt)],
      [pay('tx1', A, 10, Math.floor(createdAt / 1000) + 60)],
    )
    expect(matches.get('i1')?.hash).toBe('tx1')
  })
})

describe('addMonthClamped', () => {
  it('advances a mid-month date by one calendar month', () => {
    const d = new Date(addMonthClamped(new Date(2026, 0, 15).getTime()))
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 1, 15])
  })

  it('clamps Jan 31 to the last day of February', () => {
    const d = new Date(addMonthClamped(new Date(2026, 0, 31).getTime()))
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 1, 28])
  })

  it('clamps to Feb 29 in leap years', () => {
    const d = new Date(addMonthClamped(new Date(2028, 0, 31).getTime()))
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2028, 1, 29])
  })
})

describe('recurring invoices', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.invoices.clear()
  })

  it('markPaid without repeat marks paid and creates no successor', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 10, description: 'One-off' })
    await store.markPaid(inv.id)
    expect(store.invoices).toHaveLength(1)
    expect(store.invoices[0].status).toBe('paid')
    expect(store.invoices[0].successorInvoiceId).toBeUndefined()
  })

  it('markPaid on a repeating invoice creates one pending successor, due one interval later', async () => {
    const store = useInvoicesStore()
    await store.load()
    const due = new Date(2026, 6, 1).getTime()
    const inv = await store.create({ address: A, amountNim: 10, description: 'Rent', dueAt: due, repeat: 'monthly' })
    await store.markPaid(inv.id)

    const source = store.invoices.find(i => i.id === inv.id)!
    expect(source.status).toBe('paid')
    expect(source.successorInvoiceId).toBeTypeOf('string')

    const successor = store.invoices.find(i => i.id === source.successorInvoiceId)!
    expect(successor.status).toBe('pending')
    expect(successor.address).toBe(A)
    expect(successor.amountNim).toBe(10)
    expect(successor.repeat).toBe('monthly')
    expect(successor.dueAt).toBe(addMonthClamped(due))
    expect(await db.invoices.get(successor.id)).toBeTruthy()
  })

  it('weekly repeat advances dueAt by 7 days; no dueAt falls back to paidAt + interval', async () => {
    const store = useInvoicesStore()
    await store.load()
    const due = new Date(2026, 6, 1).getTime()
    const weekly = await store.create({ address: A, amountNim: 5, description: 'W', dueAt: due, repeat: 'weekly' })
    const noDue = await store.create({ address: A, amountNim: 5, description: 'N', repeat: 'weekly' })
    await store.markPaid(weekly.id)
    await store.markPaid(noDue.id)

    const wSucc = store.invoices.find(i => i.id === store.invoices.find(x => x.id === weekly.id)!.successorInvoiceId)!
    expect(wSucc.dueAt).toBe(due + 7 * 86_400_000)

    const nSource = store.invoices.find(i => i.id === noDue.id)!
    const nSucc = store.invoices.find(i => i.id === nSource.successorInvoiceId)!
    expect(nSucc.dueAt).toBe(nSource.paidAt! + 7 * 86_400_000)
  })

  it('double and concurrent markPaid create exactly one successor', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 10, description: 'Rent', repeat: 'monthly' })
    await Promise.all([store.markPaid(inv.id), store.markPaid(inv.id)])
    await store.markPaid(inv.id)
    expect(store.invoices).toHaveLength(2)
    expect(await db.invoices.count()).toBe(2)
  })

  it('paid → pending → paid round trip never creates a second successor', async () => {
    const store = useInvoicesStore()
    await store.load()
    const inv = await store.create({ address: A, amountNim: 10, description: 'Rent', repeat: 'monthly' })
    await store.markPaid(inv.id)
    await store.setStatus(inv.id, 'pending')
    expect(store.invoices.find(i => i.id === inv.id)!.successorInvoiceId).toBeTypeOf('string')
    await store.markPaid(inv.id)
    expect(store.invoices).toHaveLength(2)
  })

  it('importMany passes repeat and successorInvoiceId through', async () => {
    const store = useInvoicesStore()
    await store.load()
    await store.importMany([{
      id: 'imp-1', address: A, amountNim: 3, description: 'x', status: 'pending',
      createdAt: Date.now(), repeat: 'monthly', successorInvoiceId: 'imp-2',
    } as Invoice])
    expect(store.invoices[0].repeat).toBe('monthly')
    expect(store.invoices[0].successorInvoiceId).toBe('imp-2')
  })
})

describe('matchPayments with sender aliases', () => {
  const T0 = Date.parse('2026-01-01T00:00:00Z')
  const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
  const inv = (id: string, address: string, amountNim: number, createdAt: number): Invoice =>
    ({ id, address, amountNim, description: '', status: 'pending', createdAt })
  const pay = (hash: string, sender: string, valueNim: number, timestamp: number): IncomingPayment =>
    ({ hash, sender, valueNim, timestamp })

  it('matches a payment from the contact\'s paired outgoing address', () => {
    // Invoice registered to B (receive address); wallet pays from A (outgoing account)
    const aliases = new Map([[compact(B), new Set([compact(A)])]])
    const matches = matchPayments(
      [inv('i1', B, 1, T0)],
      [pay('tx1', A, 1, T0 + 1000)],
      aliases,
    )
    expect(matches.get('i1')?.hash).toBe('tx1')
  })

  it('does not match aliased senders against other invoices', () => {
    const aliases = new Map([[compact(B), new Set([compact(A)])]])
    const matches = matchPayments(
      [inv('i1', 'NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN', 1, T0)],
      [pay('tx1', A, 1, T0 + 1000)],
      aliases,
    )
    expect(matches.size).toBe(0)
  })
})
