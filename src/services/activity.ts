import { timestampMs, type IncomingPayment } from './history'
import type { Invoice, InboxItem } from '../types/profile'

export const DUE_SOON_MS = 48 * 3_600_000

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
const keyFor = (addresses: string[]) =>
  `nimconnect:last-seen-activity:${addresses.map(compact).sort().join('+')}`

/** Last dismissed-at for this wallet identity; null on first run (caller initializes to now). */
export function getLastSeen(addresses: string[]): number | null {
  const raw = globalThis.localStorage?.getItem(keyFor(addresses))
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function setLastSeen(addresses: string[], at = Date.now()) {
  try {
    globalThis.localStorage?.setItem(keyFor(addresses), String(at))
  } catch { /* best-effort */ }
}

export interface NewActivity {
  payments: IncomingPayment[]
  requests: InboxItem[]
  dueInvoices: Invoice[]
}

/** What changed since the user last dismissed the banner. Due invoices are not
 * timestamp-gated — they reappear until paid. */
export function newActivity(input: {
  payments: IncomingPayment[]
  inboxItems: InboxItem[]
  invoices: Invoice[]
  lastSeenAt: number
  now?: number
}): NewActivity {
  const now = input.now ?? Date.now()
  return {
    payments: input.payments.filter(p => timestampMs(p.timestamp) > input.lastSeenAt),
    requests: input.inboxItems.filter(
      i => i.status === 'actionable' && timestampMs(i.receivedAt) > input.lastSeenAt,
    ),
    dueInvoices: input.invoices.filter(
      i => i.status === 'pending' && !!i.dueAt && i.dueAt < now + DUE_SOON_MS,
    ),
  }
}
