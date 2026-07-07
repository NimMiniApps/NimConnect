export type ProfileType = 'person' | 'business' | 'merchant' | 'other'

export interface Profile {
  id: string
  /** Normalized NQ address, unique */
  address: string
  name: string
  type: ProfileType
  /** Exactly one record is the user's own profile */
  isSelf: boolean
  notes: string
  tags: string[]
  favorite: boolean
  createdAt: number
  updatedAt: number
  /** Set by Send/Request/History; powers the Recent section */
  lastInteractionAt?: number
  // Identity fields — optional, unindexed, so no Dexie migration needed
  bio?: string
  website?: string
  github?: string
  /** X / Twitter handle without @ */
  x?: string
}

export type InvoiceStatus = 'pending' | 'paid'

export interface Invoice {
  id: string
  /** Normalized NQ address of the payer — survives profile re-import/deletion */
  address: string
  amountNim: number
  description: string
  status: InvoiceStatus
  createdAt: number
  paidAt?: number
  /** Original fiat entry when the invoice was priced in fiat (converted to NIM at creation) */
  fiatAmount?: number
  fiatCurrency?: string
}

export interface ExportDocument {
  app: 'NimConnect'
  /** v1 exports had profiles only; v2 adds invoices */
  version: 1 | 2
  exportedAt: number
  profiles: Profile[]
  invoices?: Invoice[]
}
