import { describe, expect, it, vi } from 'vitest'
import { classifyEnvelope, importEnvelopes, type ImportDeps } from './inbox-import'
import type { InboxEnvelope } from './inbox'
import type { InboxItem } from '../types/profile'

// Valid mainnet-format address pair for tests (checksum-valid).
const SENDER = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
const OTHER = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

function env(overrides: Partial<InboxEnvelope> = {}): InboxEnvelope {
  return {
    version: 1,
    type: 'payment-request',
    id: 'msg-1',
    object_id: 'inv-1',
    nonce: 'a'.repeat(32),
    sender: SENDER,
    recipient: OTHER,
    payload: `nimiq:${SENDER.replace(/\s+/g, '')}?amount=12345&message=Invoice`,
    sent_at: 1,
    received_at: 2,
    public_key: 'pk',
    signature: 'sig',
    ...overrides,
  }
}

describe('classifyEnvelope', () => {
  it('accepts a payment request whose destination is the signed sender', () => {
    expect(classifyEnvelope(env())).toBe('actionable')
  })
  it('marks unknown versions and types unsupported', () => {
    expect(classifyEnvelope(env({ version: 2 }))).toBe('unsupported')
    expect(classifyEnvelope(env({ type: 'chat' }))).toBe('unsupported')
  })
  it('marks unparseable payloads invalid', () => {
    expect(classifyEnvelope(env({ payload: 'not a link' }))).toBe('invalid')
  })
  it('marks destination != signed sender invalid (impersonation guard)', () => {
    expect(classifyEnvelope(env({ payload: `nimiq:${OTHER.replace(/\s+/g, '')}?amount=1` }))).toBe('invalid')
  })
})

function makeDeps(existing: InboxItem[] = []) {
  const items = new Map(existing.map(i => [i.id, i]))
  const deleted: string[] = []
  const deps: ImportDeps = {
    getById: async id => items.get(id),
    getByObjectId: async (objectId, sender) =>
      [...items.values()].find(i => i.objectId === objectId && i.sender === sender),
    put: async item => { items.set(item.id, item) },
    deleteRemote: async id => { deleted.push(id) },
  }
  return { deps, items, deleted }
}

describe('importEnvelopes', () => {
  it('imports then deletes remotely', async () => {
    const { deps, items, deleted } = makeDeps()
    const result = await importEnvelopes([env()], deps)
    expect(result.added).toBe(1)
    expect(items.get('msg-1')?.status).toBe('actionable')
    expect(deleted).toEqual(['msg-1'])
  })

  it('keeps unsupported messages on the server', async () => {
    const { deps, items, deleted } = makeDeps()
    await importEnvelopes([env({ type: 'future-thing' })], deps)
    expect(items.get('msg-1')?.status).toBe('unsupported')
    expect(deleted).toEqual([])
  })

  it('dedups by message id (redelivery after failed delete)', async () => {
    const { deps, deleted } = makeDeps([{
      id: 'msg-1', objectId: 'inv-1', type: 'payment-request', sender: SENDER,
      payload: 'p', sentAt: 1, receivedAt: 2, status: 'actionable', importedAt: 3, reminders: 0,
    }])
    const result = await importEnvelopes([env()], deps)
    expect(result.added).toBe(0)
    expect(deleted).toEqual(['msg-1']) // retries the delete, adds nothing
  })

  it('treats a new message with a known objectId as a reminder', async () => {
    const { deps, items, deleted } = makeDeps([{
      id: 'msg-0', objectId: 'inv-1', type: 'payment-request', sender: SENDER,
      payload: 'p', sentAt: 1, receivedAt: 1, status: 'actionable', importedAt: 1, reminders: 0,
    }])
    const result = await importEnvelopes([env({ id: 'msg-2', received_at: 9 })], deps)
    expect(result.reminded).toBe(1)
    const item = items.get('msg-0')!
    expect(item.reminders).toBe(1)
    expect(item.receivedAt).toBe(9)
    expect(deleted).toEqual(['msg-2'])
  })

  it('a failed remote delete does not lose the local import', async () => {
    const { deps, items } = makeDeps()
    deps.deleteRemote = vi.fn().mockRejectedValue(new Error('network'))
    const result = await importEnvelopes([env()], deps)
    expect(result.added).toBe(1)
    expect(items.get('msg-1')?.status).toBe('actionable')
  })
})
