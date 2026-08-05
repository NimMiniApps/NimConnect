import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import { hasApiBase } from './api'
import { authorizedFetch } from './authorization'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

const CAPABILITY_MAX_AGE = 14 * 24 * 3600 * 1000

/** Wire format of a mailbox message; field semantics in the design spec. */
export interface InboxEnvelope {
  version: number
  type: string
  id: string
  object_id: string
  nonce: string
  sender: string
  recipient: string
  payload: string
  sent_at: number
  received_at: number
  public_key: string
  signature: string
}

export function buildSendMessage(f: {
  sender: string
  recipient: string
  sentAt: number
  nonce: string
  objectId: string
  payloadHash: string
}): string {
  return 'nimconnect:inbox:send:v1'
    + `\nsender=${compact(f.sender)}`
    + `\nrecipient=${compact(f.recipient)}`
    + `\nsentAt=${f.sentAt}`
    + `\nnonce=${f.nonce}`
    + `\nobjectId=${f.objectId}`
    + `\npayloadHash=${f.payloadHash}`
}

export function buildReadMessage(address: string, issuedAt: number): string {
  return `nimconnect:inbox:read:v1\naddress=${compact(address)}\nissuedAt=${issuedAt}`
}

// noble instead of crypto.subtle: subtle is undefined in insecure contexts (plain-HTTP dev)
export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(sha256(new TextEncoder().encode(text)))
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function capabilityFresh(issuedAt: number, now = Date.now()): boolean {
  return issuedAt <= now && now - issuedAt < CAPABILITY_MAX_AGE
}

export function inboxAvailable(): boolean {
  return hasApiBase()
}

const compactAddress = (a: string) => a.replace(/\s+/g, '').toUpperCase()

/** True when the address belongs to a saved contact (not self). */
export function isInboxContact(
  address: string,
  contacts: readonly { isSelf?: boolean; address: string }[],
): boolean {
  const target = compactAddress(address)
  return contacts.some(p => !p.isSelf && compactAddress(p.address) === target)
}

/** Auto-deliver payment requests to the inbox for saved contacts when the API is up. */
export function shouldAutoDeliverInbox(
  recipient: string,
  contacts: readonly { isSelf?: boolean; address: string }[],
): boolean {
  return inboxAvailable() && isInboxContact(recipient, contacts)
}

async function inboxErrorMessage(res: Response): Promise<string> {
  if (res.status === 429) return 'Their inbox is full — share a link instead.'
  if (res.status === 401) return 'Wallet signature was rejected. Use Nimiq Pay with the same wallet as your profile.'
  try {
    const body = await res.json() as { error?: string }
    if (body.error) return `Inbox request failed: ${body.error}`
  } catch { /* ignore */ }
  return `Inbox request failed (${res.status})`
}

/** Sign a payment request with the wallet and POST it to the recipient's mailbox. */
export async function sendPaymentRequest(input: {
  recipient: string
  payload: string
  objectId: string
  sender: string
}): Promise<void> {
  if (!hasApiBase()) throw new Error('inbox-unavailable')
  const sentAt = Date.now()
  const nonce = newNonce()
  const res = await authorizedFetch('/api/inbox/messages', ['inbox:send'], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: 1,
      type: 'payment-request',
      object_id: input.objectId,
      nonce,
      sender: input.sender,
      recipient: input.recipient,
      payload: input.payload,
      sent_at: sentAt,
    }),
  })
  if (!res.ok) throw new Error(await inboxErrorMessage(res))
}

export async function fetchInbox(address: string): Promise<InboxEnvelope[]> {
  if (!hasApiBase()) return []
  const res = await authorizedFetch(`/api/inbox/${encodeURIComponent(compact(address))}/messages`, ['inbox:read'])
  if (!res.ok) throw new Error(await inboxErrorMessage(res))
  const body = await res.json() as { messages?: InboxEnvelope[] }
  return body.messages ?? []
}

export async function deleteInboxMessage(address: string, id: string): Promise<void> {
  if (!hasApiBase()) return
  const res = await authorizedFetch(
    `/api/inbox/${encodeURIComponent(compact(address))}/messages/${encodeURIComponent(id)}`,
    ['inbox:delete'], { method: 'DELETE' },
  )
  if (!res.ok && res.status !== 404) throw new Error(await inboxErrorMessage(res))
}
