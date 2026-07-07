import { ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '../db/db'
import type { Invoice } from '../types/profile'
import { uuid } from '../utils/uuid'

export const useInvoicesStore = defineStore('invoices', () => {
  const invoices = ref<Invoice[]>([])
  const loaded = ref(false)

  async function load() {
    if (loaded.value) return
    invoices.value = await db.invoices.toArray()
    loaded.value = true
  }

  function byAddress(address: string): Invoice[] {
    return invoices.value
      .filter(i => i.address === address)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async function create(input: { address: string; amountNim: number; description: string }): Promise<Invoice> {
    if (!(input.amountNim > 0)) throw new Error('invalid-amount')
    const invoice: Invoice = {
      id: uuid(),
      address: input.address,
      amountNim: input.amountNim,
      description: input.description.trim(),
      status: 'pending',
      createdAt: Date.now(),
    }
    await db.invoices.add(invoice)
    invoices.value.push(invoice)
    return invoice
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
  }

  async function remove(id: string) {
    await db.invoices.delete(id)
    invoices.value = invoices.value.filter(i => i.id !== id)
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
      }
      await db.invoices.add(invoice)
      invoices.value.push(invoice)
      added++
    }
    return added
  }

  return { invoices, loaded, load, byAddress, create, setStatus, remove, importMany }
})
