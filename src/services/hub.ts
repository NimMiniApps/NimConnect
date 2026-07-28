import HubApi from '@nimiq/hub-api'
import { buildHandleClaimPayload, buildHandleReleasePayload } from '@nimconnect/profile-client'

const APP_NAME = 'NimConnect'
const HUB_URL = import.meta.env.VITE_NIMIQ_HUB_URL ?? 'https://hub.nimiq.com'

let hub: HubApi | null = null

function getHub(): HubApi {
  if (!hub) hub = new HubApi(HUB_URL)
  return hub
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Account discovery — one address at a time. Not a login by itself. */
export async function chooseHubAddress(): Promise<string> {
  const info = await getHub().chooseAddress({ appName: APP_NAME })
  return info.address
}

export async function hubSignMessage(
  message: string,
  signer: string,
): Promise<{ publicKey: string; signature: string }> {
  const result = await getHub().signMessage({ appName: APP_NAME, message, signer })
  return {
    publicKey: toHex(result.signerPublicKey),
    signature: toHex(result.signature),
  }
}

export async function hubCheckoutClaim(opts: {
  recipient: string
  extraData: Uint8Array
  sender?: string
}): Promise<{ txHash: string }> {
  const signed = await getHub().checkout({
    appName: APP_NAME,
    recipient: opts.recipient,
    value: 0,
    extraData: opts.extraData,
    ...(opts.sender ? { sender: opts.sender } : {}),
  })
  return { txHash: signed.hash }
}

/** Convenience: build raw claim payload + Hub checkout. */
export async function claimHandleWithHub(
  handle: string,
  sender?: string,
): Promise<{ txHash: string }> {
  const { recipient, extraDataBytes } = buildHandleClaimPayload(handle)
  return hubCheckoutClaim({ recipient, extraData: extraDataBytes, sender })
}

async function hubSignTransaction(opts: {
  recipient: string
  extraData: Uint8Array
  sender: string
  validityStartHeight: number
}): Promise<{ rawHex: string; hash: string }> {
  const signed = await getHub().signTransaction({
    appName: APP_NAME,
    sender: opts.sender,
    recipient: opts.recipient,
    value: 0,
    extraData: opts.extraData,
    validityStartHeight: opts.validityStartHeight,
  })
  return { rawHex: signed.serializedTx, hash: signed.hash }
}

/** Signs (but does not send) the transaction that releases an owned handle. */
export async function hubSignReleaseTransaction(
  handle: string,
  sender: string,
  validityStartHeight: number,
): Promise<{ rawHex: string; hash: string }> {
  const { recipient, extraDataBytes } = buildHandleReleasePayload(handle)
  return hubSignTransaction({ recipient, extraData: extraDataBytes, sender, validityStartHeight })
}

/** Signs (but does not send) the transaction that claims a released handle. */
export async function hubSignClaimTransaction(
  handle: string,
  sender: string,
  validityStartHeight: number,
): Promise<{ rawHex: string; hash: string }> {
  const { recipient, extraDataBytes } = buildHandleClaimPayload(handle)
  return hubSignTransaction({ recipient, extraData: extraDataBytes, sender, validityStartHeight })
}

/** Best-effort mapping of a Hub popup rejection/cancellation to a quieter message. */
export function hubErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  if (/cancel/i.test(message)) return 'Canceled — no changes were made.'
  return 'Install or open a Nimiq Hub compatible wallet'
}

/**
 * Generic value+text-data checkout — distinct from hubCheckoutClaim, which
 * is always value-0 with binary extraData. Used for the marketplace escrow
 * deposit, where the data is a plain-text "NME1:<reference>" string.
 */
export async function hubCheckoutPayment(opts: {
  recipient: string
  valueLuna: number
  data: string
  sender?: string
}): Promise<{ txHash: string }> {
  const signed = await getHub().checkout({
    appName: APP_NAME,
    recipient: opts.recipient,
    value: opts.valueLuna,
    extraData: opts.data,
    ...(opts.sender ? { sender: opts.sender } : {}),
  })
  return { txHash: signed.hash }
}
