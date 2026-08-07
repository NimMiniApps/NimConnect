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

export type SignMessageFn = (message: string) => Promise<{
  publicKey: string
  signature: string
}>

export type AuthScope =
  | 'friends:read' | 'friends:write'
  | 'inbox:read' | 'inbox:send' | 'inbox:delete'
  | 'profile:write'
  | 'backup:read' | 'backup:write'
  | 'marketplace:read' | 'marketplace:trade'
  | 'achievements:read'

/** Live grant returned by `GET /api/authorizations` (first-party session). */
export interface AppAuthorization {
  audience: string
  displayName: string
  iconUrl: string
  verified: boolean
  scopes: AuthScope[]
  grantedAt: number
  expiresAt: number
}

/** Achievement returned by `GET /api/profiles/{address}/achievements`. */
export interface Achievement {
  appId: string
  achievementId: string
  address: string
  title: string
  description: string
  rarity: string
  visibility: 'public' | 'private'
  grantedAt: number
  progress?: unknown
}

/** Mirrored catalog app identity from `GET /api/apps/{audience}`. */
export interface RegisteredApp {
  audience: string
  displayName: string
  iconUrl: string
  verified: boolean
  scopes: AuthScope[]
  origins: string[]
}

export interface AuthorizationChallenge {
  challengeId: string
  message: string
  address: string
  audience: string
  scopes: AuthScope[]
  expiresAt: number
}

export interface AuthSession {
  token: string
  address: string
  audience: string
  scopes: AuthScope[]
  expiresAt: number
}

export interface FriendEntry {
  address: string
  handle?: string
  displayName?: string
  status: 'accepted' | 'pending_out' | 'pending_in'
  friendshipId: string
}

export interface ProfileClientOptions {
  /** Defaults to the production NimConnect origin when omitted. */
  baseUrl?: string
  /** Optional pre-existing `X-NimConnect-Session` token. */
  sessionToken?: string | null
  /** Optional persisted v3 scoped authorization grant. */
  authorization?: AuthSession | null
  /**
   * App slug bound into the session challenge (e.g. `nimworld`).
   * When set, `createSession` signs the v2 message and posts `audience`.
   * When omitted, keeps the v1 challenge for 0.6.x compatibility.
   */
  audience?: string
}

/** Recipient + tx data for claiming a @handle — sign and send with your own wallet integration. */
export interface HandleClaimPayload {
  recipient: string
  /** "NFH:" + hex envelope — for wallets that only accept text extraData (e.g. Nimiq Pay). */
  extraData: string
  /** Raw binary payload — for wallets that accept binary extraData directly (e.g. Nimiq Hub). */
  extraDataBytes: Uint8Array
}
