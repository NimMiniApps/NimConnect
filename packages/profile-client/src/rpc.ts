import { compactAddress } from './client'
import { HANDLE_REGISTRY_ADDRESS } from './claim'
import { HTLC_ACCOUNT_TYPE, ownerFromHtlcCreationData, resolveHandleRegistry } from './registry'
import type { ResolvedHandleClaim, RegistryTx, ResolveHandleRegistryOptions } from './registry'

/** Public mainnet RPC gateway — same default the backend uses. */
export const DEFAULT_RPC_URL = 'https://rpc-mainnet.nimiqscan.com'

interface RpcTxRaw {
  hash: string
  sender?: string
  from?: string
  recipient?: string
  to?: string
  data?: string
  recipientData?: string
  blockNumber: number
  transactionIndex: number
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

async function fetchTransactionsByAddress(rpcUrl: string, address: string, max: number): Promise<RpcTxRaw[]> {
  const txs = await rpcCall<RpcTxRaw[] | null>(rpcUrl, 'getTransactionsByAddress', [address, max, null])
  return txs ?? []
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

  const txs = await fetchTransactionsByAddress(rpcUrl, contractAddress, 100).catch(() => [])
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
  /** Caps how much of the registry's tx history to fetch. Defaults to 5000, same as the backend's sweep cap. */
  maxTx?: number
  /** Override HTLC-owner resolution instead of the built-in RPC-backed lookup. */
  resolveHtlcOwner?: ResolveHandleRegistryOptions['resolveHtlcOwner']
}

/**
 * Fetches the registry address's transaction history from a Nimiq RPC and
 * resolves the handle registry from it — including Nimiq Pay's swap-HTLC
 * claim attribution — with no dependency on NimConnect's server at all.
 * This is the "just give it an RPC URL" entry point; for more control
 * (your own fetching/pagination/caching), use resolveHandleRegistry directly.
 *
 * ponytail: refetches and replays the full tx history on every call, same
 * as the backend before its periodic-sweep cache — fine for occasional use,
 * cache the result yourself (e.g. on a timer) if you call this often.
 */
export async function fetchHandleRegistry(
  options: FetchHandleRegistryOptions = {},
): Promise<Map<string, ResolvedHandleClaim>> {
  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC_URL
  const registryAddress = options.registryAddress ?? HANDLE_REGISTRY_ADDRESS
  const rawTxs = await fetchTransactionsByAddress(rpcUrl, registryAddress, options.maxTx ?? 5000)

  const txs: RegistryTx[] = rawTxs
    .filter((tx) => compactAddress(txRecipient(tx)) === compactAddress(registryAddress))
    .map((tx) => ({
      hash: tx.hash,
      sender: txSender(tx),
      data: txData(tx),
      blockHeight: tx.blockNumber,
      txIndex: tx.transactionIndex,
      fromType: tx.fromType,
    }))

  return resolveHandleRegistry(txs, {
    resolveHtlcOwner: options.resolveHtlcOwner ?? ((contractAddress) => resolveHtlcOwnerViaRpc(rpcUrl, contractAddress)),
  })
}
