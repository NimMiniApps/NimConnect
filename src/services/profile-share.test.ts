import { describe, it, expect } from 'vitest'
import type { Profile } from '../types/profile'
import {
  decodeSharedProfile,
  encodeSharedProfile,
  makeProfileShareLink,
  parseProfileShare,
  profileToSharePayload,
  sharedProfileToNewProfile,
} from './profile-share'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'

const sampleProfile: Profile = {
  id: 'id-1',
  address: A,
  name: 'Alice',
  type: 'person',
  isSelf: true,
  notes: 'private note',
  tags: ['coffee', 'meetup'],
  favorite: true,
  createdAt: 1,
  updatedAt: 1,
  bio: 'Builder on Nimiq',
  website: 'https://alice.example',
  github: 'alice',
  x: 'alice_nim',
}

describe('profile-share', () => {
  it('exports only public profile fields', () => {
    const payload = profileToSharePayload(sampleProfile)
    expect(payload).toEqual({
      v: 1,
      address: A,
      name: 'Alice',
      type: 'person',
      bio: 'Builder on Nimiq',
      website: 'https://alice.example',
      github: 'alice',
      x: 'alice_nim',
      tags: ['coffee', 'meetup'],
    })
    expect(payload).not.toHaveProperty('notes')
    expect(payload).not.toHaveProperty('favorite')
  })

  it('round-trips through base64 encoding', () => {
    const payload = profileToSharePayload(sampleProfile)
    const encoded = encodeSharedProfile(payload)
    const decoded = decodeSharedProfile(encoded)
    expect(decoded?.name).toBe(payload.name)
    expect(decoded?.address).toBe(payload.address)
    expect(decoded?.tags).toEqual(payload.tags)
    expect(decoded?.website).toBe('https://alice.example/')
  })

  it('builds and parses a profile share deep link', () => {
    const link = makeProfileShareLink(sampleProfile)
    expect(link).toContain('#/add?p=')
    const shared = parseProfileShare(link)
    expect(shared?.name).toBe('Alice')
    expect(shared?.address).toBe(A)
    expect(shared?.tags).toEqual(['coffee', 'meetup'])
  })

  it('rejects tampered payloads', () => {
    expect(decodeSharedProfile('not-valid-base64!!!')).toBeNull()
    const bad = encodeSharedProfile({ v: 1, address: 'bad', name: 'X', type: 'person', tags: [] } as never)
    expect(decodeSharedProfile(bad)).toBeNull()
  })

  it('maps shared profile to new contact input', () => {
    const payload = profileToSharePayload(sampleProfile)
    expect(sharedProfileToNewProfile(payload)).toEqual({
      name: 'Alice',
      address: A,
      type: 'person',
      tags: ['coffee', 'meetup'],
      bio: 'Builder on Nimiq',
      website: 'https://alice.example',
      github: 'alice',
      x: 'alice_nim',
    })
  })
})
