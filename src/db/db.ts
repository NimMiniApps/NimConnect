import Dexie, { type Table } from 'dexie'
import type { Profile } from '../types/profile'

class NimConnectDB extends Dexie {
  profiles!: Table<Profile, string>

  constructor() {
    super('nimconnect')
    // Future fields = new this.version(n).stores(...) migrations, never a meta blob.
    this.version(1).stores({
      profiles: 'id, &address',
    })
  }
}

export const db = new NimConnectDB()
