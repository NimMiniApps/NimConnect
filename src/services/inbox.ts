import { apiUrl, hasApiBase } from './api'
import { signChallenge } from './nimiq'
import { db } from '../db/db'

const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()

const CAPABILITY_KEY = 'inbox-read-capability'
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

interface ReadCapability {
  address: string
  publicKey: string
  signature: string
  issuedAt: number
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

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
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
  const payloadHash = await sha256Hex(input.payload)
  const message = buildSendMessage({ ...input, sentAt, nonce, payloadHash })
  const { publicKey, signature } = await signChallenge(message)
  const res = await fetch(apiUrl('/api/inbox/messages'), {
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
      public_key: publicKey,
      signature,
    }),
  })
  if (!res.ok) throw new Error(await inboxErrorMessage(res))
}

/**
 * Cached replayable read capability (see spec): one wallet signature grants
 * read+delete on our own mailbox for 14 days. Stored in Dexie, not localStorage.
 */
async function readCapability(address: string): Promise<ReadCapability> {
  const cached = (await db.kv.get(CAPABILITY_KEY))?.value as ReadCapability | undefined
  if (cached && compact(cached.address) === compact(address) && capabilityFresh(cached.issuedAt)) {
    return cached
  }
  const issuedAt = Date.now()
  const { publicKey, signature } = await signChallenge(buildReadMessage(address, issuedAt))
  const capability: ReadCapability = { address: compact(address), publicKey, signature, issuedAt }
  await db.kv.put({ key: CAPABILITY_KEY, value: capability })
  return capability
}

function authHeaders(c: ReadCapability): HeadersInit {
  return {
    'X-Inbox-Public-Key': c.publicKey,
    'X-Inbox-Signature': c.signature,
    'X-Inbox-Issued-At': String(c.issuedAt),
  }
}

export async function fetchInbox(address: string): Promise<InboxEnvelope[]> {
  if (!hasApiBase()) return []
  const capability = await readCapability(address)
  const res = await fetch(apiUrl(`/api/inbox/${encodeURIComponent(compact(address))}/messages`), {
    headers: authHeaders(capability),
  })
  if (!res.ok) throw new Error(await inboxErrorMessage(res))
  const body = await res.json() as { messages?: InboxEnvelope[] }
  return body.messages ?? []
}

export async function deleteInboxMessage(address: string, id: string): Promise<void> {
  if (!hasApiBase()) return
  const capability = await readCapability(address)
  const res = await fetch(
    apiUrl(`/api/inbox/${encodeURIComponent(compact(address))}/messages/${encodeURIComponent(id)}`),
    { method: 'DELETE', headers: authHeaders(capability) },
  )
  if (!res.ok && res.status !== 404) throw new Error(await inboxErrorMessage(res))
}
