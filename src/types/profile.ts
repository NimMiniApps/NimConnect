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
}

export interface ExportDocument {
  app: 'NimConnect'
  version: 1
  exportedAt: number
  profiles: Profile[]
}
