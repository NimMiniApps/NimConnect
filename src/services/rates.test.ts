import { describe, it, expect, vi, afterEach } from 'vitest'
import { getRates, fiatToNim } from './rates'

afterEach(() => vi.unstubAllGlobals())

describe('rates', () => {
  it('fetches and normalizes NIM rates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { NIM: { EUR: 0.0004, USD: 0.00045 } }, stale: false }),
    }))
    const rates = await getRates()
    expect(rates?.nim.EUR).toBe(0.0004)
    expect(rates?.stale).toBe(false)
  })

  it('converts fiat to NIM exactly in lunas', () => {
    const rates = { nim: { EUR: 0.0004 }, fetchedAt: Date.now(), stale: false }
    expect(fiatToNim(30, 'EUR', rates)).toBe(75000)
    expect(fiatToNim(30, 'eur', rates)).toBe(75000)
    expect(fiatToNim(30, 'XXX', rates)).toBeNull()
    expect(fiatToNim(0, 'EUR', rates)).toBeNull()
  })
})
