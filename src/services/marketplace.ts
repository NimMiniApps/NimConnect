import { apiUrl } from './api'
import { authorizedFetch } from './authorization'

/** Mirrors backend's compactAddress: uppercase, spaces stripped. */
function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

export interface MarketplaceListing {
  handle: string
  seller: string
  price_luna: number
  fee_luna: number
  status: string
  ownership_epoch_tx_hash: string
  created_at: number
}

export interface MarketplaceTrade {
  id: string
  reference: string
  handle: string
  buyer: string
  seller: string
  price_luna: number
  fee_luna: number
  escrow_address?: string
  state: string
  version: number
  deposit_tx_hash?: string
  deposit_block_height?: number
  release_tx_hash?: string
  claim_tx_hash?: string
  payout_tx_hash?: string
  refund_tx_hash?: string
  created_at: number
  updated_at: number
}

/** Byte-for-byte match of backend/marketplace_intents.go's marketplaceListingMessage. */
export function marketplaceListingMessage(
  handle: string,
  seller: string,
  priceLuna: number,
  feeLuna: number,
  ownershipEpochTxHash: string,
  nonce: string,
  expiresAt: number,
): string {
  return (
    'nimconnect:marketplace-listing:v1' +
    `\nhandle=${handle}` +
    `\nseller=${compact(seller)}` +
    `\nprice_luna=${priceLuna}` +
    `\nfee_luna=${feeLuna}` +
    `\nownership_epoch_tx_hash=${ownershipEpochTxHash}` +
    `\nnonce=${nonce}` +
    `\nexpires_at=${expiresAt}`
  )
}

/** Byte-for-byte match of backend/marketplace_intents.go's marketplacePurchaseMessage. */
export function marketplacePurchaseMessage(
  handle: string,
  buyer: string,
  refundAddress: string,
  nonce: string,
  expiresAt: number,
): string {
  return (
    'nimconnect:marketplace-purchase:v1' +
    `\nhandle=${handle}` +
    `\nbuyer=${compact(buyer)}` +
    `\nrefund_address=${compact(refundAddress)}` +
    `\nnonce=${nonce}` +
    `\nexpires_at=${expiresAt}`
  )
}

/** Random hex nonce — the backend only checks uniqueness, not format. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function marketplaceFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `request failed (${res.status})`)
  }
  return body as T
}

async function scopedMarketplaceFetch<T>(path: string, scope: 'marketplace:read' | 'marketplace:trade', init?: RequestInit): Promise<T> {
  const res = await authorizedFetch(path, [scope], init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || `request failed (${res.status})`)
  return body as T
}

export function fetchListings(): Promise<MarketplaceListing[]> {
  return marketplaceFetch('/api/marketplace/listings')
}

export interface CreateListingRequest {
  handle: string
  seller: string
  price_luna: number
  fee_luna: number
  ownership_epoch_tx_hash: string
  nonce: string
  expires_at: number
  public_key?: string
  signature?: string
}

export function createListing(req: CreateListingRequest): Promise<MarketplaceListing> {
  return scopedMarketplaceFetch('/api/marketplace/listings', 'marketplace:trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export interface ReserveTradeRequest {
  handle: string
  buyer: string
  refund_address: string
  nonce: string
  expires_at: number
  public_key?: string
  signature?: string
}

export interface ReserveTradeResponse {
  trade_id: string
  escrow_address: string
  reference: string
  price_luna: number
  fee_luna: number
}

export function reserveTrade(req: ReserveTradeRequest): Promise<ReserveTradeResponse> {
  return scopedMarketplaceFetch('/api/marketplace/trades', 'marketplace:trade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export function getTrade(tradeId: string): Promise<MarketplaceTrade> {
  return marketplaceFetch(`/api/marketplace/trades/${tradeId}`)
}

/** Byte-for-byte match of backend/marketplace_intents.go's marketplaceTradesLookupMessage. */
export function marketplaceTradesLookupMessage(address: string, nonce: string, expiresAt: number): string {
  return (
    'nimconnect:marketplace-trades-lookup:v1' +
    `\naddress=${compact(address)}` +
    `\nnonce=${nonce}` +
    `\nexpires_at=${expiresAt}`
  )
}

export function fetchTradesForWallet(
  address: string,
  _nonce?: string,
  _expiresAt?: number,
  _publicKey?: string,
  _signature?: string,
): Promise<MarketplaceTrade[]> {
  return scopedMarketplaceFetch(`/api/marketplace/trades/by-wallet/${encodeURIComponent(address)}`, 'marketplace:read')
}

export type SubmitTransactionRequest =
  | { kind: 'hub'; raw_hex: string }
  | { kind: 'pay'; tx_hash: string }

export function submitRelease(tradeId: string, req: SubmitTransactionRequest): Promise<void> {
  return marketplaceFetch(`/api/marketplace/trades/${tradeId}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export function submitClaim(tradeId: string, req: SubmitTransactionRequest): Promise<void> {
  return marketplaceFetch(`/api/marketplace/trades/${tradeId}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
}

export async function fetchChainHeight(): Promise<number> {
  const { height } = await marketplaceFetch<{ height: number }>('/api/chain/height')
  return height
}
