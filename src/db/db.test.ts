import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import type { Profile } from '../types/profile'
import { uuid } from '../utils/uuid'

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: uuid(),
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
    await db.inboxItems?.clear()
    await db.kv?.clear()
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

  it('stores and indexes inbox items', async () => {
    await db.inboxItems.add({
      id: 'm1', objectId: 'inv-1', type: 'payment-request',
      sender: 'NQ11 TEST', payload: 'nimiq:X', sentAt: 1, receivedAt: 2,
      status: 'actionable', importedAt: 3, reminders: 0,
    })
    expect(await db.inboxItems.where('objectId').equals('inv-1').count()).toBe(1)
    await db.kv.put({ key: 'k', value: { a: 1 } })
    expect((await db.kv.get('k'))?.value).toEqual({ a: 1 })
  })
})
