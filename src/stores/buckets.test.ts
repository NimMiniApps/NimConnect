import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import {
  useBucketsStore, bucketTag, bucketMessage, matchContributions, bucketTotalNim,
} from './buckets'
import type { Bucket } from '../types/profile'
import type { IncomingPayment } from '../services/history'

const SENDER = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

function payment(overrides: Partial<IncomingPayment> = {}): IncomingPayment {
  return {
    hash: `hash-${Math.random()}`,
    timestamp: Math.floor(Date.now() / 1000),
    valueNim: 10,
    sender: SENDER,
    ...overrides,
  }
}

describe('bucket tag and message', () => {
  const bucket = { id: 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff', name: 'Barcelona 2026' }

  it('derives a stable short tag from the id', () => {
    expect(bucketTag(bucket)).toBe('#a1b2c3d4')
  })

  it('builds the payment message with emoji, name and tag', () => {
    expect(bucketMessage(bucket)).toBe('🪣 Barcelona 2026 #a1b2c3d4')
  })

  it('trims long names so the message fits the 64-byte tx limit', () => {
    const long = { ...bucket, name: 'A very long trip name that would overflow the transaction message limit' }
    const msg = bucketMessage(long)
    expect(new TextEncoder().encode(msg).length).toBeLessThanOrEqual(64)
    expect(msg.endsWith('#a1b2c3d4')).toBe(true)
    expect(msg.startsWith('🪣 A very long')).toBe(true)
  })
})

describe('matchContributions', () => {
  const bucket: Bucket = {
    id: 'a1b2c3d4-e5f6-4711-8899-aabbccddeeff',
    name: 'Barcelona',
    goalNim: 100,
    status: 'active',
    createdAt: Date.now(),
    contributions: [],
  }

  it('matches payments whose message contains the tag', () => {
    const hit = payment({ message: '🪣 Barcelona #a1b2c3d4' })
    const miss = payment({ message: 'lunch money' })
    const noMsg = payment()
    expect(matchContributions(bucket, [hit, miss, noMsg])).toEqual([hit])
  })

  it('skips tx hashes already in the ledger and duplicate hashes in one batch', () => {
    const recorded = payment({ hash: 'known', message: '🪣 x #a1b2c3d4' })
    const fresh = payment({ hash: 'fresh', message: '🪣 x #a1b2c3d4' })
    const withLedger: Bucket = {
      ...bucket,
      contributions: [{ id: 'c1', source: 'chain', amountNim: 5, txHash: 'known', at: 1 }],
    }
    expect(matchContributions(withLedger, [recorded, fresh, fresh])).toEqual([fresh])
  })
})

describe('buckets store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.buckets.clear()
  })

  it('creates active buckets and rejects invalid input', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: ' Barcelona ', goalNim: 100 })
    expect(b.name).toBe('Barcelona')
    expect(b.status).toBe('active')
    expect(b.contributions).toEqual([])
    expect(store.active).toHaveLength(1)
    await expect(store.create({ name: 'x', goalNim: 0 })).rejects.toThrow('invalid-goal')
    await expect(store.create({ name: '  ', goalNim: 1 })).rejects.toThrow('invalid-name')
  })

  it('marks complete with completedAt and back to active without it', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: 'Trip', goalNim: 10 })
    await store.setStatus(b.id, 'completed')
    expect(store.completed[0].completedAt).toBeGreaterThan(0)
    await store.setStatus(b.id, 'active')
    expect(store.active[0].completedAt).toBeUndefined()
  })

  it('updates name and goal', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: 'Trip', goalNim: 100, fiatGoal: 50, fiatCurrency: 'EUR' })
    await store.update(b.id, { name: ' Barcelona ', goalNim: 250 })
    const updated = store.buckets.find(x => x.id === b.id)!
    expect(updated.name).toBe('Barcelona')
    expect(updated.goalNim).toBe(250)
    expect(updated.fiatGoal).toBeUndefined()
    await expect(store.update(b.id, { goalNim: 0 })).rejects.toThrow('invalid-goal')
    await expect(store.update(b.id, { name: '  ' })).rejects.toThrow('invalid-name')
  })

  it('adds manual contributions and sums the total', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: 'Trip', goalNim: 100 })
    await store.addManualContribution(b.id, { amountNim: 25, note: 'Cash from Ana' })
    await store.addManualContribution(b.id, { amountNim: 10 })
    const updated = store.buckets.find(x => x.id === b.id)!
    expect(updated.contributions).toHaveLength(2)
    expect(updated.contributions[0].source).toBe('manual')
    expect(bucketTotalNim(updated)).toBe(35)
    await expect(store.addManualContribution(b.id, { amountNim: -1 })).rejects.toThrow('invalid-amount')
  })

  it('records tagged chain payments once, only for active buckets', async () => {
    const store = useBucketsStore()
    await store.load()
    const b = await store.create({ name: 'Trip', goalNim: 100 })
    const tag = bucketTag(b)
    const p = payment({ hash: 'tx1', message: `🪣 Trip ${tag}`, valueNim: 40 })
    expect(await store.recordChainContributions([p])).toBe(1)
    expect(await store.recordChainContributions([p])).toBe(0) // idempotent
    const updated = store.buckets.find(x => x.id === b.id)!
    expect(updated.contributions).toEqual([expect.objectContaining({
      source: 'chain', amountNim: 40, txHash: 'tx1', sender: SENDER,
    })])
    await store.setStatus(b.id, 'completed')
    const p2 = payment({ hash: 'tx2', message: `🪣 Trip ${tag}` })
    expect(await store.recordChainContributions([p2])).toBe(0)
  })

  it('imports buckets, skipping duplicates and invalid entries', async () => {
    const store = useBucketsStore()
    await store.load()
    const existing = await store.create({ name: 'Trip', goalNim: 10 })
    const items = [
      existing, // duplicate id — skipped
      { id: 'new-1', name: 'Rome', goalNim: 50, status: 'active', createdAt: 1, contributions: [] },
      { id: 'bad-1', name: 'Broken', goalNim: 0, status: 'active', createdAt: 1, contributions: [] },
    ] as Bucket[]
    expect(await store.importMany(items)).toBe(1)
    expect(store.buckets).toHaveLength(2)
  })
})
