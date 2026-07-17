import type { HandleClaimPayload } from './types.js';
/**
 * The shared on-chain @handle registry (NimFeed catalog address). A claim is
 * a transaction sent to this address — NimConnect is one of several readers
 * of the same protocol, not the source of truth. Mirrors
 * backend/handles.go's NimfeedCatalogAddress.
 */
export declare const HANDLE_REGISTRY_ADDRESS = "NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y";
export declare function isValidHandle(handle: string): boolean;
/**
 * Builds the transaction payload for claiming a @handle on the shared
 * on-chain registry. This only builds the payload — sign and broadcast it
 * with whatever wallet integration your mini app already uses (Nimiq Hub,
 * Nimiq Pay, etc.): send a transaction to `recipient` with `extraData` as
 * its data field and a minimal/zero value. Mirrors backend/handles.go's
 * makeClaimPayload byte-for-byte, so claims made this way resolve correctly
 * via `resolveHandle`/`getHandleByAddress`.
 */
export declare function buildHandleClaimPayload(handle: string): HandleClaimPayload;
