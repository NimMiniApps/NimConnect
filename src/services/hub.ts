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

// Hub's signTransaction() treats a 0 value as *missing* rather than valid
// ("value is required") — the same falsy-check bug that makes checkout()
// reject 0 with "value must be a number >0". A registry claim/release isn't
// a payment, but it still needs to carry a token nonzero amount to get past
// Hub's request validation. The backend never checks this value — only the
// recipient and extraData matter for parsing a claim/release.
const REGISTRY_TX_VALUE_LUNA = 1000 // 0.01 NIM

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
    value: REGISTRY_TX_VALUE_LUNA,
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
  // Only window.open() itself failing means there's no Hub to talk to — every
  // other rejection is Hub reporting a real reason (e.g. insufficient balance
  // on the selected address), which is more useful to the user verbatim than
  // a generic "no wallet" hint that doesn't match what they just saw.
  if (/failed to open popup/i.test(message)) return 'Install or open a Nimiq Hub compatible wallet'
  return message || 'Something went wrong in the Nimiq Hub popup — try again.'
}

/**
 * Generic value+text-data checkout, used for the marketplace escrow deposit
 * — a real payment, unlike handle claims/releases which only carry a token
 * amount to a registry address (see hubSignClaimTransaction/hubSignReleaseTransaction).
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
