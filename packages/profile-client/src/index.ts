export { createProfileClient, compactAddress, DEFAULT_BASE_URL } from './client.js'
export type { ProfileClient } from './client.js'
export { buildHandleClaimPayload, isValidHandle, HANDLE_REGISTRY_ADDRESS } from './claim.js'
export {
  parseClaimTxData,
  resolveHandleRegistry,
  resolveHandleByAddress,
  isHandleAvailable,
  ownerFromHtlcCreationData,
  HTLC_ACCOUNT_TYPE,
} from './registry.js'
export type { RegistryTx, ResolvedHandleClaim, ResolveHandleRegistryOptions } from './registry.js'
export { userFriendlyAddress } from './nimiqAddress.js'
export { fetchHandleRegistry, DEFAULT_RPC_URL } from './rpc.js'
export type { FetchHandleRegistryOptions } from './rpc.js'
export type {
  PublicProfileFields,
  StoredPublicProfile,
  HandleClaim,
  DisplayIdentity,
  ProfileClientOptions,
  HandleClaimPayload,
} from './types.js'
