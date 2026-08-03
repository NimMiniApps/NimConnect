import type { ResolvedHandleClaim, ResolveHandleRegistryOptions } from './registry.js';
/** Public mainnet RPC gateway — same default the backend uses. */
export declare const DEFAULT_RPC_URL = "https://rpc-mainnet.nimiqscan.com";
interface RpcTxRaw {
    hash: string;
    sender?: string;
    from?: string;
    recipient?: string;
    to?: string;
    data?: string;
    recipientData?: string;
    blockNumber: number;
    /** Absent on some gateways — treated as unknown, not zero (SEC-004). */
    transactionIndex?: number;
    fromType?: number;
    toType?: number;
}
export declare class IncompleteRegistryHistoryError extends Error {
    constructor(message?: string);
}
export declare class AmbiguousRegistryOrderingError extends Error {
    constructor(message?: string);
}
/**
 * Fetches full address history via startAt cursors. Throws if completeness
 * cannot be proven (last page was not short) — callers must not treat a
 * truncated map as payment authority (SEC-004).
 */
export declare function fetchAllTransactionsByAddress(rpcUrl: string, address: string, pageSize?: number, maxPages?: number): Promise<RpcTxRaw[]>;
export interface FetchHandleRegistryOptions {
    /** Defaults to the public mainnet gateway (DEFAULT_RPC_URL). */
    rpcUrl?: string;
    /** Defaults to the shared registry address (HANDLE_REGISTRY_ADDRESS). */
    registryAddress?: string;
    /** Page size for address history. Defaults to 500. */
    pageSize?: number;
    /** Max pages before declaring history incomplete. Defaults to 100. */
    maxPages?: number;
    /**
     * @deprecated Use pageSize/maxPages. Kept as an alias for max total txs
     * (pageSize = maxTx, maxPages = 1) which fails closed when the page is full.
     */
    maxTx?: number;
    /** Override HTLC-owner resolution instead of the built-in RPC-backed lookup. */
    resolveHtlcOwner?: ResolveHandleRegistryOptions['resolveHtlcOwner'];
    /** Forwarded to resolveHandleRegistry; defaults to Infinity (releases remain inert). */
    releaseActivationHeight?: ResolveHandleRegistryOptions['releaseActivationHeight'];
}
/**
 * Fetches the registry address's transaction history from a Nimiq RPC and
 * resolves the handle registry from it — including Nimiq Pay's swap-HTLC
 * claim attribution — with no dependency on NimConnect's server at all.
 * Throws IncompleteRegistryHistoryError / AmbiguousRegistryOrderingError
 * when the result must not be treated as payment authority (SEC-004).
 */
export declare function fetchHandleRegistry(options?: FetchHandleRegistryOptions): Promise<Map<string, ResolvedHandleClaim>>;
export {};
