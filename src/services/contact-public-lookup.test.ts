import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearContactPublicLookupCache,
  formatContactSuggestionLabel,
  lookupContactByAddress,
  lookupContactByHandle,
  lookupContactPublicIdentity,
  planEmptyPublicImports,
} from './contact-public-lookup'

const mocks = vi.hoisted(() => ({
  handlesEnabled: vi.fn(() => true),
  handleForAddress: vi.fn(),
  resolveHandleEnriched: vi.fn(),
  fetchPublicProfile: vi.fn(),
}))

vi.mock('./handles', async importOriginal => {
  const actual = await importOriginal<typeof import('./handles')>()
  return {
    ...actual,
    handlesEnabled: mocks.handlesEnabled,
    handleForAddress: mocks.handleForAddress,
    resolveHandleEnriched: mocks.resolveHandleEnriched,
    fetchPublicProfile: mocks.fetchPublicProfile,
  }
})

const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'

describe('contact-public-lookup', () => {
  beforeEach(() => {
    clearContactPublicLookupCache()
    mocks.handlesEnabled.mockReturnValue(true)
    mocks.handleForAddress.mockReset()
    mocks.resolveHandleEnriched.mockReset()
    mocks.fetchPublicProfile.mockReset()
  })

  it('resolves an address to handle + public profile fields', async () => {
    mocks.handleForAddress.mockResolvedValue({
      handle: 'alice',
      address,
      tx_hash: 'tx',
      block_height: 1,
      tx_index: 0,
    })
    mocks.fetchPublicProfile.mockResolvedValue({
      updatedAt: 1,
      profile: {
        display_name: 'Alice',
        bio: 'Builder',
        website: 'https://alice.example',
        github: 'alice',
        x: 'alice',
        tags: ['dev'],
      },
    })

    const result = await lookupContactByAddress(address)
    expect(result).toEqual({
      status: 'found',
      suggestion: {
        address: ValidationUtils.normalizeAddress(address),
        handle: 'alice',
        verified: true,
        displayName: 'Alice',
        bio: 'Builder',
        website: 'https://alice.example',
        github: 'alice',
        x: 'alice',
        tags: ['dev'],
      },
    })
    expect(formatContactSuggestionLabel(result.status === 'found' ? result.suggestion : null!))
      .toBe('@alice · Alice')
  })

  it('plans imports for empty fields only and never touches notes-like data', () => {
    const suggestion = {
      address: ValidationUtils.normalizeAddress(address),
      handle: 'alice',
      verified: true,
      displayName: 'Alice',
      bio: 'Builder',
      website: 'https://alice.example',
      github: 'alice',
      x: 'alice_x',
      tags: ['dev'],
    }
    const plan = planEmptyPublicImports(suggestion, {
      name: 'Already set',
      bio: '',
      website: '',
      github: 'mine',
      x: '',
      tags: [],
    })
    expect(plan.patch).toEqual({
      bio: 'Builder',
      website: 'https://alice.example',
      x: 'alice_x',
      tags: ['dev'],
    })
    expect(plan.fields).toEqual(['bio', 'website', 'x', 'tags'])
    expect(plan.labels).toEqual([
      'Avatar', 'Handle', 'Verified', 'Bio', 'Website', 'X', 'Tags',
    ])
  })

  it('returns not_found when address has no handle or public fields', async () => {
    mocks.handleForAddress.mockResolvedValue(null)
    mocks.fetchPublicProfile.mockResolvedValue(null)
    await expect(lookupContactByAddress(address)).resolves.toEqual({ status: 'not_found' })
  })

  it('returns unavailable on network errors without caching the failure', async () => {
    mocks.handleForAddress.mockRejectedValue(new Error('network'))
    await expect(lookupContactByAddress(address)).resolves.toEqual({ status: 'unavailable' })

    mocks.handleForAddress.mockResolvedValue({
      handle: 'alice', address, tx_hash: 'tx', block_height: 1, tx_index: 0,
    })
    mocks.fetchPublicProfile.mockResolvedValue({ updatedAt: 1, profile: { display_name: 'Alice' } })
    await expect(lookupContactByAddress(address)).resolves.toMatchObject({ status: 'found' })
  })

  it('caches successful address lookups', async () => {
    mocks.handleForAddress.mockResolvedValue({
      handle: 'alice', address, tx_hash: 'tx', block_height: 1, tx_index: 0,
    })
    mocks.fetchPublicProfile.mockResolvedValue({ updatedAt: 1, profile: {} })

    await lookupContactByAddress(address)
    await lookupContactByAddress(address)
    expect(mocks.handleForAddress).toHaveBeenCalledTimes(1)
  })

  it('resolves @handle to owner address and public profile', async () => {
    mocks.resolveHandleEnriched.mockResolvedValue({
      handle: 'alice',
      address: 'NQ03 064C F89U 6LT7 6PDT R1PJ XJ99 368N 1LKH',
      owner_address: address,
      tx_hash: 'tx',
      block_height: 1,
      tx_index: 0,
    })
    mocks.fetchPublicProfile.mockResolvedValue({
      updatedAt: 1,
      profile: { display_name: 'Alice' },
    })

    const result = await lookupContactByHandle('alice')
    expect(result.status).toBe('found')
    if (result.status !== 'found') return
    expect(result.suggestion.address).toBe(ValidationUtils.normalizeAddress(address))
    expect(result.suggestion.handle).toBe('alice')
    expect(mocks.fetchPublicProfile).toHaveBeenCalledWith(address)
  })

  it('routes identity lookup by address or handle', async () => {
    mocks.handleForAddress.mockResolvedValue(null)
    mocks.fetchPublicProfile.mockResolvedValue(null)
    await lookupContactPublicIdentity(address)
    expect(mocks.handleForAddress).toHaveBeenCalled()

    mocks.resolveHandleEnriched.mockResolvedValue(null)
    await expect(lookupContactPublicIdentity('@alice')).resolves.toEqual({ status: 'not_found' })
    expect(mocks.resolveHandleEnriched).toHaveBeenCalledWith('alice')
  })

  it('skips the network when handles are disabled', async () => {
    mocks.handlesEnabled.mockReturnValue(false)
    await expect(lookupContactByAddress(address)).resolves.toEqual({ status: 'unavailable' })
    expect(mocks.handleForAddress).not.toHaveBeenCalled()
  })
})
