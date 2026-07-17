import type { ResolvedHandleClaim, ResolveHandleRegistryOptions } from './registry.js';
/** Public mainnet RPC gateway — same default the backend uses. */
export declare const DEFAULT_RPC_URL = "https://rpc-mainnet.nimiqscan.com";
export interface FetchHandleRegistryOptions {
    /** Defaults to the public mainnet gateway (DEFAULT_RPC_URL). */
    rpcUrl?: string;
    /** Defaults to the shared registry address (HANDLE_REGISTRY_ADDRESS). */
    registryAddress?: string;
    /** Caps how much of the registry's tx history to fetch. Defaults to 5000, same as the backend's sweep cap. */
    maxTx?: number;
    /** Override HTLC-owner resolution instead of the built-in RPC-backed lookup. */
    resolveHtlcOwner?: ResolveHandleRegistryOptions['resolveHtlcOwner'];
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
export declare function fetchHandleRegistry(options?: FetchHandleRegistryOptions): Promise<Map<string, ResolvedHandleClaim>>;
