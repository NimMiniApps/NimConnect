import Dexie, { type Table } from 'dexie'
import type { Invoice, Profile } from '../types/profile'

class NimConnectDB extends Dexie {
  profiles!: Table<Profile, string>
  invoices!: Table<Invoice, string>

  constructor() {
    super('nimconnect')
    // Future fields = new this.version(n).stores(...) migrations, never a meta blob.
    this.version(1).stores({
      profiles: 'id, &address',
    })
    this.version(2).stores({
      profiles: 'id, &address',
      invoices: 'id, address, status',
    })
  }
}

export const db = new NimConnectDB()
