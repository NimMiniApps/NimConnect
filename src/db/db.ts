import Dexie, { type Table } from 'dexie'
import type { Invoice, Profile, InboxItem, KvEntry, Bucket } from '../types/profile'

class NimConnectDB extends Dexie {
  profiles!: Table<Profile, string>
  invoices!: Table<Invoice, string>
  inboxItems!: Table<InboxItem, string>
  kv!: Table<KvEntry, string>
  buckets!: Table<Bucket, string>

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
    this.version(4).stores({
      profiles: 'id, &address',
      invoices: 'id, address, status',
      inboxItems: 'id, objectId, sender, status',
      kv: 'key',
      buckets: 'id, status',
    })
  }
}

export const db = new NimConnectDB()
