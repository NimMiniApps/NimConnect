import { compactAddress } from './client';
import { isValidHandle } from './claim';
import { userFriendlyAddress } from './nimiqAddress';
// Mirrors backend/handles.go's claim constants exactly — keep in sync.
const CLAIM_MAGIC0 = 0x4e;
const CLAIM_MAGIC1 = 0x46;
const CLAIM_VERSION = 0x01;
const CLAIM_TYPE_PROFILE = 0x01;
const CLAIM_TEXT_PREFIX = 'NFH:';
/** Nimiq account type: 0 basic, 1 vesting, 2 HTLC. Nimiq Pay routes claims
 * through swap HTLCs, so a Pay-originated claim tx's sender is often an
 * HTLC contract with this type, not the user's own address. */
export const HTLC_ACCOUNT_TYPE = 2;
function hexToBytes(hex) {
    const clean = hex.trim().replace(/^0x/, '');
    if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean))
        return null;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}
function bytesToAscii(bytes) {
    return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}
function isHexDigitsString(s) {
    return s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}
function parseClaimPayload(payload) {
    if (payload.length < 4 ||
        payload[0] !== CLAIM_MAGIC0 ||
        payload[1] !== CLAIM_MAGIC1 ||
        payload[2] !== CLAIM_VERSION ||
        payload[3] !== CLAIM_TYPE_PROFILE) {
        return null;
    }
    let rest = payload.slice(4);
    const zeroIdx = rest.indexOf(0);
    if (zeroIdx >= 0)
        rest = rest.slice(0, zeroIdx);
    const handle = bytesToAscii(rest);
    return isValidHandle(handle) ? { handle } : null;
}
function parseClaimDataFromRaw(raw) {
    const text = bytesToAscii(raw);
    if (text.startsWith(CLAIM_TEXT_PREFIX)) {
        const inner = hexToBytes(text.slice(CLAIM_TEXT_PREFIX.length));
        return inner ? parseClaimPayload(inner) : null;
    }
    return parseClaimPayload(raw);
}
/**
 * Parses a transaction's hex data field into a claimed handle, or null if
 * it's not a claim (e.g. a post/follow on the same shared registry address).
 * Accepts the raw binary form (Nimiq Hub), the "NFH:" text envelope (Nimiq
 * Pay), and Nimiq Pay's double-hex-encoded variant. Mirrors
 * backend/handles.go's parseClaimData byte-for-byte.
 */
export function parseClaimTxData(dataHex) {
    const raw = hexToBytes(dataHex);
    if (!raw)
        return null;
    const direct = parseClaimDataFromRaw(raw);
    if (direct)
        return direct;
    const ascii = bytesToAscii(raw);
    if (isHexDigitsString(ascii)) {
        const inner = hexToBytes(ascii);
        if (inner)
            return parseClaimDataFromRaw(inner);
    }
    return null;
}
/**
 * Decodes an HTLC contract's real owner from its creation transaction's data
 * field (owner address is the first 20 bytes). Use this to build
 * `resolveHtlcOwner` from your own RPC's creation-tx lookup when a live
 * account query doesn't have the owner (e.g. the contract was pruned).
 * Mirrors backend/handles.go's htlcOwnerFromCreationData.
 */
export function ownerFromHtlcCreationData(dataHex) {
    const raw = hexToBytes(dataHex);
    if (!raw || raw.length < 40)
        return null;
    return userFriendlyAddress(raw.slice(0, 20));
}
async function claimantAddress(tx, resolveHtlcOwner, cache) {
    if (tx.fromType !== HTLC_ACCOUNT_TYPE)
        return tx.sender;
    if (!cache.has(tx.sender)) {
        cache.set(tx.sender, resolveHtlcOwner ? await resolveHtlcOwner(tx.sender) : null);
    }
    return cache.get(tx.sender) || tx.sender;
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
export async function resolveHandleRegistry(txs, options = {}) {
    const ordered = [...txs].sort((a, b) => a.blockHeight !== b.blockHeight ? a.blockHeight - b.blockHeight : a.txIndex - b.txIndex);
    const registry = new Map();
    const htlcOwnerCache = new Map();
    for (const tx of ordered) {
        const action = parseClaimTxData(tx.data);
        if (!action || registry.has(action.handle))
            continue;
        registry.set(action.handle, {
            handle: action.handle,
            address: await claimantAddress(tx, options.resolveHtlcOwner, htlcOwnerCache),
            txHash: tx.hash,
            blockHeight: tx.blockHeight,
            txIndex: tx.txIndex,
        });
    }
    return registry;
}
/** Reverse lookup: the earliest handle claimed by an address, or null. */
export function resolveHandleByAddress(registry, address) {
    let best = null;
    for (const claim of registry.values()) {
        if (compactAddress(claim.address) !== compactAddress(address))
            continue;
        if (!best ||
            claim.blockHeight < best.blockHeight ||
            (claim.blockHeight === best.blockHeight && claim.txIndex < best.txIndex)) {
            best = claim;
        }
    }
    return best;
}
/** Format-valid and not already claimed in the given registry snapshot. */
export function isHandleAvailable(registry, handle) {
    return isValidHandle(handle) && !registry.has(handle);
}
