import { describe, it, expect } from 'vitest'
import { buildHandleClaimPayload } from './claim'
import {
  parseClaimTxData,
  resolveHandleRegistry,
  resolveHandleByAddress,
  isHandleAvailable,
  ownerFromHtlcCreationData,
  HTLC_ACCOUNT_TYPE,
  type RegistryTx,
} from './registry'

// The tx `data` field on chain is the hex-encoded raw bytes of the "NFH:..."
// text envelope — mirrors backend/handles_registry_test.go's claimTx helper.
function claimTx(hash: string, sender: string, handle: string, blockHeight: number, txIndex: number): RegistryTx {
  const { extraData } = buildHandleClaimPayload(handle)
  const data = Array.from(extraData, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  return { hash, sender, data, blockHeight, txIndex }
}

describe('parseClaimTxData', () => {
  it('parses the NFH text-envelope form', () => {
    const tx = claimTx('t1', 'NQ11 X', 'chuck', 1, 0)
    expect(parseClaimTxData(tx.data)).toEqual({ handle: 'chuck' })
  })

  it('returns null for unrelated tx data', () => {
    expect(parseClaimTxData('deadbeef')).toBeNull()
    expect(parseClaimTxData('not hex')).toBeNull()
  })
})

describe('resolveHandleRegistry', () => {
  it('earliest claim wins, sorted out of chain order', async () => {
    const registry = await resolveHandleRegistry([
      claimTx('t2', 'NQ22 LATE', 'chuck', 10, 0),
      claimTx('t1', 'NQ11 EARLY', 'chuck', 5, 3),
      claimTx('t3', 'NQ33 OTHER', 'alice', 10, 1),
    ])
    expect(registry.get('chuck')).toMatchObject({ address: 'NQ11 EARLY', txHash: 't1' })
    expect(registry.has('alice')).toBe(true)
  })

  it('same block orders by txIndex', async () => {
    const registry = await resolveHandleRegistry([
      claimTx('t2', 'NQ22 SECOND', 'chuck', 5, 7),
      claimTx('t1', 'NQ11 FIRST', 'chuck', 5, 2),
    ])
    expect(registry.get('chuck')?.txHash).toBe('t1')
  })

  it('claims are permanent — a later tx never displaces the owner', async () => {
    const registry = await resolveHandleRegistry([
      claimTx('t1', 'NQ11 OWNER', 'chuck', 5, 0),
      claimTx('t2', 'NQ22 THIEF', 'chuck', 800, 0),
    ])
    expect(registry.get('chuck')?.address).toBe('NQ11 OWNER')
  })

  it('skips non-claim transactions without throwing', async () => {
    const registry = await resolveHandleRegistry([
      { hash: 'junk', sender: 'NQ44', data: 'zznothex', blockHeight: 1, txIndex: 0 },
    ])
    expect(registry.size).toBe(0)
  })
})

describe('resolveHandleByAddress', () => {
  it('finds the handle owned by an address, spacing-insensitive', async () => {
    const registry = await resolveHandleRegistry([claimTx('t1', 'NQ11 OWNER', 'chuck', 5, 0)])
    expect(resolveHandleByAddress(registry, 'NQ11OWNER')?.handle).toBe('chuck')
    expect(resolveHandleByAddress(registry, 'NQ99 NOBODY')).toBeNull()
  })

  it('picks the earliest claim when an address holds multiple handles', async () => {
    const registry = await resolveHandleRegistry([
      claimTx('t1', 'NQ11 OWNER', 'second', 20, 0),
      claimTx('t2', 'NQ11 OWNER', 'first', 5, 0),
    ])
    expect(resolveHandleByAddress(registry, 'NQ11 OWNER')?.handle).toBe('first')
  })
})

describe('resolveHandleRegistry — Nimiq Pay HTLC attribution', () => {
  it('resolves an HTLC-routed claim to the wallet resolveHtlcOwner returns', async () => {
    const tx = claimTx('t1', 'NQ03 HTLC 0000', 'chuck', 5, 0)
    tx.fromType = HTLC_ACCOUNT_TYPE
    const resolveHtlcOwner = (contractAddress: string) =>
      contractAddress.replace(/\s+/g, '').toUpperCase() === 'NQ03HTLC0000'
        ? 'NQ23 AS8D J6RE V397 3QXH 2UEG T6V1 L11M 2579'
        : null
    const registry = await resolveHandleRegistry([tx], { resolveHtlcOwner })
    expect(registry.get('chuck')?.address).toBe('NQ23 AS8D J6RE V397 3QXH 2UEG T6V1 L11M 2579')
  })

  it('resolves via an async resolveHtlcOwner (e.g. backed by a real RPC call)', async () => {
    const tx = claimTx('t1', 'NQ03 HTLC 0000', 'chuck', 5, 0)
    tx.fromType = HTLC_ACCOUNT_TYPE
    const resolveHtlcOwner = async (contractAddress: string) => {
      await new Promise((r) => setTimeout(r, 0)) // simulate a network round-trip
      return contractAddress.replace(/\s+/g, '').toUpperCase() === 'NQ03HTLC0000' ? 'NQ23 ASYNC OWNER' : null
    }
    const registry = await resolveHandleRegistry([tx], { resolveHtlcOwner })
    expect(registry.get('chuck')?.address).toBe('NQ23 ASYNC OWNER')
  })

  it('calls resolveHtlcOwner at most once per distinct contract address', async () => {
    const calls: string[] = []
    const resolveHtlcOwner = (contractAddress: string) => {
      calls.push(contractAddress)
      return 'NQ23 OWNER'
    }
    await resolveHandleRegistry(
      [
        { ...claimTx('t1', 'NQ03 HTLC 0000', 'chuck', 5, 0), fromType: HTLC_ACCOUNT_TYPE },
        { ...claimTx('t2', 'NQ03 HTLC 0000', 'alice', 6, 0), fromType: HTLC_ACCOUNT_TYPE },
      ],
      { resolveHtlcOwner },
    )
    expect(calls).toEqual(['NQ03 HTLC 0000'])
  })

  it('passes basic (non-HTLC) senders through untouched', async () => {
    const tx = claimTx('t1', 'NQ11 OWNER', 'chuck', 5, 0)
    const registry = await resolveHandleRegistry([tx], { resolveHtlcOwner: () => 'should not be called' })
    expect(registry.get('chuck')?.address).toBe('NQ11 OWNER')
  })

  it('falls back to the raw sender when resolveHtlcOwner is unresolved or omitted', async () => {
    const tx = claimTx('t1', 'NQ03 OTHER HTLC', 'chuck', 5, 0)
    tx.fromType = HTLC_ACCOUNT_TYPE
    expect((await resolveHandleRegistry([tx], { resolveHtlcOwner: () => null })).get('chuck')?.address).toBe(
      'NQ03 OTHER HTLC',
    )
    expect((await resolveHandleRegistry([tx])).get('chuck')?.address).toBe('NQ03 OTHER HTLC')
  })
})

describe('ownerFromHtlcCreationData', () => {
  it('decodes the owner address from real mainnet creation data', () => {
    // Same fixture as backend/handles_test.go's TestHTLCOwnerFromCreationData.
    const data =
      '91c5d65cbf079159b61d72bfca4ff1f5fd063227a70b9e44a448b5183ac4e186cd749d3d889fff840100000000000000000000000000000000000000'
    expect(ownerFromHtlcCreationData(data)).toBe('NQ34 J72V CP5Y 0X8M KDGV EAYU LKYH XPXG CCH7')
  })

  it('returns null for malformed or too-short data', () => {
    expect(ownerFromHtlcCreationData('')).toBeNull()
    expect(ownerFromHtlcCreationData('zz')).toBeNull()
    expect(ownerFromHtlcCreationData('91c5d6')).toBeNull()
  })
})

describe('isHandleAvailable', () => {
  it('rejects taken handles and invalid formats, accepts free ones', async () => {
    const registry = await resolveHandleRegistry([claimTx('t1', 'NQ11 X', 'chuck', 5, 0)])
    expect(isHandleAvailable(registry, 'chuck')).toBe(false)
    expect(isHandleAvailable(registry, 'AB')).toBe(false)
    expect(isHandleAvailable(registry, 'free_one')).toBe(true)
  })
})
