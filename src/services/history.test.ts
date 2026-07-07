import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchHistory } from './history'

const ME = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const OTHER = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
const THIRD = 'NQ57 M1KM 4PMM 0SL5 T2TF 2A1Q 3P8E EU4Y JMSN'

function rpcResult(txs: unknown[]) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: { data: txs } }) }
}

function tx(from: string, to: string, value: number, timestamp: number, hash = 'h') {
  return { hash, from, to, value, timestamp }
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

  it('throws when the network fails and no cache exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchHistory(ME, OTHER)).rejects.toThrow()
  })
})
