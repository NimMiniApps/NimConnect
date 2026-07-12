import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '../db/db'
import type { Bucket, BucketContribution } from '../types/profile'
import { uuid } from '../utils/uuid'
import { notifyDataChanged } from '../services/cloud-backup'
import { timestampMs, type IncomingPayment } from '../services/history'

/** Wallet tx message limit — keep in sync with MESSAGE_MAX_BYTES in services/nimiq. */
const MESSAGE_MAX_BYTES = 64
const byteLength = (s: string) => new TextEncoder().encode(s).length

/** Stable short tag embedded in payment messages: '#' + first 8 chars of the uuid. */
export function bucketTag(bucket: Pick<Bucket, 'id'>): string {
  return `#${bucket.id.replace(/-/g, '').slice(0, 8)}`
}

/** Payment message for share link/QR: "🪣 <name> <tag>", name trimmed to the 64-byte limit. */
export function bucketMessage(bucket: Pick<Bucket, 'id' | 'name'>): string {
  const tag = bucketTag(bucket)
  let name = bucket.name.trim()
  while (name && byteLength(`🪣 ${name} ${tag}`) > MESSAGE_MAX_BYTES) {
    name = name.slice(0, -1).trimEnd()
  }
  return name ? `🪣 ${name} ${tag}` : `🪣 ${tag}`
}

/** Incoming payments carrying the bucket tag that aren't in the ledger yet. */
export function matchContributions(bucket: Bucket, payments: IncomingPayment[]): IncomingPayment[] {
  const tag = bucketTag(bucket)
  const known = new Set(bucket.contributions.map(c => c.txHash).filter(Boolean))
  const seen = new Set<string>()
  return payments.filter((p) => {
    if (!p.message?.includes(tag) || known.has(p.hash) || seen.has(p.hash)) return false
    seen.add(p.hash)
    return true
  })
}

export function bucketTotalNim(bucket: Bucket): number {
  return bucket.contributions.reduce((sum, c) => sum + c.amountNim, 0)
}

export const useBucketsStore = defineStore('buckets', () => {
  const buckets = ref<Bucket[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    buckets.value = await db.buckets.toArray()
    loaded.value = true
  }

  async function reload() {
    buckets.value = await db.buckets.toArray()
    loaded.value = true
  }

  const active = computed(() =>
    buckets.value.filter(b => b.status === 'active').sort((a, b) => b.createdAt - a.createdAt),
  )
  const completed = computed(() =>
    buckets.value
      .filter(b => b.status === 'completed')
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)),
  )

  async function persist(updated: Bucket) {
    await db.buckets.put(JSON.parse(JSON.stringify(updated)))
    buckets.value = buckets.value.map(b => (b.id === updated.id ? updated : b))
    notifyDataChanged()
  }

  async function create(input: {
    name: string
    goalNim: number
    fiatGoal?: number
    fiatCurrency?: string
  }): Promise<Bucket> {
    if (!(input.goalNim > 0)) throw new Error('invalid-goal')
    const name = input.name.trim()
    if (!name) throw new Error('invalid-name')
    const bucket: Bucket = {
      id: uuid(),
      name,
      goalNim: input.goalNim,
      status: 'active',
      createdAt: Date.now(),
      contributions: [],
      ...(input.fiatGoal && input.fiatCurrency
        ? { fiatGoal: input.fiatGoal, fiatCurrency: input.fiatCurrency }
        : {}),
    }
    await db.buckets.add(bucket)
    buckets.value.push(bucket)
    notifyDataChanged()
    return bucket
  }

  async function setStatus(id: string, status: Bucket['status']) {
    const existing = buckets.value.find(b => b.id === id)
    if (!existing) return
    await persist({
      ...existing,
      status,
      ...(status === 'completed' ? { completedAt: Date.now() } : { completedAt: undefined }),
    })
  }

  async function update(
    id: string,
    input: { name?: string; goalNim?: number; fiatGoal?: number; fiatCurrency?: string },
  ) {
    const existing = buckets.value.find(b => b.id === id)
    if (!existing) return
    const goalNim = input.goalNim ?? existing.goalNim
    if (!(goalNim > 0)) throw new Error('invalid-goal')
    const name = input.name != null ? input.name.trim() : existing.name
    if (!name) throw new Error('invalid-name')
    await persist({
      ...existing,
      name,
      goalNim,
      ...(input.fiatGoal && input.fiatCurrency
        ? { fiatGoal: input.fiatGoal, fiatCurrency: input.fiatCurrency }
        : { fiatGoal: undefined, fiatCurrency: undefined }),
    })
  }

  async function remove(id: string) {
    await db.buckets.delete(id)
    buckets.value = buckets.value.filter(b => b.id !== id)
    notifyDataChanged()
  }

  async function addManualContribution(
    id: string,
    input: { amountNim: number; note?: string; sender?: string },
  ) {
    if (!(input.amountNim > 0)) throw new Error('invalid-amount')
    const bucket = buckets.value.find(b => b.id === id)
    if (!bucket) return
    const contribution: BucketContribution = {
      id: uuid(),
      source: 'manual',
      amountNim: input.amountNim,
      at: Date.now(),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(input.sender ? { sender: input.sender } : {}),
    }
    await persist({ ...bucket, contributions: [...bucket.contributions, contribution] })
  }

  /** Append newly seen tagged payments to each active bucket's ledger. Returns count added. */
  async function recordChainContributions(payments: IncomingPayment[]): Promise<number> {
    let added = 0
    for (const bucket of buckets.value.filter(b => b.status === 'active')) {
      const matches = matchContributions(bucket, payments)
      if (!matches.length) continue
      const entries: BucketContribution[] = matches.map(p => ({
        id: uuid(),
        source: 'chain',
        amountNim: p.valueNim,
        sender: p.sender,
        txHash: p.hash,
        at: timestampMs(p.timestamp),
      }))
      await persist({ ...bucket, contributions: [...bucket.contributions, ...entries] })
      added += entries.length
    }
    return added
  }

  /** Merge imported buckets, skipping ids already present. Returns count added. */
  async function importMany(items: Bucket[]): Promise<number> {
    let added = 0
    for (const raw of items) {
      if (!raw || typeof raw !== 'object' || !raw.id || !String(raw.name ?? '').trim() || !(raw.goalNim > 0)) continue
      if (buckets.value.some(b => b.id === raw.id)) continue
      const bucket: Bucket = {
        id: String(raw.id),
        name: String(raw.name).trim(),
        goalNim: Number(raw.goalNim),
        status: raw.status === 'completed' ? 'completed' : 'active',
        createdAt: Number(raw.createdAt) || Date.now(),
        contributions: Array.isArray(raw.contributions)
          ? raw.contributions
              .filter(c => c && c.amountNim > 0)
              .map(c => ({
                id: String(c.id ?? uuid()),
                source: c.source === 'chain' ? 'chain' as const : 'manual' as const,
                amountNim: Number(c.amountNim),
                at: Number(c.at) || Date.now(),
                ...(c.sender ? { sender: String(c.sender) } : {}),
                ...(c.txHash ? { txHash: String(c.txHash) } : {}),
                ...(c.note ? { note: String(c.note) } : {}),
              }))
          : [],
        ...(raw.completedAt ? { completedAt: Number(raw.completedAt) } : {}),
        ...(raw.fiatGoal && raw.fiatCurrency
          ? { fiatGoal: Number(raw.fiatGoal), fiatCurrency: String(raw.fiatCurrency) }
          : {}),
      }
      await db.buckets.add(bucket)
      buckets.value.push(bucket)
      added++
    }
    if (added) notifyDataChanged()
    return added
  }

  return {
    buckets, loaded, active, completed,
    load, reload, create, update, setStatus, remove,
    addManualContribution, recordChainContributions, importMany,
  }
})
