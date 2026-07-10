import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db } from '../db/db'
import type { InboxItem } from '../types/profile'
import { fetchInbox, deleteInboxMessage, inboxAvailable } from '../services/inbox'
import { importEnvelopes } from '../services/inbox-import'
import { parsePaymentRequest } from '../services/links'
import { sendNim } from '../services/nimiq'

export const useInboxStore = defineStore('inbox', () => {
  const items = ref<InboxItem[]>([])
  const loaded = ref(false)
  const refreshing = ref(false)
  /** Set by the page/App once the self profile is known; needed for polling. */
  const selfAddress = ref<string | null>(null)

  async function load() {
    if (loaded.value) return
    items.value = await db.inboxItems.toArray()
    loaded.value = true
  }

  const actionable = computed(() =>
    items.value.filter(i => i.status === 'actionable').sort((a, b) => b.receivedAt - a.receivedAt),
  )
  const badgeCount = computed(() => actionable.value.length)

  /** Poll the server mailbox and import (import-before-delete, see spec). */
  async function refresh(address?: string) {
    const addr = address ?? selfAddress.value
    if (!addr || !inboxAvailable() || refreshing.value) return
    if (address) selfAddress.value = address
    refreshing.value = true
    try {
      const envelopes = await fetchInbox(addr)
      if (envelopes.length) {
        await importEnvelopes(envelopes, {
          getById: id => db.inboxItems.get(id),
          getByObjectId: async (objectId, sender) =>
            (await db.inboxItems.where('objectId').equals(objectId).toArray())
              .find(i => i.sender.replace(/\s+/g, '') === sender.replace(/\s+/g, '')),
          put: async item => { await db.inboxItems.put(item) },
          deleteRemote: id => deleteInboxMessage(addr, id),
        })
        items.value = await db.inboxItems.toArray()
      }
    } catch {
      // silent per spec — badge stays stale
    } finally {
      refreshing.value = false
    }
  }

  async function setStatus(item: InboxItem, status: InboxItem['status']) {
    const updated = { ...item, status }
    await db.inboxItems.put(updated)
    items.value = items.value.map(i => (i.id === item.id ? updated : i))
  }

  /** Pay the request via the wallet, then mark it paid. */
  async function pay(item: InboxItem) {
    const parsed = parsePaymentRequest(item.payload)
    if (!parsed?.amountNim) throw new Error('invalid-request')
    await sendNim(parsed.recipient, parsed.amountNim, parsed.message)
    await setStatus(item, 'paid')
  }

  async function dismiss(item: InboxItem) {
    // Unsupported messages were left on the server; explicit dismissal removes them.
    if (item.status === 'unsupported' && selfAddress.value) {
      await deleteInboxMessage(selfAddress.value, item.id).catch(() => {})
    }
    await setStatus(item, 'dismissed')
  }

  return { items, loaded, refreshing, selfAddress, actionable, badgeCount, load, refresh, pay, dismiss }
})
