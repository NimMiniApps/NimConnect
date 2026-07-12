import { expandMyAddresses, fetchTransactionsByAddress, timestampMs } from './history'
import type { Profile } from '../types/profile'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
const CACHE_PREFIX = 'nimconnect:insights-txs:'
const PAGE_MAX = 200

export interface InsightTx {
  hash: string
  /** normalized ms */
  timestamp: number
  valueNim: number
  incoming: boolean
  /** compact uppercase address of the other side */
  counterparty: string
}

export interface InsightsData {
  txs: InsightTx[]
  /** ms before which history may be incomplete (a page hit the 200-tx cap); null = full coverage */
  coverageFrom: number | null
  fetchedAt: number
}

interface RpcLike {
  hash: string
  from: string
  to: string
  value: number
  timestamp: number
  fromType?: number
}

/** Dedupe, drop self-transfers and swap-contract payouts, normalize direction/timestamps.
 * `pages` (per-address result pages) determines the coverage boundary; defaults to one page. */
export function normalizeTxs(
  raw: RpcLike[],
  mine: Set<string>,
  pages: RpcLike[][] = [raw],
): { txs: InsightTx[]; coverageFrom: number | null } {
  let coverageFrom: number | null = null
  for (const page of pages) {
    if (page.length >= PAGE_MAX) {
      const oldest = Math.min(...page.map(t => timestampMs(t.timestamp)))
      coverageFrom = Math.max(coverageFrom ?? 0, oldest)
    }
  }
  const txs: InsightTx[] = []
  for (const tx of new Map(raw.map(t => [t.hash, t])).values()) {
    const from = compact(tx.from)
    const to = compact(tx.to)
    const incoming = mine.has(to) && !mine.has(from)
    const outgoing = mine.has(from) && !mine.has(to)
    if (!incoming && !outgoing) continue // self-transfer or unrelated
    // ponytail: swap payouts report balance snapshots, not amounts — exclude rather than model
    if (incoming && tx.fromType === 2) continue
    txs.push({
      hash: tx.hash,
      timestamp: timestampMs(tx.timestamp),
      valueNim: tx.value / 1e5,
      incoming,
      counterparty: incoming ? from : to,
    })
  }
  return { txs, coverageFrom }
}

/** Both-direction history for all own addresses, cached per wallet identity for offline use. */
export async function fetchInsights(myAddresses: string[]): Promise<InsightsData> {
  const mine = await expandMyAddresses(myAddresses)
  const mineSet = new Set(mine.map(compact))
  const key = CACHE_PREFIX + [...mineSet].sort().join('+')
  try {
    const pages = await Promise.all(mine.map(a => fetchTransactionsByAddress(a, PAGE_MAX)))
    const { txs, coverageFrom } = normalizeTxs(pages.flat(), mineSet, pages)
    const data: InsightsData = { txs, coverageFrom, fetchedAt: Date.now() }
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(data))
    } catch { /* best-effort */ }
    return data
  } catch (e) {
    const raw = globalThis.localStorage?.getItem(key)
    if (raw) return JSON.parse(raw) as InsightsData
    throw e
  }
}

export interface ContactTotal {
  /** null = unmatched addresses lumped together ("Others") */
  name: string | null
  profileId: string | null
  sentNim: number
  receivedNim: number
}

export interface MonthInsights {
  sentNim: number
  receivedNim: number
  /** sorted by volume desc; the unmatched "Others" row (name null) sorts last */
  contacts: ContactTotal[]
  /** overlapping by design: multi-tagged contacts count under each tag */
  tags: { tag: string; sentNim: number; receivedNim: number }[]
}

export function monthInsights(txs: InsightTx[], profiles: Profile[], year: number, month: number): MonthInsights {
  const start = new Date(year, month, 1).getTime()
  const end = new Date(year, month + 1, 1).getTime()
  const byAddress = new Map(profiles.map(p => [compact(p.address), p]))

  let sentNim = 0
  let receivedNim = 0
  const perContact = new Map<string, ContactTotal>() // key: profile id or '' for Others
  const perTag = new Map<string, { tag: string; sentNim: number; receivedNim: number }>()

  for (const tx of txs) {
    if (tx.timestamp < start || tx.timestamp >= end) continue
    if (tx.incoming) receivedNim += tx.valueNim
    else sentNim += tx.valueNim

    const profile = byAddress.get(tx.counterparty)
    const key = profile?.id ?? ''
    const entry = perContact.get(key)
      ?? { name: profile?.name ?? null, profileId: profile?.id ?? null, sentNim: 0, receivedNim: 0 }
    if (tx.incoming) entry.receivedNim += tx.valueNim
    else entry.sentNim += tx.valueNim
    perContact.set(key, entry)

    const tags = profile ? (profile.tags.length ? profile.tags : ['Untagged']) : []
    for (const tag of tags) {
      const t = perTag.get(tag) ?? { tag, sentNim: 0, receivedNim: 0 }
      if (tx.incoming) t.receivedNim += tx.valueNim
      else t.sentNim += tx.valueNim
      perTag.set(tag, t)
    }
  }

  const volume = (c: ContactTotal) => c.sentNim + c.receivedNim
  const contacts = [...perContact.values()].sort((a, b) => {
    if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1
    return volume(b) - volume(a)
  })
  const tags = [...perTag.values()].sort((a, b) => (b.sentNim + b.receivedNim) - (a.sentNim + a.receivedNim))

  return { sentNim, receivedNim, contacts, tags }
}
