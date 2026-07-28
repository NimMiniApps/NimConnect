import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  marketplaceListingMessage,
  marketplacePurchaseMessage,
  generateNonce,
  fetchListings,
  createListing,
  reserveTrade,
  getTrade,
  submitRelease,
  submitClaim,
  fetchChainHeight,
} from './marketplace'

describe('marketplaceListingMessage', () => {
  it('matches the exact backend format', () => {
    const message = marketplaceListingMessage('chuck', 'NQ11 SELLER', 1000, 50, 't1', 'nonce1', 1234)
    expect(message).toBe(
      'nimconnect:marketplace-listing:v1' +
        '\nhandle=chuck' +
        '\nseller=NQ11SELLER' +
        '\nprice_luna=1000' +
        '\nfee_luna=50' +
        '\nownership_epoch_tx_hash=t1' +
        '\nnonce=nonce1' +
        '\nexpires_at=1234',
    )
  })
})

describe('marketplacePurchaseMessage', () => {
  it('matches the exact backend format', () => {
    const message = marketplacePurchaseMessage('chuck', 'NQ22 BUYER', 'NQ22 BUYER', 'nonce2', 5678)
    expect(message).toBe(
      'nimconnect:marketplace-purchase:v1' +
        '\nhandle=chuck' +
        '\nbuyer=NQ22BUYER' +
        '\nrefund_address=NQ22BUYER' +
        '\nnonce=nonce2' +
        '\nexpires_at=5678',
    )
  })
})

describe('generateNonce', () => {
  it('produces unique, non-empty values', () => {
    const a = generateNonce()
    const b = generateNonce()
    expect(a).not.toBe('')
    expect(a).not.toBe(b)
  })
})

describe('marketplace API calls', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchListings returns the parsed array', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => [{ handle: 'chuck' }] })
    await expect(fetchListings()).resolves.toEqual([{ handle: 'chuck' }])
  })

  it('createListing posts the request and returns the created listing', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ handle: 'chuck', status: 'active' }) })
    const result = await createListing({
      handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 1000, fee_luna: 50,
      ownership_epoch_tx_hash: 't1', nonce: 'n1', expires_at: 123,
      public_key: 'pub', signature: 'sig',
    })
    expect(result).toEqual({ handle: 'chuck', status: 'active' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/listings'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces the backend error message on failure, not a generic one', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: 'signer does not currently own this handle on chain' }) })
    await expect(
      createListing({
        handle: 'chuck', seller: 'NQ11 SELLER', price_luna: 1000, fee_luna: 50,
        ownership_epoch_tx_hash: 't1', nonce: 'n1', expires_at: 123,
        public_key: 'pub', signature: 'sig',
      }),
    ).rejects.toThrow('signer does not currently own this handle on chain')
  })

  it('reserveTrade returns the trade payment details', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ trade_id: 't1', escrow_address: 'NQ99 ESCROW', reference: 'ref1', price_luna: 1000, fee_luna: 50 },
      ),
    })
    await expect(
      reserveTrade({ handle: 'chuck', buyer: 'NQ22 BUYER', refund_address: 'NQ22 BUYER', nonce: 'n2', expires_at: 456, public_key: 'pub', signature: 'sig' }),
    ).resolves.toEqual({ trade_id: 't1', escrow_address: 'NQ99 ESCROW', reference: 'ref1', price_luna: 1000, fee_luna: 50 })
  })

  it('getTrade fetches a single trade by id', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: 't1', state: 'FUNDED' }) })
    await expect(getTrade('t1')).resolves.toEqual({ id: 't1', state: 'FUNDED' })
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/marketplace/trades/t1'), undefined)
  })

  it('submitRelease posts the hub or pay submission', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })
    await submitRelease('t1', { kind: 'hub', raw_hex: 'deadbeef' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/trades/t1/release'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ kind: 'hub', raw_hex: 'deadbeef' }) }),
    )
  })

  it('submitClaim posts the hub or pay submission', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({}) })
    await submitClaim('t1', { kind: 'pay', tx_hash: 'c1' })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/marketplace/trades/t1/claim'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ kind: 'pay', tx_hash: 'c1' }) }),
    )
  })

  it('fetchChainHeight returns the numeric height', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ height: 4321 }) })
    await expect(fetchChainHeight()).resolves.toBe(4321)
  })
})
