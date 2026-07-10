import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/inbox', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/inbox')>()),
  fetchInbox: vi.fn().mockResolvedValue([]),
  deleteInboxMessage: vi.fn().mockResolvedValue(undefined),
  inboxAvailable: () => true,
}))
vi.mock('../services/nimiq', () => ({
  sendNim: vi.fn().mockResolvedValue('txhash'),
}))

import { useInboxStore } from './inbox'
import { db } from '../db/db'
import { makeRequestLink } from '../services/links'

const SENDER = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

describe('inbox store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.inboxItems.clear()
  })

  it('badgeCount counts only actionable items', async () => {
    await db.inboxItems.bulkAdd([
      { id: 'a', objectId: 'o1', type: 'payment-request', sender: SENDER, payload: makeRequestLink(SENDER, 1), sentAt: 1, receivedAt: 1, status: 'actionable', importedAt: 1, reminders: 0 },
      { id: 'b', objectId: 'o2', type: 'x', sender: SENDER, payload: 'p', sentAt: 1, receivedAt: 1, status: 'unsupported', importedAt: 1, reminders: 0 },
      { id: 'c', objectId: 'o3', type: 'payment-request', sender: SENDER, payload: 'p', sentAt: 1, receivedAt: 1, status: 'dismissed', importedAt: 1, reminders: 0 },
    ])
    const store = useInboxStore()
    await store.load()
    expect(store.badgeCount).toBe(1)
    expect(store.actionable).toHaveLength(1)
  })

  it('pay sends NIM to the payload destination and marks the item paid', async () => {
    const { sendNim } = await import('../services/nimiq')
    await db.inboxItems.add({ id: 'a', objectId: 'o1', type: 'payment-request', sender: SENDER, payload: makeRequestLink(SENDER, 1), sentAt: 1, receivedAt: 1, status: 'actionable', importedAt: 1, reminders: 0 })
    const store = useInboxStore()
    await store.load()
    await store.pay(store.items[0])
    const sendNimMock = vi.mocked(sendNim)
    expect(sendNimMock).toHaveBeenCalledOnce()
    expect(sendNimMock.mock.calls[0][0]).toContain('NQ07')
    expect(sendNimMock.mock.calls[0][1]).toBe(1)
    expect((await db.inboxItems.get('a'))?.status).toBe('paid')
  })

  it('dismiss marks dismissed and deletes unsupported remotely', async () => {
    const { deleteInboxMessage } = await import('../services/inbox')
    await db.inboxItems.add({ id: 'b', objectId: 'o2', type: 'future', sender: SENDER, payload: 'p', sentAt: 1, receivedAt: 1, status: 'unsupported', importedAt: 1, reminders: 0 })
    const store = useInboxStore()
    await store.load()
    store.selfAddress = SENDER
    await store.dismiss(store.items[0])
    expect((await db.inboxItems.get('b'))?.status).toBe('dismissed')
    expect(deleteInboxMessage).toHaveBeenCalledWith(SENDER, 'b')
  })
})
