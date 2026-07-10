import Dexie, { type Table } from 'dexie'
import type { Invoice, Profile, InboxItem, KvEntry } from '../types/profile'

class NimConnectDB extends Dexie {
  profiles!: Table<Profile, string>
  invoices!: Table<Invoice, string>
  inboxItems!: Table<InboxItem, string>
  kv!: Table<KvEntry, string>

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
    this.version(3).stores({
      profiles: 'id, &address',
      invoices: 'id, address, status',
      inboxItems: 'id, objectId, sender, status',
      kv: 'key',
    })
  }
}

export const db = new NimConnectDB()
