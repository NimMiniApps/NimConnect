// ponytail: public community RPC; swap RPC_URL if the provider RPC or an
// official endpoint becomes available in the mini-app SDK.
const RPC_URL = 'https://rpc.nimiqwatch.com'

export interface HistoryItem {
  hash: string
  timestamp: number
  valueNim: number
  incoming: boolean
  /** UTF-8 message from the tx data field, when present and printable */
  message?: string
}

interface RpcTx { hash: string; from: string; to: string; value: number; timestamp: number; recipientData?: string }

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

/** Decode tx data hex as a human message; undefined for empty/binary payloads. */
function decodeMessage(hex?: string): string | undefined {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return undefined
  try {
    const bytes = Uint8Array.from(hex.match(/../g)!.map(b => parseInt(b, 16)))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const hasControlChars = [...text].some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
    return hasControlChars || !text.trim() ? undefined : text
  } catch {
    return undefined
  }
}

function cacheKey(me: string, other: string) {
  return `nimconnect:history:${compact(me)}:${compact(other)}`
}

function readCache(key: string): HistoryItem[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return raw ? (JSON.parse(raw) as HistoryItem[]) : null
  } catch {
    return null
  }
}

export async function fetchHistory(myAddress: string, otherAddress: string): Promise<HistoryItem[]> {
  const key = cacheKey(myAddress, otherAddress)
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransactionsByAddress',
        // The node requires all 3 positional params: address, max, start_at
        params: [otherAddress, 200, null],
      }),
    })
    if (!res.ok) throw new Error(`rpc ${res.status}`)
    const body = await res.json()
    const txs: RpcTx[] = body.result?.data ?? body.result ?? []
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
        timestamp: t.timestamp,
        valueNim: t.value / 1e5,
        incoming: compact(t.to) === me,
        ...(decodeMessage(t.recipientData) ? { message: decodeMessage(t.recipientData) } : {}),
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(items))
    } catch { /* cache is best-effort */ }
    return items
  } catch (e) {
    const cached = readCache(key)
    if (cached) return cached
    throw e
  }
}
