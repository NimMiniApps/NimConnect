import { describe, it, expect } from 'vitest';
import { userFriendlyAddress } from './nimiqAddress.js';
describe('userFriendlyAddress', () => {
    it('encodes 20 raw bytes into the matching NQ address', () => {
        // First 20 bytes of the real mainnet HTLC creation data used in
        // backend/handles_test.go's TestHTLCOwnerFromCreationData — same fixture,
        // so this fails if the base32/IBAN-check port ever drifts from Go.
        const dataHex = '91c5d65cbf079159b61d72bfca4ff1f5fd063227a70b9e44a448b5183ac4e186cd749d3d889fff840100000000000000000000000000000000000000';
        const raw = dataHex.match(/../g).map((b) => parseInt(b, 16));
        const ownerBytes = new Uint8Array(raw.slice(0, 20));
        expect(userFriendlyAddress(ownerBytes)).toBe('NQ34 J72V CP5Y 0X8M KDGV EAYU LKYH XPXG CCH7');
    });
    it('returns null for the wrong byte length', () => {
        expect(userFriendlyAddress(new Uint8Array(19))).toBeNull();
    });
});
