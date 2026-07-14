import { describe, it, expect } from 'vitest'
import {
  isValidHandle,
  makeClaimPayload,
  buildProfilePutMessage,
  buildProfileDeleteMessage,
  profilePayloadHash,
  profileToPublicPayload,
} from './handles'
import type { Profile } from '../types/profile'

const profile: Profile = {
  id: '1', address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
  name: 'Chuck', type: 'person', isSelf: true, notes: 'PRIVATE',
  tags: ['friend', 'dev'], favorite: false, createdAt: 1, updatedAt: 1,
  bio: 'Nimiq builder', website: 'https://chuck.example', github: 'chuck', x: 'chuck_x',
}

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
    // echo -n 'hello' | sha256sum
    expect(profilePayloadHash('hello'))
      .toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
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
