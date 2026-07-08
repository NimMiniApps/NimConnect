import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchHistory, fetchIncomingPayments, clearHistoryCache } from './history'

const ME = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const OTHER = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
const THIRD = 'NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN'

function rpcResult(txs: unknown[]) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: { data: txs } }) }
}

function tx(from: string, to: string, value: number, timestamp: number, hash = 'h', blockNumber?: number) {
  return { hash, from, to, value, timestamp, ...(blockNumber ? { blockNumber } : {}) }
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchHistory', () => {
  it('filters to txs between the two addresses and maps direction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      tx(ME, OTHER, 100000, 2000, 'a'),
      tx(OTHER, ME, 50000, 3000, 'b'),
      tx(THIRD, OTHER, 700, 4000, 'c'),
    ])))
    const items = await fetchHistory(ME, OTHER)
    expect(items).toEqual([
      { hash: 'b', timestamp: 3000, valueNim: 0.5, incoming: true },
      { hash: 'a', timestamp: 2000, valueNim: 1, incoming: false },
    ])
  })

  it('orders pair history by newest block before timestamp fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      tx(OTHER, ME, 100000, 3000, 'older-block', 10),
      tx(OTHER, ME, 100000, 1000, 'newer-block', 12),
    ])))

    const items = await fetchHistory(ME, OTHER)

    expect(items.map(i => i.hash)).toEqual(['newer-block', 'older-block'])
  })

  it('finds pair history from my address when the contact page does not include the shared tx', async () => {
    const contactPage = rpcResult([
      tx(THIRD, OTHER, 700, 4000, 'unrelated'),
    ])
    const myPage = rpcResult([
      tx(ME, OTHER, 100000, 2000, 'mine'),
    ])
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(contactPage)
      .mockResolvedValueOnce(myPage))

    const items = await fetchHistory(ME, OTHER)

    expect(items).toEqual([
      { hash: 'mine', timestamp: 2000, valueNim: 1, incoming: false },
    ])
  })

  it('decodes printable UTF-8 recipientData as a message, ignores binary', async () => {
    const hex = (s: string) =>
      Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      { ...tx(ME, OTHER, 100000, 2000, 'a'), recipientData: hex('Thanks for lunch! 🍜') },
      { ...tx(OTHER, ME, 50000, 3000, 'b'), recipientData: '00ff01' },
    ])))
    const items = await fetchHistory(ME, OTHER)
    expect(items[1].message).toBe('Thanks for lunch! 🍜')
    expect(items[0].message).toBeUndefined()
  })

  it('does not display structured Nimiq payloads as human messages', async () => {
    const hex = (s: string) =>
      Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      { ...tx(OTHER, ME, 50000, 3000, 'b'), recipientData: hex('NB2:JIyOyD20PITUY9MeGm9LHzDAqIVqIKUZqgk') },
    ])))

    const items = await fetchHistory(ME, OTHER)

    expect(items[0].message).toBeUndefined()
  })

  it('throws when the network fails and no cache exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchHistory(ME, OTHER)).rejects.toThrow()
  })

  it('returns cached pair history newest first', async () => {
    const storage = {
      data: {} as Record<string, string>,
      get length() { return Object.keys(this.data).length },
      key(i: number) { return Object.keys(this.data)[i] ?? null },
      getItem(k: string) { return this.data[k] ?? null },
      setItem(k: string, v: string) { this.data[k] = v },
      removeItem(k: string) { delete this.data[k] },
    }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    storage.setItem(`nimconnect:history:${ME.replace(/\s+/g, '')}:${OTHER.replace(/\s+/g, '')}`, JSON.stringify([
      { hash: 'old', timestamp: 1000, valueNim: 1, incoming: false },
      { hash: 'new', timestamp: 3000, valueNim: 2, incoming: true },
    ]))

    const items = await fetchHistory(ME, OTHER)

    expect(items.map(i => i.hash)).toEqual(['new', 'old'])
  })

  it('clearHistoryCache removes nimconnect localStorage keys', () => {
    const storage = {
      data: {} as Record<string, string>,
      get length() { return Object.keys(this.data).length },
      key(i: number) { return Object.keys(this.data)[i] ?? null },
      getItem(k: string) { return this.data[k] ?? null },
      setItem(k: string, v: string) { this.data[k] = v },
      removeItem(k: string) { delete this.data[k] },
    }
    vi.stubGlobal('localStorage', storage)
    storage.setItem('nimconnect:history:AB:CD', '[]')
    storage.setItem('other', 'keep')
    clearHistoryCache()
    expect(storage.getItem('nimconnect:history:AB:CD')).toBeNull()
    expect(storage.getItem('other')).toBe('keep')
  })
})

describe('fetchIncomingPayments', () => {
  it('lists incoming payments to my address newest first with sender and message', async () => {
    const hex = (s: string) =>
      Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      tx(ME, OTHER, 100000, 2000, 'outgoing'),
      { ...tx(THIRD, ME, 250000, 4000, 'newer'), recipientData: hex('For coffee') },
      tx(OTHER, ME, 50000, 3000, 'older'),
    ])))

    const items = await fetchIncomingPayments(ME)

    expect(items).toEqual([
      { hash: 'newer', timestamp: 4000, valueNim: 2.5, sender: THIRD, message: 'For coffee' },
      { hash: 'older', timestamp: 3000, valueNim: 0.5, sender: OTHER },
    ])
  })

  it('excludes payments from contracts (HTLC/vesting), keeps basic wallets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      { ...tx(OTHER, ME, 50000, 3000, 'htlc'), fromType: 2 },
      { ...tx(THIRD, ME, 50000, 4000, 'vesting'), fromType: 1 },
      { ...tx(OTHER, ME, 50000, 5000, 'person'), fromType: 0 },
      tx(THIRD, ME, 50000, 6000, 'no-type'),
    ])))

    const items = await fetchIncomingPayments(ME)

    expect(items.map(i => i.hash)).toEqual(['no-type', 'person'])
  })

  it('orders incoming payments by newest block before timestamp fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      tx(OTHER, ME, 100000, 3000, 'older-block', 10),
      tx(THIRD, ME, 100000, 1000, 'newer-block', 12),
    ])))

    const items = await fetchIncomingPayments(ME)

    expect(items.map(i => i.hash)).toEqual(['newer-block', 'older-block'])
  })

  it('sorts ascending API results newest first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rpcResult([
      tx(OTHER, ME, 50000, 3000, 'oldest', 10),
      tx(THIRD, ME, 100000, 4000, 'middle', 11),
      tx(OTHER, ME, 25000, 5000, 'newest', 12),
    ])))

    const items = await fetchIncomingPayments(ME)

    expect(items.map(i => i.hash)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('returns cached incoming payments newest first', async () => {
    const storage = {
      data: {} as Record<string, string>,
      get length() { return Object.keys(this.data).length },
      key(i: number) { return Object.keys(this.data)[i] ?? null },
      getItem(k: string) { return this.data[k] ?? null },
      setItem(k: string, v: string) { this.data[k] = v },
      removeItem(k: string) { delete this.data[k] },
    }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    storage.setItem(`nimconnect:incoming:${ME.replace(/\s+/g, '')}`, JSON.stringify([
      { hash: 'old', timestamp: 1000, valueNim: 1, sender: OTHER },
      { hash: 'new', timestamp: 3000, valueNim: 2, sender: THIRD },
    ]))

    const items = await fetchIncomingPayments(ME)

    expect(items.map(i => i.hash)).toEqual(['new', 'old'])
  })
})
