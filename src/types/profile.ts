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
  /** Claimed NimConnect / NimFeed @handle without @ — preferred over address in lists */
  handle?: string
  bio?: string
  website?: string
  github?: string
  /** X / Twitter handle without @ */
  x?: string
  /** Per-field visibility on /@handle — only used on the self profile. */
  publicShare?: PublicShareSelection
}

/** Fields that can appear on the public profile page (mirrors handles.ShareSelection). */
export interface PublicShareSelection {
  name: boolean
  bio: boolean
  website: boolean
  github: boolean
  x: boolean
  tags: boolean
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
  /** Optional due date (end of day, ms). Unindexed — no Dexie migration needed */
  dueAt?: number
  /** Original fiat entry when the invoice was priced in fiat (converted to NIM at creation) */
  fiatAmount?: number
  fiatCurrency?: string
  /** Recreate as a new pending invoice when this one is paid. Unindexed — no Dexie migration needed */
  repeat?: 'weekly' | 'monthly'
  /** Id of the successor created when a repeating invoice was paid — guards against duplicates */
  successorInvoiceId?: string
}

export type BucketStatus = 'active' | 'completed'

/** One entry in a bucket's contribution ledger — persisted, never recomputed from history. */
export interface BucketContribution {
  id: string
  /** 'chain' = auto-detected tagged payment; 'manual' = organizer adjustment, never deduped */
  source: 'chain' | 'manual'
  amountNim: number
  /** Normalized NQ sender address when known */
  sender?: string
  /** Set for source 'chain' — dedupe key against re-detection */
  txHash?: string
  /** Manual entries: free-text label / contact name */
  note?: string
  at: number
}

/** Shared savings goal. Funds land in the organizer's own wallet; contributions are
 * identified by a tag in the payment message, not by address balance. */
export interface Bucket {
  id: string
  name: string
  goalNim: number
  /** Original fiat entry when the goal was priced in fiat (converted to NIM at creation) */
  fiatGoal?: number
  fiatCurrency?: string
  status: BucketStatus
  createdAt: number
  completedAt?: number
  contributions: BucketContribution[]
}

export interface ExportDocument {
  app: 'NimConnect'
  /** v1 exports had profiles only; v2 adds invoices; v3 adds buckets */
  version: 1 | 2 | 3
  exportedAt: number
  profiles: Profile[]
  invoices?: Invoice[]
  buckets?: Bucket[]
}

export interface EncryptedBackup {
  app: 'NimConnect'
  format: 'encrypted-backup'
  version: 1
  /** Normalized NQ address — metadata only, not secret */
  address?: string
  salt: string
  exportedAt: number
  ciphertext: string
}

export type InboxImportStatus = 'actionable' | 'unsupported' | 'invalid' | 'dismissed' | 'paid'

/** A message imported from the server mailbox. Local copy is the source of truth. */
export interface InboxItem {
  /** Server message id (delivery attempt) */
  id: string
  /** Stable logical id of the invoice/split/request — reminders reuse it */
  objectId: string
  /** Envelope type, e.g. 'payment-request'; unknown types stay 'unsupported' */
  type: string
  /** Normalized NQ address of the signed sender */
  sender: string
  payload: string
  sentAt: number
  receivedAt: number
  status: InboxImportStatus
  importedAt: number
  /** Number of times a reminder re-delivered this objectId */
  reminders: number
}

export interface KvEntry {
  key: string
  value: unknown
}
