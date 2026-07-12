import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '../db/db'
import type { Invoice } from '../types/profile'
import { uuid } from '../utils/uuid'
import { notifyDataChanged } from '../services/cloud-backup'
import { timestampMs, type IncomingPayment } from '../services/history'

const compactAddress = (a: string) => a.replace(/\s+/g, '').toUpperCase()

export function isOverdue(invoice: Invoice, now = Date.now()): boolean {
  return invoice.status === 'pending' && !!invoice.dueAt && invoice.dueAt < now
}

/** One calendar month later, clamped to the target month's last day (Jan 31 → Feb 28/29). */
export function addMonthClamped(ms: number): number {
  const d = new Date(ms)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d.getTime()
}

function nextDueAt(repeat: 'weekly' | 'monthly', from: number): number {
  return repeat === 'weekly' ? from + 7 * 86_400_000 : addMonthClamped(from)
}

/**
 * Suggest pending invoices that look paid: an incoming payment from the invoice
 * address, for at least the invoice amount, sent after the invoice was created.
 * Each payment settles at most one invoice (oldest invoice first).
 *
 * senderAliases maps a compact invoice address to additional compact addresses
 * accepted as its payment sender — Nimiq Pay wallets receive on one account
 * but pay from a paired outgoing account.
 */
export function matchPayments(
  pending: Invoice[],
  payments: IncomingPayment[],
  senderAliases?: Map<string, Set<string>>,
): Map<string, IncomingPayment> {
  const matches = new Map<string, IncomingPayment>()
  const used = new Set<string>()
  for (const invoice of [...pending].sort((a, b) => a.createdAt - b.createdAt)) {
    const address = compactAddress(invoice.address)
    const aliases = senderAliases?.get(address)
    const senderMatches = (sender: string) => {
      const s = compactAddress(sender)
      return s === address || aliases?.has(s) === true
    }
    const hit = payments
      .filter(p => !used.has(p.hash)
        && senderMatches(p.sender)
        && p.valueNim >= invoice.amountNim - 1e-9
        && timestampMs(p.timestamp) >= invoice.createdAt)
      .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0]
    if (hit) {
      matches.set(invoice.id, hit)
      used.add(hit.hash)
    }
  }
  return matches
}

export const useInvoicesStore = defineStore('invoices', () => {
  const invoices = ref<Invoice[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    invoices.value = await db.invoices.toArray()
    loaded.value = true
  }

  async function reload() {
    invoices.value = await db.invoices.toArray()
    loaded.value = true
  }

  function byAddress(address: string): Invoice[] {
    return invoices.value
      .filter(i => i.address === address)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  const pending = computed(() => {
    const now = Date.now()
    const rank = (i: Invoice) => (isOverdue(i, now) ? 0 : 1)
    return invoices.value
      .filter(i => i.status === 'pending')
      .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt)
  })

  const pendingTotalNim = computed(() =>
    pending.value.reduce((sum, invoice) => sum + invoice.amountNim, 0),
  )

  const paid = computed(() =>
    invoices.value
      .filter(i => i.status === 'paid')
      .sort((a, b) => (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt)),
  )

  function pendingByAddress(address: string): Invoice[] {
    return pending.value.filter(i => i.address === address)
  }

  async function create(input: {
    address: string
    amountNim: number
    description: string
    fiatAmount?: number
    fiatCurrency?: string
    dueAt?: number
    repeat?: 'weekly' | 'monthly'
  }): Promise<Invoice> {
    if (!(input.amountNim > 0)) throw new Error('invalid-amount')
    const invoice: Invoice = {
      id: uuid(),
      address: input.address,
      amountNim: input.amountNim,
      description: input.description.trim(),
      status: 'pending',
      createdAt: Date.now(),
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      ...(input.fiatAmount && input.fiatCurrency
        ? { fiatAmount: input.fiatAmount, fiatCurrency: input.fiatCurrency }
        : {}),
      ...(input.repeat ? { repeat: input.repeat } : {}),
    }
    await db.invoices.add(invoice)
    invoices.value.push(invoice)
    notifyDataChanged()
    return invoice
  }

  /** New pending invoice copying an existing one — repeat billing without retyping. */
  async function duplicate(id: string): Promise<Invoice | undefined> {
    const source = invoices.value.find(i => i.id === id)
    if (!source) return
    return create({
      address: source.address,
      amountNim: source.amountNim,
      description: source.description,
      ...(source.fiatAmount && source.fiatCurrency
        ? { fiatAmount: source.fiatAmount, fiatCurrency: source.fiatCurrency }
        : {}),
    })
  }

  async function setStatus(id: string, status: Invoice['status']) {
    const existing = invoices.value.find(i => i.id === id)
    if (!existing) return
    const updated: Invoice = {
      ...existing,
      status,
      ...(status === 'paid' ? { paidAt: Date.now() } : { paidAt: undefined }),
    }
    await db.invoices.put(JSON.parse(JSON.stringify(updated)))
    invoices.value = invoices.value.map(i => (i.id === id ? updated : i))
    notifyDataChanged()
  }

  /** Atomic paid transition: creates the repeat successor exactly once, even under
   * concurrent calls, a crash mid-transition, or a paid → pending → paid round trip. */
  async function markPaid(id: string) {
    const result = await db.transaction('rw', db.invoices, async () => {
      const source = await db.invoices.get(id)
      if (!source || source.status === 'paid') return null
      const updated: Invoice = { ...source, status: 'paid', paidAt: Date.now() }
      let successor: Invoice | null = null
      if (source.repeat && !source.successorInvoiceId) {
        successor = {
          id: uuid(),
          address: source.address,
          amountNim: source.amountNim,
          description: source.description,
          status: 'pending',
          createdAt: Date.now(),
          repeat: source.repeat,
          // Cadence stays anchored to the schedule: advance from the prior due date,
          // not from when it happened to be paid (may create an already-overdue successor)
          dueAt: nextDueAt(source.repeat, source.dueAt ?? updated.paidAt!),
          ...(source.fiatAmount && source.fiatCurrency
            ? { fiatAmount: source.fiatAmount, fiatCurrency: source.fiatCurrency }
            : {}),
        }
        updated.successorInvoiceId = successor.id
        await db.invoices.add(JSON.parse(JSON.stringify(successor)))
      }
      await db.invoices.put(JSON.parse(JSON.stringify(updated)))
      return { updated, successor }
    })
    if (!result) return
    invoices.value = invoices.value.map(i => (i.id === id ? result.updated : i))
    if (result.successor) invoices.value.push(result.successor)
    notifyDataChanged()
  }

  async function remove(id: string) {
    await db.invoices.delete(id)
    invoices.value = invoices.value.filter(i => i.id !== id)
    notifyDataChanged()
  }

  /** Merge imported invoices, skipping ids already present. Returns count added. */
  async function importMany(items: Invoice[]): Promise<number> {
    let added = 0
    for (const raw of items) {
      if (!raw || typeof raw !== 'object' || !raw.id || !raw.address || !(raw.amountNim > 0)) continue
      if (invoices.value.some(i => i.id === raw.id)) continue
      const invoice: Invoice = {
        id: String(raw.id),
        address: String(raw.address),
        amountNim: Number(raw.amountNim),
        description: String(raw.description ?? ''),
        status: raw.status === 'paid' ? 'paid' : 'pending',
        createdAt: Number(raw.createdAt) || Date.now(),
        ...(raw.paidAt ? { paidAt: Number(raw.paidAt) } : {}),
        ...(raw.dueAt ? { dueAt: Number(raw.dueAt) } : {}),
        ...(raw.fiatAmount && raw.fiatCurrency
          ? { fiatAmount: Number(raw.fiatAmount), fiatCurrency: String(raw.fiatCurrency) }
          : {}),
        ...(raw.repeat === 'weekly' || raw.repeat === 'monthly' ? { repeat: raw.repeat } : {}),
        ...(raw.successorInvoiceId ? { successorInvoiceId: String(raw.successorInvoiceId) } : {}),
      }
      await db.invoices.add(invoice)
      invoices.value.push(invoice)
      added++
    }
    if (added) notifyDataChanged()
    return added
  }

  return {
    invoices,
    loaded,
    pending,
    paid,
    pendingTotalNim,
    load,
    reload,
    byAddress,
    pendingByAddress,
    create,
    duplicate,
    setStatus,
    markPaid,
    remove,
    importMany,
  }
})
