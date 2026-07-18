import { readonly, ref } from 'vue'

const KEY = 'nimconnect:desktop-hub-address'

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) || null
  } catch {
    return null
  }
}

const connectedAddress = ref<string | null>(readStored())

/** Reactive Hub address for desktop shell / identity pages. */
export const desktopHubAddress = readonly(connectedAddress)

/** Currently connected Hub address on desktop, persisted across reloads. */
export function getDesktopHubAddress(): string | null {
  return connectedAddress.value
}

export function setDesktopHubAddress(address: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, address)
  } catch { /* best-effort */ }
  connectedAddress.value = address
}

export function clearDesktopHubAddress(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch { /* best-effort */ }
  connectedAddress.value = null
}
