import { describe, expect, it } from 'vitest'
import { buildSendMessage, buildReadMessage, sha256Hex, newNonce, capabilityFresh, isInboxContact, shouldAutoDeliverInbox } from './inbox'

describe('inbox canonical messages', () => {
  it('builds the send message exactly as the backend expects', () => {
    expect(buildSendMessage({
      sender: 'NQ11 aaaa', recipient: 'nq22 BBBB', sentAt: 42,
      nonce: 'abc', objectId: 'obj-1', payloadHash: 'deadbeef',
    })).toBe(
      'nimconnect:inbox:send:v1\nsender=NQ11AAAA\nrecipient=NQ22BBBB\nsentAt=42\nnonce=abc\nobjectId=obj-1\npayloadHash=deadbeef',
    )
  })

  it('builds the read message exactly as the backend expects', () => {
    expect(buildReadMessage('nq22 bbbb', 7)).toBe('nimconnect:inbox:read:v1\naddress=NQ22BBBB\nissuedAt=7')
  })

  it('hashes payloads with sha256 hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('generates 32-char lowercase hex nonces, unique per call', () => {
    const a = newNonce()
    const b = newNonce()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  it('treats capabilities as fresh for 14 days', () => {
    const now = 1_760_000_000_000
    const day = 24 * 3600 * 1000
    expect(capabilityFresh(now - 13 * day, now)).toBe(true)
    expect(capabilityFresh(now - 15 * day, now)).toBe(false)
    expect(capabilityFresh(now + day, now)).toBe(false) // future-dated is stale
  })

  it('auto-delivers only for saved contacts when inbox is configured', () => {
    const contacts = [
      { address: 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA', isSelf: false },
      { address: 'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB', isSelf: true },
    ]
    expect(isInboxContact('nq11 aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa aaaa', contacts)).toBe(true)
    expect(isInboxContact('NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB', contacts)).toBe(false)
    expect(isInboxContact('NQ99 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ', contacts)).toBe(false)
  })
})
