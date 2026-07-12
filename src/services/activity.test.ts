import { describe, it, expect, beforeEach, vi } from 'vitest'
import { newActivity, getLastSeen, setLastSeen, DUE_SOON_MS } from './activity'
import type { IncomingPayment } from './history'
import type { Invoice, InboxItem } from '../types/profile'

const T0 = new Date(2026, 6, 10).getTime()

function payment(overrides: Partial<IncomingPayment>): IncomingPayment {
  return { hash: Math.random().toString(36), timestamp: T0, valueNim: 1, sender: 'NQ07 0000', ...overrides }
}

function inboxItem(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: Math.random().toString(36), objectId: 'o', type: 'payment-request', sender: 'NQ07 0000',
    payload: '', sentAt: T0, receivedAt: T0, status: 'actionable', importedAt: T0, reminders: 0,
    ...overrides,
  }
}

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: Math.random().toString(36), address: 'NQ07 0000', amountNim: 1, description: '',
    status: 'pending', createdAt: T0, ...overrides,
  }
}

describe('newActivity', () => {
  it('flags payments and requests newer than lastSeenAt', () => {
    const out = newActivity({
      payments: [payment({ timestamp: T0 + 1000 }), payment({ timestamp: T0 - 1000 })],
      inboxItems: [inboxItem({ receivedAt: T0 + 1000 }), inboxItem({ receivedAt: T0 - 1000 })],
      invoices: [],
      lastSeenAt: T0,
    })
    expect(out.payments).toHaveLength(1)
    expect(out.requests).toHaveLength(1)
  })

  it('normalizes seconds-based chain timestamps before comparing', () => {
    const seconds = Math.floor((T0 + 60_000) / 1000)
    const out = newActivity({
      payments: [payment({ timestamp: seconds })],
      inboxItems: [], invoices: [], lastSeenAt: T0,
    })
    expect(out.payments).toHaveLength(1)
  })

  it('ignores non-actionable inbox items', () => {
    const out = newActivity({
      payments: [],
      inboxItems: [inboxItem({ receivedAt: T0 + 1000, status: 'dismissed' })],
      invoices: [], lastSeenAt: T0,
    })
    expect(out.requests).toHaveLength(0)
  })

  it('flags pending invoices overdue or due within 48h, regardless of lastSeenAt', () => {
    const out = newActivity({
      payments: [], inboxItems: [],
      invoices: [
        invoice({ dueAt: T0 - 1000 }),                       // overdue
        invoice({ dueAt: T0 + DUE_SOON_MS - 1000 }),         // due soon
        invoice({ dueAt: T0 + DUE_SOON_MS + 1000 }),         // far future
        invoice({ dueAt: T0 - 1000, status: 'paid' }),       // paid
        invoice({}),                                          // no due date
      ],
      lastSeenAt: T0 + 999_999_999, now: T0,
    })
    expect(out.dueInvoices).toHaveLength(2)
  })
})

describe('last-seen storage', () => {
  const storage = {
    data: {} as Record<string, string>,
    get length() { return Object.keys(this.data).length },
    key(i: number) { return Object.keys(this.data)[i] ?? null },
    getItem(k: string) { return this.data[k] ?? null },
    setItem(k: string, v: string) { this.data[k] = v },
    removeItem(k: string) { delete this.data[k] },
  }

  beforeEach(() => {
    storage.data = {}
    vi.stubGlobal('localStorage', storage)
  })

  it('returns null when unset, round-trips a value, and is scoped per address set', () => {
    const a = ['NQ07 0000 0000']
    const b = ['NQ26 8MMT 8317']
    expect(getLastSeen(a)).toBeNull()
    setLastSeen(a, 12345)
    expect(getLastSeen(a)).toBe(12345)
    expect(getLastSeen(b)).toBeNull()
  })

  it('address order and whitespace do not change the key', () => {
    setLastSeen(['NQ07 0000', 'NQ26 8MMT'], 777)
    expect(getLastSeen(['nq268mmt'.toUpperCase(), 'NQ070000'])).toBe(777)
  })
})
