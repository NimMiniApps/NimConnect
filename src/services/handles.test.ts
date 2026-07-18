import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isValidHandle,
  makeClaimPayload,
  buildProfilePutMessage,
  buildProfileDeleteMessage,
  profilePayloadHash,
  profileToPublicPayload,
  shareFromPublished,
  shareSelectionForProfile,
  publicProfileNeedsSync,
  claimOwnerAddress,
  hasAnyPublicShare,
  defaultShareSelection,
  publishProfile,
  unpublishProfile,
  claimHandleViaHub,
  type HandleClaim,
} from './handles'
import type { Profile } from '../types/profile'

const claimHandleWithHub = vi.fn()
vi.mock('./hub', () => ({
  claimHandleWithHub: (...args: unknown[]) => claimHandleWithHub(...args),
}))

const profile: Profile = {
  id: '1', address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
  name: 'Chuck', type: 'person', isSelf: true, notes: 'PRIVATE',
  tags: ['friend', 'dev'], favorite: false, createdAt: 1, updatedAt: 1,
  bio: 'Nimiq builder', website: 'https://chuck.example', github: 'chuck', x: 'chuck_x',
}

describe('claimOwnerAddress', () => {
  it('uses the owner wallet when the claim sender is an HTLC contract', () => {
    const claim: HandleClaim = {
      handle: 'androiddev',
      address: 'NQ03 064C F89U 6LT7 6PDT R1PJ XJ99 368N 1LKH',
      owner_address: 'NQ23 AS8D J6RE V397 3QXH 2UEG T6V1 L11M 2579',
      tx_hash: 'abc',
      block_height: 1,
      tx_index: 0,
    }
    expect(claimOwnerAddress(claim)).toBe('NQ23 AS8D J6RE V397 3QXH 2UEG T6V1 L11M 2579')
  })
})

describe('handles', () => {
  it('validates handles like the backend', () => {
    expect(isValidHandle('chuck')).toBe(true)
    expect(isValidHandle('a_1')).toBe(true)
    expect(isValidHandle('Chuck')).toBe(false)
    expect(isValidHandle('ab')).toBe(false)
    expect(isValidHandle('x'.repeat(31))).toBe(true) // NimFeed max
    expect(isValidHandle('x'.repeat(32))).toBe(false)
  })

  it('builds claim payloads within Nimiq Pay text limit', () => {
    // "NF" 0x01 0x01 + "chuck", hex-encoded in the NFH envelope.
    expect(makeClaimPayload('chuck')).toBe('NFH:4e460101636875636b')
    expect(makeClaimPayload('x'.repeat(26)).length).toBeLessThanOrEqual(64)
  })

  it('builds canonical messages byte-matching the backend', () => {
    expect(buildProfilePutMessage(profile.address, 1000, 'abc')).toBe(
      'nimconnect:profile:v1'
      + '\naddress=NQ0700000000000000000000000000000000'
      + '\nupdatedAt=1000'
      + '\npayloadHash=abc',
    )
    expect(buildProfileDeleteMessage(profile.address, 1000)).toBe(
      'nimconnect:profile-delete:v1'
      + '\naddress=NQ0700000000000000000000000000000000'
      + '\nupdatedAt=1000',
    )
  })

  it('hashes payloads as sha256 hex (matches Go sha256Hex)', () => {
    expect(profilePayloadHash('hello'))
      .toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('derives share toggles from a published profile', () => {
    expect(shareFromPublished(null)).toEqual(defaultShareSelection())
    expect(shareFromPublished({ display_name: 'Chuck', bio: 'hi' })).toMatchObject({
      name: true, bio: true, website: false,
    })
  })

  it('opts in filled profile fields by default', () => {
    expect(shareSelectionForProfile(profile)).toEqual({
      name: true, bio: true, website: true, github: true, x: true, tags: true,
    })
  })

  it('detects when the server copy is stale', () => {
    const share = shareSelectionForProfile(profile)
    expect(publicProfileNeedsSync(profile, share, null)).toBe(true)
    expect(publicProfileNeedsSync(profile, share, { display_name: 'Chuck' })).toBe(true)
    expect(publicProfileNeedsSync(profile, share, {
      display_name: 'Chuck', bio: 'Nimiq builder', website: 'https://chuck.example',
      github: 'chuck', x: 'chuck_x', tags: ['friend', 'dev'],
    })).toBe(false)
  })

  it('detects when nothing is public', () => {
    expect(hasAnyPublicShare(defaultShareSelection())).toBe(true)
    expect(hasAnyPublicShare({
      name: false, bio: false, website: false, github: false, x: false, tags: false,
    })).toBe(false)
  })

  it('only includes opted-in fields — never notes', () => {
    const all = JSON.parse(profileToPublicPayload(profile, {
      name: true, bio: true, website: true, github: true, x: true, tags: true,
    }))
    expect(all).toEqual({
      display_name: 'Chuck', bio: 'Nimiq builder', website: 'https://chuck.example',
      github: 'chuck', x: 'chuck_x', tags: ['friend', 'dev'],
    })

    const minimal = JSON.parse(profileToPublicPayload(profile, {
      name: true, bio: false, website: false, github: false, x: false, tags: false,
    }))
    expect(minimal).toEqual({ display_name: 'Chuck' })
    expect(profileToPublicPayload(profile, {
      name: true, bio: true, website: true, github: true, x: true, tags: true,
    })).not.toContain('PRIVATE')
  })
})

describe('publishProfile / unpublishProfile with injected signer', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('publishes using the injected signer instead of Pay signChallenge', async () => {
    const sign = vi.fn().mockResolvedValue({ publicKey: 'pub', signature: 'sig' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await publishProfile(profile, { ...defaultShareSelection(), name: true }, sign)

    expect(sign).toHaveBeenCalledWith(expect.stringContaining('nimconnect:profile:v1'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/profile/')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({ public_key: 'pub', signature: 'sig' })
  })

  it('unpublishes using the injected signer instead of Pay signChallenge', async () => {
    const sign = vi.fn().mockResolvedValue({ publicKey: 'pub2', signature: 'sig2' })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await unpublishProfile(profile.address, sign)

    expect(sign).toHaveBeenCalledWith(expect.stringContaining('nimconnect:profile-delete:v1'))
    const [, init] = fetchMock.mock.calls[0]!
    expect((init as RequestInit).headers).toMatchObject({
      'X-Profile-Public-Key': 'pub2',
      'X-Profile-Signature': 'sig2',
    })
  })
})

describe('claimHandleViaHub', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    claimHandleWithHub.mockReset()
  })

  it('claims via Hub checkout and reports indexed status', async () => {
    claimHandleWithHub.mockResolvedValue({ txHash: 'hub-tx-1' })
    const claim: HandleClaim = {
      handle: 'chuck', address: 'NQ01 TEST', tx_hash: 'hub-tx-1', block_height: 1, tx_index: 0,
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'indexed', claim }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await claimHandleViaHub('chuck', 'NQ01 TEST')

    expect(claimHandleWithHub).toHaveBeenCalledWith('chuck', 'NQ01 TEST')
    expect(result).toEqual({ status: 'indexed', txHash: 'hub-tx-1', claim })
  })

  it('falls back to pending when the indexer call fails', async () => {
    claimHandleWithHub.mockResolvedValue({ txHash: 'hub-tx-2' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const result = await claimHandleViaHub('chuck', 'NQ01 TEST')

    expect(result).toEqual({ status: 'pending', txHash: 'hub-tx-2' })
  })

  it('rejects invalid handles without touching the Hub', async () => {
    await expect(claimHandleViaHub('AB', 'NQ01 TEST')).rejects.toThrow('Invalid handle')
    expect(claimHandleWithHub).not.toHaveBeenCalled()
  })
})
