// ponytail: public community RPC; swap RPC_URL if the provider RPC or an
// official endpoint becomes available in the mini-app SDK.
const RPC_URL = 'https://rpc.nimiqwatch.com'

export interface HistoryItem {
  hash: string
  timestamp: number
  valueNim: number
  incoming: boolean
}

interface RpcTx { hash: string; from: string; to: string; value: number; timestamp: number }

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

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
        params: [otherAddress, 200],
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
