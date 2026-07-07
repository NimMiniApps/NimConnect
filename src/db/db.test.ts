import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import type { Profile } from '../types/profile'

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: crypto.randomUUID(),
    address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    name: 'Alice',
    type: 'person',
    isSelf: false,
    notes: '',
    tags: [],
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  }
}

describe('db', () => {
  beforeEach(async () => {
    await db.profiles.clear()
  })

  it('stores and retrieves a profile', async () => {
    const p = makeProfile()
    await db.profiles.add(p)
    expect(await db.profiles.get(p.id)).toEqual(p)
  })

  it('rejects duplicate addresses via unique index', async () => {
    await db.profiles.add(makeProfile())
    await expect(db.profiles.add(makeProfile())).rejects.toThrow()
  })
})
