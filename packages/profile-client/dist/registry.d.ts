/** Nimiq account type: 0 basic, 1 vesting, 2 HTLC. Nimiq Pay routes claims
 * through swap HTLCs, so a Pay-originated claim tx's sender is often an
 * HTLC contract with this type, not the user's own address. */
export declare const HTLC_ACCOUNT_TYPE = 2;
/** A registry-address-inbound transaction, as needed to parse a possible claim. */
export interface RegistryTx {
    hash: string;
    sender: string;
    /** Hex-encoded transaction data field. */
    data: string;
    blockHeight: number;
    txIndex: number;
    /** Account type of `sender` (see HTLC_ACCOUNT_TYPE). Omit if unknown — treated as a normal sender. */
    fromType?: number;
}
export interface ResolvedHandleClaim {
    handle: string;
    address: string;
    txHash: string;
    blockHeight: number;
    txIndex: number;
}
/**
 * Parses a transaction's hex data field into a claimed handle, or null if
 * it's not a claim (e.g. a post/follow on the same shared registry address).
 * Accepts the raw binary form (Nimiq Hub), the "NFH:" text envelope (Nimiq
 * Pay), and Nimiq Pay's double-hex-encoded variant. Mirrors
 * backend/handles.go's parseClaimData byte-for-byte.
 */
export declare function parseClaimTxData(dataHex: string): {
    handle: string;
} | null;
/**
 * Decodes an HTLC contract's real owner from its creation transaction's data
 * field (owner address is the first 20 bytes). Use this to build
 * `resolveHtlcOwner` from your own RPC's creation-tx lookup when a live
 * account query doesn't have the owner (e.g. the contract was pruned).
 * Mirrors backend/handles.go's htlcOwnerFromCreationData.
 */
export declare function ownerFromHtlcCreationData(dataHex: string): string | null;
export interface ResolveHandleRegistryOptions {
    /**
     * Resolves an HTLC contract address to the wallet that created (funded)
     * it — the address a Nimiq Pay user actually owns. Called at most once
     * per distinct contract address (results are cached for this call), only
     * for txs with `fromType === HTLC_ACCOUNT_TYPE`. May return a Promise —
     * this typically means an RPC call. Look it up via your RPC's account
     * query (prefer a live account's `sender` field) or, if the contract is
     * gone from account state, its creation tx's data via
     * `ownerFromHtlcCreationData`. Falls back to the raw sender if omitted or
     * it returns null.
     */
    resolveHtlcOwner?: (contractAddress: string) => string | null | Promise<string | null>;
}
/**
 * Resolves the shared on-chain handle registry from a raw list of
 * transactions sent to the registry address — fetch that list yourself
 * (your own RPC/full node/indexer), this only does the protocol logic, so
 * you're not required to depend on NimConnect's server for handle
 * resolution. Earliest `(blockHeight, txIndex)` wins per handle; mirrors
 * backend/handles_registry.go's Rebuild. Pass `resolveHtlcOwner` to
 * correctly attribute Nimiq Pay claims routed through swap HTLCs —
 * without it, such claims resolve to the HTLC contract address instead of
 * the user (see backend/handles.go's claimantAddress).
 */
export declare function resolveHandleRegistry(txs: RegistryTx[], options?: ResolveHandleRegistryOptions): Promise<Map<string, ResolvedHandleClaim>>;
/** Reverse lookup: the earliest handle claimed by an address, or null. */
export declare function resolveHandleByAddress(registry: Map<string, ResolvedHandleClaim>, address: string): ResolvedHandleClaim | null;
/** Format-valid and not already claimed in the given registry snapshot. */
export declare function isHandleAvailable(registry: Map<string, ResolvedHandleClaim>, handle: string): boolean;
