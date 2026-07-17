import { describe, it, expect } from 'vitest';
import { buildHandleClaimPayload, isValidHandle, HANDLE_REGISTRY_ADDRESS } from './claim.js';
describe('isValidHandle', () => {
    it('accepts 3-31 char lowercase/digit/underscore handles', () => {
        expect(isValidHandle('chuck')).toBe(true);
        expect(isValidHandle('free_one')).toBe(true);
        expect(isValidHandle('a'.repeat(31))).toBe(true);
    });
    it('rejects too short, too long, or invalid chars', () => {
        expect(isValidHandle('ab')).toBe(false);
        expect(isValidHandle('a'.repeat(32))).toBe(false);
        expect(isValidHandle('Chuck')).toBe(false);
        expect(isValidHandle('chuck!')).toBe(false);
    });
});
describe('buildHandleClaimPayload', () => {
    it('targets the shared registry address', () => {
        const { recipient } = buildHandleClaimPayload('chuck');
        expect(recipient).toBe(HANDLE_REGISTRY_ADDRESS);
    });
    it('encodes "NF" + version 0x01 + type 0x01 + handle bytes as the NFH: hex envelope', () => {
        // Mirrors backend/handles.go's makeClaimPayload — decode independently
        // here so this test fails if the two implementations ever drift.
        const { extraData } = buildHandleClaimPayload('chuck');
        expect(extraData.startsWith('NFH:')).toBe(true);
        const payloadHex = extraData.slice('NFH:'.length);
        const bytes = payloadHex.match(/../g).map((b) => parseInt(b, 16));
        expect(bytes.slice(0, 4)).toEqual([0x4e, 0x46, 0x01, 0x01]);
        const handle = String.fromCharCode(...bytes.slice(4));
        expect(handle).toBe('chuck');
    });
    it('throws on an invalid handle', () => {
        expect(() => buildHandleClaimPayload('AB')).toThrow(/invalid handle/);
    });
    it('also returns the raw binary payload for wallets that accept binary extraData', () => {
        const { extraDataBytes } = buildHandleClaimPayload('chuck');
        expect(extraDataBytes).toBeInstanceOf(Uint8Array);
        expect(Array.from(extraDataBytes.slice(0, 4))).toEqual([0x4e, 0x46, 0x01, 0x01]);
        const handle = String.fromCharCode(...extraDataBytes.slice(4));
        expect(handle).toBe('chuck');
    });
});
