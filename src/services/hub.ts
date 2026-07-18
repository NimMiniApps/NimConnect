import HubApi from '@nimiq/hub-api'
import { buildHandleClaimPayload } from '@nimconnect/profile-client'

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
