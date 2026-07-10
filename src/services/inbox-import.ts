import { parsePaymentRequest } from './links'
import type { InboxEnvelope } from './inbox'
import type { InboxImportStatus, InboxItem } from '../types/profile'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

/**
 * Classify an envelope at the client trust boundary. The critical rule:
 * a request is only actionable when the payment destination equals the
 * wallet-signed sender — otherwise a sender could impersonate a trusted
 * contact while routing funds elsewhere.
 */
export function classifyEnvelope(env: InboxEnvelope): InboxImportStatus {
  if (env.version !== 1 || env.type !== 'payment-request') return 'unsupported'
  const parsed = parsePaymentRequest(env.payload)
  if (!parsed) return 'invalid'
  if (compact(parsed.recipient) !== compact(env.sender)) return 'invalid'
  if (parsed.amountNim != null && !(Number.isFinite(parsed.amountNim) && parsed.amountNim > 0)) return 'invalid'
  return 'actionable'
}

export interface ImportDeps {
  getById(id: string): Promise<InboxItem | undefined>
  getByObjectId(objectId: string, sender: string): Promise<InboxItem | undefined>
  put(item: InboxItem): Promise<void>
  deleteRemote(id: string): Promise<void>
}

/**
 * Import-before-delete: a message is only removed from the server after the
 * local write succeeded. Unsupported messages are kept on the server for a
 * future client version. Failed deletes are retried implicitly on the next
 * poll (id dedup makes redelivery a no-op).
 */
export async function importEnvelopes(
  envelopes: InboxEnvelope[],
  deps: ImportDeps,
): Promise<{ added: number; reminded: number }> {
  let added = 0
  let reminded = 0
  const sorted = [...envelopes].sort((a, b) => a.received_at - b.received_at)

  for (const env of sorted) {
    const safeDelete = () => deps.deleteRemote(env.id).catch(() => {})

    if (await deps.getById(env.id)) {
      await safeDelete() // redelivery after a failed delete
      continue
    }

    const sender = env.sender
    const existing = env.object_id ? await deps.getByObjectId(env.object_id, sender) : undefined
    if (existing) {
      await deps.put({
        ...existing,
        payload: env.payload,
        sentAt: env.sent_at,
        receivedAt: env.received_at,
        reminders: existing.reminders + 1,
        // A reminder re-opens a dismissed request; paid stays paid.
        status: existing.status === 'dismissed' ? 'actionable' : existing.status,
      })
      reminded++
      await safeDelete()
      continue
    }

    const status = classifyEnvelope(env)
    await deps.put({
      id: env.id,
      objectId: env.object_id,
      type: env.type,
      sender,
      payload: env.payload,
      sentAt: env.sent_at,
      receivedAt: env.received_at,
      status,
      importedAt: Date.now(),
      reminders: 0,
    })
    added++
    if (status !== 'unsupported') await safeDelete()
  }
  return { added, reminded }
}
