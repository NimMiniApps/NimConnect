import { apiUrl } from './api'

function ratesUrl(): string {
  return apiUrl('/api/rates')
}

const CACHE_KEY = 'nimconnect:rates'
const FRESH_MS = 5 * 60_000

export const FIAT_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CNY', 'AUD', 'CAD', 'INR', 'BRL'] as const
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]

export interface NimRates {
  /** Fiat price of 1 NIM, keyed by uppercase currency code */
  nim: Record<string, number>
  fetchedAt: number
  stale: boolean
}

let memory: NimRates | null = null

function readCache(): NimRates | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as NimRates) : null
  } catch {
    return null
  }
}

/** Last known rates, fetching when missing or older than 5 minutes. Null when offline with no cache. */
export async function getRates(): Promise<NimRates | null> {
  memory ??= readCache()
  if (memory && Date.now() - memory.fetchedAt < FRESH_MS && !memory.stale) return memory
  try {
    const res = await fetch(ratesUrl())
    if (!res.ok) throw new Error(`rates ${res.status}`)
    const body = await res.json()
    const nim = body?.rates?.NIM
    if (!nim || typeof nim !== 'object') throw new Error('rates shape')
    memory = { nim, fetchedAt: Date.now(), stale: !!body.stale }
    try {
      globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(memory))
    } catch { /* best-effort */ }
    return memory
  } catch {
    return memory // possibly null — callers fall back to NIM-only entry
  }
}

/** Convert a NIM amount to fiat. Null when the currency is unknown. */
export function nimToFiat(nim: number, currency: string, rates: NimRates): number | null {
  const price = rates.nim[currency.toUpperCase()]
  if (!price || !(nim > 0)) return null
  return nim * price
}

/** Convert a fiat amount to NIM, exact in lunas. Null when the currency is unknown. */
export function fiatToNim(amount: number, currency: string, rates: NimRates): number | null {
  const price = rates.nim[currency.toUpperCase()]
  if (!price || !(amount > 0)) return null
  return Math.round((amount / price) * 1e5) / 1e5
}
