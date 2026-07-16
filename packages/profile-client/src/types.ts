/** Flat JSON object shape stored/returned by `GET /api/profile/{address}`. */
export interface PublicProfileFields {
  display_name?: string
  bio?: string
  website?: string
  github?: string
  x?: string
  tags?: string[]
}

/** Parsed response for `GET /api/profile/{address}`. */
export interface StoredPublicProfile {
  address: string
  updatedAt: number
  profile: PublicProfileFields
}

/** Handle claim, as returned by `GET /api/resolve/{handle}` and `GET /api/handles/by-address/{address}`. */
export interface HandleClaim {
  handle: string
  address: string
  txHash: string
  blockHeight: number
  txIndex: number
}

/** Normalized identity merging handle + public profile for display purposes. */
export interface DisplayIdentity {
  address: string
  handle?: string
  displayName?: string
  bio?: string
  links?: {
    website?: string
    github?: string
    x?: string
  }
}

export interface ProfileClientOptions {
  baseUrl: string
}
