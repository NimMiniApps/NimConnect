// Ports backend/address.go's userFriendlyAddress (raw 20 bytes -> "NQ.." IBAN-style
// address) so the HTLC-owner decoding below doesn't need a Nimiq crypto library.
// Keep in sync with that file.

const NIMIQ_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

function toBase32(bytes: Uint8Array): string {
  let shift = 3
  let carry = 0
  let res = ''

  for (const b of bytes) {
    let symbol = carry | (b >> shift)
    res += NIMIQ_ALPHABET[symbol & 0x1f]

    if (shift > 5) {
      shift -= 5
      symbol = b >> shift
      res += NIMIQ_ALPHABET[symbol & 0x1f]
    }

    shift = 5 - shift
    carry = b << shift
    shift = 8 - shift
  }

  if (shift !== 3) {
    res += NIMIQ_ALPHABET[carry & 0x1f]
  }
  return res
}

// IBAN-style mod-97 check over a decimal digit string built by mapping
// letters to two-digit codes (A=10..Z=35), processed in 6-digit windows so
// it never needs a value larger than a normal JS number can hold exactly.
function ibanMod97(str: string): number {
  let digits = ''
  for (const c of str.toUpperCase()) {
    digits += c >= '0' && c <= '9' ? c : String(c.charCodeAt(0) - 55)
  }
  let carry = ''
  for (let i = 0; i < digits.length; i += 6) {
    const chunk = carry + digits.slice(i, Math.min(i + 6, digits.length))
    carry = String(parseInt(chunk, 10) % 97)
  }
  return parseInt(carry, 10)
}

function normalizeAddressFormat(address: string): string {
  const compact = address.replace(/\s+/g, '').toUpperCase()
  const groups: string[] = []
  for (let i = 0; i < compact.length; i += 4) groups.push(compact.slice(i, i + 4))
  return groups.join(' ')
}

/** Encodes 20 raw address bytes into a spaced "NQ.." address, or null if the length is wrong. */
export function userFriendlyAddress(addrBytes: Uint8Array): string | null {
  if (addrBytes.length !== 20) return null
  const base32 = toBase32(addrBytes)
  const check = String(98 - ibanMod97(base32 + 'NQ00')).padStart(2, '0')
  return normalizeAddressFormat('NQ' + check + base32)
}
