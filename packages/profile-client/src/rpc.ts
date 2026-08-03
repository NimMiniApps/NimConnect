import { compactAddress } from './client.js'
import { HANDLE_REGISTRY_ADDRESS } from './claim.js'
import { HTLC_ACCOUNT_TYPE, ownerFromHtlcCreationData, resolveHandleRegistry } from './registry.js'
import type { ResolvedHandleClaim, RegistryTx, ResolveHandleRegistryOptions } from './registry.js'

/** Public mainnet RPC gateway — same default the backend uses. */
export const DEFAULT_RPC_URL = 'https://rpc-mainnet.nimiqscan.com'

const DEFAULT_TX_PAGE_SIZE = 500
const DEFAULT_TX_MAX_PAGES = 100

interface RpcTxRaw {
  hash: string
  sender?: string
  from?: string
  recipient?: string
  to?: string
  data?: string
  recipientData?: string
  blockNumber: number
  /** Absent on some gateways — treated as unknown, not zero (SEC-004). */
  transactionIndex?: number
  fromType?: number
  toType?: number
}

function txSender(tx: RpcTxRaw): string {
  return tx.sender || tx.from || ''
}
function txRecipient(tx: RpcTxRaw): string {
  return tx.recipient || tx.to || ''
}
function txData(tx: RpcTxRaw): string {
  return tx.data || tx.recipientData || ''
}

/**
 * Minimal Nimiq PoS JSON-RPC POST call. Tolerates the {data, metadata}
 * envelope some public gateways wrap results in. Mirrors backend/nimiq_rpc.go's call.
 */
async function rpcCall<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
  if (!res.ok) throw new Error(`rpc ${method} failed: ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`)
  const result = body.result
  if (result && typeof result === 'object' && 'data' in result) return result.data as T
  return result as T
}

async function fetchTransactionsByAddressPage(
  rpcUrl: string,
  address: string,
  max: number,
  startAt: string | null,
): Promise<RpcTxRaw[]> {
  const txs = await rpcCall<RpcTxRaw[] | null>(
    rpcUrl,
    'getTransactionsByAddress',
    [address, max, startAt],
  )
  return txs ?? []
}

export class IncompleteRegistryHistoryError extends Error {
  constructor(message = 'registry history incomplete: pagination ceiling reached without a short page') {
    super(message)
    this.name = 'IncompleteRegistryHistoryError'
  }
}

export class AmbiguousRegistryOrderingError extends Error {
  constructor(message = 'registry history ordering ambiguous: missing transactionIndex in a shared block') {
    super(message)
    this.name = 'AmbiguousRegistryOrderingError'
  }
}

/**
 * Fetches full address history via startAt cursors. Throws if completeness
 * cannot be proven (last page was not short) — callers must not treat a
 * truncated map as payment authority (SEC-004).
 */
export async function fetchAllTransactionsByAddress(
  rpcUrl: string,
  address: string,
  pageSize = DEFAULT_TX_PAGE_SIZE,
  maxPages = DEFAULT_TX_MAX_PAGES,
): Promise<RpcTxRaw[]> {
  const all: RpcTxRaw[] = []
  let startAt: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const txs = await fetchTransactionsByAddressPage(rpcUrl, address, pageSize, startAt)
    all.push(...txs)
    if (txs.length < pageSize) return all
    startAt = txs[txs.length - 1]!.hash
  }
  throw new IncompleteRegistryHistoryError()
}

function registryOrderingAmbiguous(txs: RegistryTx[]): boolean {
  const byBlock = new Map<number, RegistryTx[]>()
  for (const tx of txs) {
    const group = byBlock.get(tx.blockHeight) ?? []
    group.push(tx)
    byBlock.set(tx.blockHeight, group)
  }
  for (const group of byBlock.values()) {
    if (group.length < 2) continue
    if (group.some((tx) => tx.txIndex == null || Number.isNaN(tx.txIndex))) return true
  }
  return false
}

async function fetchAccountByAddress(
  rpcUrl: string,
  address: string,
): Promise<{ type?: string; sender?: string } | null> {
  return rpcCall(rpcUrl, 'getAccountByAddress', [address])
}

/**
 * Resolves an HTLC contract's owner the same way the backend does: prefer a
 * live account's `sender` field, fall back to decoding the contract's
 * creation transaction if the account was pruned. One extra RPC round-trip
 * (or two, on the fallback path) per distinct HTLC contract — cheap since
 * resolveHandleRegistry already caches this per contract address per call.
 */
async function resolveHtlcOwnerViaRpc(rpcUrl: string, contractAddress: string): Promise<string | null> {
  const account = await fetchAccountByAddress(rpcUrl, contractAddress).catch(() => null)
  if (account?.type === 'htlc' && account.sender) return account.sender

  const txs = await fetchTransactionsByAddressPage(rpcUrl, contractAddress, 100, null).catch(() => [])
  const creation = txs.find(
    (tx) => tx.toType === HTLC_ACCOUNT_TYPE && compactAddress(txRecipient(tx)) === compactAddress(contractAddress),
  )
  return creation ? ownerFromHtlcCreationData(txData(creation)) : null
}

export interface FetchHandleRegistryOptions {
  /** Defaults to the public mainnet gateway (DEFAULT_RPC_URL). */
  rpcUrl?: string
  /** Defaults to the shared registry address (HANDLE_REGISTRY_ADDRESS). */
  registryAddress?: string
  /** Page size for address history. Defaults to 500. */
  pageSize?: number
  /** Max pages before declaring history incomplete. Defaults to 100. */
  maxPages?: number
  /**
   * @deprecated Use pageSize/maxPages. Kept as an alias for max total txs
   * (pageSize = maxTx, maxPages = 1) which fails closed when the page is full.
   */
  maxTx?: number
  /** Override HTLC-owner resolution instead of the built-in RPC-backed lookup. */
  resolveHtlcOwner?: ResolveHandleRegistryOptions['resolveHtlcOwner']
  /** Forwarded to resolveHandleRegistry; defaults to Infinity (releases remain inert). */
  releaseActivationHeight?: ResolveHandleRegistryOptions['releaseActivationHeight']
}

/**
 * Fetches the registry address's transaction history from a Nimiq RPC and
 * resolves the handle registry from it — including Nimiq Pay's swap-HTLC
 * claim attribution — with no dependency on NimConnect's server at all.
 * Throws IncompleteRegistryHistoryError / AmbiguousRegistryOrderingError
 * when the result must not be treated as payment authority (SEC-004).
 */
export async function fetchHandleRegistry(
  options: FetchHandleRegistryOptions = {},
): Promise<Map<string, ResolvedHandleClaim>> {
  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC_URL
  const registryAddress = options.registryAddress ?? HANDLE_REGISTRY_ADDRESS
  const pageSize = options.maxTx ?? options.pageSize ?? DEFAULT_TX_PAGE_SIZE
  const maxPages = options.maxTx != null ? 1 : (options.maxPages ?? DEFAULT_TX_MAX_PAGES)

  const rawTxs = await fetchAllTransactionsByAddress(rpcUrl, registryAddress, pageSize, maxPages)

  const txs: RegistryTx[] = rawTxs
    .filter((tx) => compactAddress(txRecipient(tx)) === compactAddress(registryAddress))
    .map((tx) => ({
      hash: tx.hash,
      sender: txSender(tx),
      data: txData(tx),
      blockHeight: tx.blockNumber,
      txIndex: tx.transactionIndex ?? Number.NaN,
      fromType: tx.fromType,
    }))

  if (registryOrderingAmbiguous(txs)) {
    throw new AmbiguousRegistryOrderingError()
  }

  // resolveHandleRegistry sorts by txIndex; NaN only appears for single-tx blocks
  // (multi-tx-without-index already rejected above). Coerce missing to 0 for sort.
  for (const tx of txs) {
    if (Number.isNaN(tx.txIndex)) tx.txIndex = 0
  }

  return resolveHandleRegistry(txs, {
    resolveHtlcOwner: options.resolveHtlcOwner ?? ((contractAddress) => resolveHtlcOwnerViaRpc(rpcUrl, contractAddress)),
    releaseActivationHeight: options.releaseActivationHeight,
  })
}
