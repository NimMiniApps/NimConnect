import type { HandleClaimPayload } from './types.js'

/**
 * The shared on-chain @handle registry (NimFeed catalog address). A claim is
 * a transaction sent to this address — NimConnect is one of several readers
 * of the same protocol, not the source of truth. Mirrors
 * backend/handles.go's NimfeedCatalogAddress.
 */
export const HANDLE_REGISTRY_ADDRESS = 'NQ19 LLHP G0ML 37RM 5JJD RME1 GLFY 75PQ 402Y'

// "NF" + version 0x01 + type 0x01 (profile claim), mirrors backend/handles.go.
const CLAIM_MAGIC = [0x4e, 0x46]
const CLAIM_VERSION = 0x01
const CLAIM_TYPE_PROFILE = 0x01
const CLAIM_TEXT_PREFIX = 'NFH:'

/** Mirrors NimFeed's normalizeUsername (3-31 chars, [a-z0-9_]). */
const HANDLE_RE = /^[a-z0-9_]{3,31}$/

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle)
}

/**
 * Builds the transaction payload for claiming a @handle on the shared
 * on-chain registry. This only builds the payload — sign and broadcast it
 * with whatever wallet integration your mini app already uses (Nimiq Hub,
 * Nimiq Pay, etc.): send a transaction to `recipient` with `extraData` as
 * its data field and a minimal/zero value. Mirrors backend/handles.go's
 * makeClaimPayload byte-for-byte, so claims made this way resolve correctly
 * via `resolveHandle`/`getHandleByAddress`.
 */
export function buildHandleClaimPayload(handle: string): HandleClaimPayload {
  if (!isValidHandle(handle)) {
    throw new Error(`invalid handle: ${handle}`)
  }
  const bytes = [
    ...CLAIM_MAGIC,
    CLAIM_VERSION,
    CLAIM_TYPE_PROFILE,
    ...Array.from(handle, (c) => c.charCodeAt(0)),
  ]
  const extraDataBytes = new Uint8Array(bytes)
  const payloadHex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return {
    recipient: HANDLE_REGISTRY_ADDRESS,
    extraData: CLAIM_TEXT_PREFIX + payloadHex,
    extraDataBytes,
  }
}
