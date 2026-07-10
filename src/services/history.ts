import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { incomingAddress } from './prefs'

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
  /** Sender is an HTLC contract — a cross-asset swap payout, not the contact's wallet */
  viaSwap?: boolean
}

interface RpcTx {
  hash: string
  blockNumber?: number
  validityStartHeight?: number
  from: string
  /** Sender account type: 0 basic wallet, 1 vesting, 2 HTLC (swap) contract */
  fromType?: number
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
export function timestampMs(timestamp: unknown): number {
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

export async function fetchTransactionsByAddress(address: string, max = 200): Promise<RpcTx[]> {
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

/** Include manual incoming + auto-discovered Nimiq Pay paired account when only one address is known. */
export async function expandMyAddresses(addresses: string[]): Promise<string[]> {
  const set = new Set(addresses.filter(Boolean))
  const manual = incomingAddress.value.trim()
  if (manual && ValidationUtils.isValidAddress(manual)) {
    set.add(ValidationUtils.normalizeAddress(manual))
  }
  if (set.size < 2) {
    try {
      for (const addr of await discoverPairedAddresses([...set])) set.add(addr)
    } catch { /* discovery is best-effort */ }
  }
  return [...set]
}

/** Pair history between the contact and any of my addresses — Nimiq Pay splits the wallet into separate incoming/outgoing accounts. */
export async function fetchHistory(myAddress: string | string[], otherAddress: string): Promise<HistoryItem[]> {
  const myList = await expandMyAddresses(Array.isArray(myAddress) ? myAddress : [myAddress])
  const mine = new Set(myList.map(compact))
  const other = compact(otherAddress)
  const key = cacheKey([...mine].sort().join('+'), otherAddress)
  try {
    const pages = await Promise.all(
      [otherAddress, ...myList].map(a => fetchTransactionsByAddress(a)),
    )
    const txs = [...new Map(pages.flat().map(tx => [tx.hash, tx])).values()]
    const items = txs
      .filter(t => {
        const from = compact(t.from)
        const to = compact(t.to)
        return (mine.has(from) && to === other) || (from === other && mine.has(to))
      })
      .map(t => ({
        hash: t.hash,
        blockNumber: t.blockNumber ?? t.validityStartHeight,
        timestamp: t.timestamp,
        valueNim: t.value / 1e5,
        incoming: mine.has(compact(t.to)),
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

/** Max value (lunas) for Nimiq Pay internal incoming↔outgoing sweeps — not contact payments. */
const INTERNAL_SWEEP_MAX_LUNAS = 10_000 // 0.1 NIM

/**
 * Nimiq Pay keeps a separate incoming account. When listAccounts() only returns
 * the outgoing one, find the paired address from small internal settlement transfers.
 */
export async function discoverPairedAddresses(known: string[]): Promise<string[]> {
  if (!known.length) return []
  const knownSet = new Set(known.map(compact))
  const candidates = new Set<string>()

  for (const addr of known) {
    const txs = await fetchTransactionsByAddress(addr, 80)
    for (const tx of txs) {
      const from = compact(tx.from)
      const to = compact(tx.to)
      // Outgoing account sweeps small amounts to the incoming account — not contact payments
      if (knownSet.has(from) && !knownSet.has(to) && tx.value <= INTERNAL_SWEEP_MAX_LUNAS) {
        candidates.add(tx.to)
      }
    }
  }

  const paired: string[] = []
  for (const candidate of candidates) {
    const txs = await fetchTransactionsByAddress(candidate, 40)
    const internalSweep = txs.some(tx => {
      const from = compact(tx.from)
      const to = compact(tx.to)
      return knownSet.has(from) && to === compact(candidate) && tx.value <= INTERNAL_SWEEP_MAX_LUNAS
    })
    if (!internalSweep) continue
    paired.push(ValidationUtils.isValidAddress(candidate)
      ? ValidationUtils.normalizeAddress(candidate)
      : candidate)
  }
  return paired
}

/** HTLC settlements above this NIM amount are wallet balance snapshots, not incremental top-ups. */
const SWAP_SNAPSHOT_MIN_NIM = 1

/**
 * Nimiq Pay swap settlements report the post-settlement wallet balance in `value`,
 * not how much was added. Convert large snapshots to deltas; drop the opening one.
 */
export function normalizeSwapAmounts(items: IncomingPayment[]): IncomingPayment[] {
  const swaps = items
    .filter(i => i.viaSwap)
    .sort((a, b) => {
      const blockDiff = blockValue(a) - blockValue(b)
      if (blockDiff !== 0) return blockDiff
      return timestampMs(a.timestamp) - timestampMs(b.timestamp)
    })

  let prevSwapPeak = 0
  const amountByHash = new Map<string, number>()

  for (const s of swaps) {
    let amount = s.valueNim
    if (amount > SWAP_SNAPSHOT_MIN_NIM) {
      amount = prevSwapPeak === 0 ? 0 : Math.max(0, s.valueNim - prevSwapPeak)
      if (s.valueNim > prevSwapPeak) prevSwapPeak = s.valueNim
    }
    amountByHash.set(s.hash, amount)
  }

  return items
    .map(i => (amountByHash.has(i.hash) ? { ...i, valueNim: amountByHash.get(i.hash)! } : i))
    .filter(i => i.valueNim > 1e-9)
}

/** All addresses belong to the same user — payments between them are self-transfers, not incoming. */
export async function fetchIncomingPayments(myAddresses: string[]): Promise<IncomingPayment[]> {
  const myList = await expandMyAddresses(myAddresses)
  const mine = new Set(myList.map(compact))
  const key = incomingCacheKey([...mine].sort().join('+'))
  try {
    const pages = await Promise.all(myList.map(a => fetchTransactionsByAddress(a, 100)))
    const txs = [...new Map(pages.flat().map(tx => [tx.hash, tx])).values()]
    const items = txs
      // Basic wallets and HTLC (swap) senders; vesting payouts stay hidden — they're the user's own funds
      .filter(t => mine.has(compact(t.to)) && !mine.has(compact(t.from)) && [0, 2].includes(t.fromType ?? 0))
      .map(t => ({
        hash: t.hash,
        blockNumber: t.blockNumber ?? t.validityStartHeight,
        timestamp: t.timestamp,
        valueNim: t.value / 1e5,
        sender: t.from,
        ...(decodeMessage(t.recipientData) ? { message: decodeMessage(t.recipientData) } : {}),
        ...(t.fromType === 2 ? { viaSwap: true } : {}),
      }))
    const sorted = newestFirst(normalizeSwapAmounts(items))
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
