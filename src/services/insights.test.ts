import { describe, it, expect } from 'vitest'
import { normalizeTxs, monthInsights, type InsightTx } from './insights'
import type { Profile } from '../types/profile'

const ME = 'NQ070000000000000000000000000000000000'
const ME2 = 'NQ990000000000000000000000000000000000'
const ALICE = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
const BOB = 'NQ48 8CKH BA24 2VR3 N249 N8MN J5XX 74DB 5XJ8'
const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

const JULY = new Date(2026, 6, 15).getTime()

function rpcTx(overrides: Record<string, unknown>) {
  return { hash: Math.random().toString(36), from: ALICE, to: ME, value: 1e5, timestamp: JULY, fromType: 0, ...overrides }
}

function profile(overrides: Partial<Profile>): Profile {
  return {
    id: Math.random().toString(36), address: ALICE, name: 'Alice', type: 'person',
    isSelf: false, notes: '', tags: [], favorite: false, createdAt: 0, updatedAt: 0,
    ...overrides,
  }
}

describe('normalizeTxs', () => {
  const mine = new Set([compact(ME), compact(ME2)])

  it('dedupes by hash, excludes self-transfers and swap contracts, sets direction and counterparty', () => {
    const dup = rpcTx({})
    const { txs } = normalizeTxs([
      dup, dup,
      rpcTx({ from: ME, to: ME2 }),            // self-transfer
      rpcTx({ fromType: 2 }),                  // swap payout
      rpcTx({ from: ME, to: BOB, value: 3e5 }) // outgoing
    ], mine)
    expect(txs).toHaveLength(2)
    const incoming = txs.find(t => t.incoming)!
    expect(incoming.counterparty).toBe(compact(ALICE))
    const outgoing = txs.find(t => !t.incoming)!
    expect(outgoing.counterparty).toBe(compact(BOB))
    expect(outgoing.valueNim).toBe(3)
  })

  it('normalizes seconds timestamps to ms', () => {
    const { txs } = normalizeTxs([rpcTx({ timestamp: Math.floor(JULY / 1000) })], mine)
    expect(txs[0].timestamp).toBe(Math.floor(JULY / 1000) * 1000)
  })

  it('reports a coverage boundary only when a 200-tx page is full', () => {
    const few = normalizeTxs([rpcTx({})], mine, [[rpcTx({})]])
    expect(few.coverageFrom).toBeNull()
    const fullPage = Array.from({ length: 200 }, (_, i) => rpcTx({ timestamp: JULY - i * 1000 }))
    const capped = normalizeTxs(fullPage, mine, [fullPage])
    expect(capped.coverageFrom).toBe(JULY - 199_000)
  })
})

describe('monthInsights', () => {
  const tx = (over: Partial<InsightTx>): InsightTx => ({
    hash: Math.random().toString(36), timestamp: JULY, valueNim: 1, incoming: true,
    counterparty: compact(ALICE), ...over,
  })

  it('sums sent/received inside the month only', () => {
    const out = monthInsights([
      tx({ valueNim: 5 }),
      tx({ valueNim: 2, incoming: false }),
      tx({ valueNim: 100, timestamp: new Date(2026, 5, 30).getTime() }), // June
      tx({ valueNim: 100, timestamp: new Date(2026, 7, 1).getTime() }),  // August
    ], [], 2026, 6)
    expect(out.receivedNim).toBe(5)
    expect(out.sentNim).toBe(2)
  })

  it('groups by matched contact, lumps unmatched into an Others row (name null)', () => {
    const alice = profile({ address: ALICE, name: 'Alice' })
    const out = monthInsights([
      tx({ valueNim: 5 }),
      tx({ valueNim: 3, counterparty: compact(BOB) }),
    ], [alice], 2026, 6)
    expect(out.contacts).toHaveLength(2)
    expect(out.contacts[0]).toMatchObject({ name: 'Alice', receivedNim: 5 })
    expect(out.contacts[1]).toMatchObject({ name: null, receivedNim: 3 })
  })

  it('counts a multi-tagged contact fully under each tag; untagged under Untagged', () => {
    const alice = profile({ address: ALICE, name: 'Alice', tags: ['friends', 'work'] })
    const bob = profile({ address: BOB, name: 'Bob', tags: [] })
    const out = monthInsights([
      tx({ valueNim: 5 }),
      tx({ valueNim: 3, counterparty: compact(BOB), incoming: false }),
    ], [alice, bob], 2026, 6)
    const byTag = Object.fromEntries(out.tags.map(t => [t.tag, t]))
    expect(byTag.friends.receivedNim).toBe(5)
    expect(byTag.work.receivedNim).toBe(5)
    expect(byTag.Untagged.sentNim).toBe(3)
  })
})
