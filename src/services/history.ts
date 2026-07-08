const RPC_URL = 'https://rpc-mainnet.nimiqscan.com/'

export interface HistoryItem {
  hash: string
  blockNumber?: number
  timestamp: number
  valueNim: number
  incoming: boolean
  /** UTF-8 message from the tx data field, when present and printable */
  message?: string
}

export interface IncomingPayment {
  hash: string
  blockNumber?: number
  timestamp: number
  valueNim: number
  sender: string
  /** UTF-8 message from the tx data field, when present and printable */
  message?: string
}

interface RpcTx {
  hash: string
  blockNumber?: number
  validityStartHeight?: number
  from: string
  to: string
  value: number
  timestamp: number
  recipientData?: string
}

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

function blockValue(item: { blockNumber?: number; validityStartHeight?: number }): number {
  const block = Number(item.blockNumber)
  if (Number.isFinite(block) && block > 0) return block
  const height = Number(item.validityStartHeight)
  return Number.isFinite(height) ? height : 0
}

/** Normalize chain timestamps to milliseconds for stable ordering. */
function timestampMs(timestamp: unknown): number {
  if (typeof timestamp === 'string') {
    if (/^\d+$/.test(timestamp)) {
      const n = Number(timestamp)
      return n < 1e12 ? n * 1000 : n
    }
    const parsed = Date.parse(timestamp)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const n = Number(timestamp)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 1e12 ? n * 1000 : n
}

export function newestFirst<T extends { timestamp: number; blockNumber?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const blockDiff = blockValue(b) - blockValue(a)
    if (blockDiff !== 0) return blockDiff
    return timestampMs(b.timestamp) - timestampMs(a.timestamp)
  })
}

/** Decode tx data hex as a human message; undefined for empty/binary payloads. */
function decodeMessage(hex?: string): string | undefined {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return undefined
  try {
    const bytes = Uint8Array.from(hex.match(/../g)!.map(b => parseInt(b, 16)))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const hasControlChars = [...text].some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
    const isStructuredPayload = /^NB[0-9A-Z]*:[A-Za-z0-9_-]+$/u.test(text)
    if (hasControlChars || !text.trim() || isStructuredPayload) return undefined
    return text
  } catch {
    return undefined
  }
}

const CACHE_PREFIX = 'nimconnect:'

function cacheKey(me: string, other: string) {
  return `${CACHE_PREFIX}history:${compact(me)}:${compact(other)}`
}

function incomingCacheKey(me: string) {
  return `${CACHE_PREFIX}incoming:${compact(me)}`
}

/** Remove all NimConnect localStorage entries (e.g. on app reset). */
export function clearHistoryCache() {
  const storage = globalThis.localStorage
  if (!storage) return
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}

function readCache(key: string): HistoryItem[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? newestFirst(JSON.parse(raw) as HistoryItem[]) : null
  } catch {
    return null
  }
}

function readIncomingCache(key: string): IncomingPayment[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? newestFirst(JSON.parse(raw) as IncomingPayment[]) : null
  } catch {
    return null
  }
}

async function fetchTransactionsByAddress(address: string, max = 200): Promise<RpcTx[]> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransactionsByAddress',
      // The node requires all 3 positional params: address, max, start_at
      params: [address, max, null],
    }),
  })
  if (!res.ok) throw new Error(`rpc ${res.status}`)
  const body = await res.json()
  return body.result?.data ?? body.result ?? []
}

export async function fetchHistory(myAddress: string, otherAddress: string): Promise<HistoryItem[]> {
  const key = cacheKey(myAddress, otherAddress)
  try {
    const pages = await Promise.all([
      fetchTransactionsByAddress(otherAddress),
      fetchTransactionsByAddress(myAddress),
    ])
    const txs = [...new Map(pages.flat().map(tx => [tx.hash, tx])).values()]
    const me = compact(myAddress)
    const other = compact(otherAddress)
    const items = txs
      .filter(t => {
        const from = compact(t.from)
        const to = compact(t.to)
        return (from === me && to === other) || (from === other && to === me)
      })
      .map(t => ({
        hash: t.hash,
        blockNumber: t.blockNumber ?? t.validityStartHeight,
        timestamp: t.timestamp,
        valueNim: t.value / 1e5,
        incoming: compact(t.to) === me,
        ...(decodeMessage(t.recipientData) ? { message: decodeMessage(t.recipientData) } : {}),
      }))
    const sorted = newestFirst(items)
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(sorted))
    } catch { /* cache is best-effort */ }
    return sorted
  } catch (e) {
    const cached = readCache(key)
    if (cached) return cached
    throw e
  }
}

export async function fetchIncomingPayments(myAddress: string): Promise<IncomingPayment[]> {
  const key = incomingCacheKey(myAddress)
  try {
    const txs = await fetchTransactionsByAddress(myAddress, 100)
    const me = compact(myAddress)
    const items = txs
      .filter(t => compact(t.to) === me && compact(t.from) !== me)
      .map(t => ({
        hash: t.hash,
        blockNumber: t.blockNumber ?? t.validityStartHeight,
        timestamp: t.timestamp,
        valueNim: t.value / 1e5,
        sender: t.from,
        ...(decodeMessage(t.recipientData) ? { message: decodeMessage(t.recipientData) } : {}),
      }))
    const sorted = newestFirst(items)
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(sorted))
    } catch { /* cache is best-effort */ }
    return sorted
  } catch (e) {
    const cached = readIncomingCache(key)
    if (cached) return cached
    throw e
  }
}
