const KEY = 'nimconnect:desktop-hub-address'

/** Currently connected Hub address on desktop, persisted across reloads. */
export function getDesktopHubAddress(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) || null
  } catch {
    return null
  }
}

export function setDesktopHubAddress(address: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, address)
  } catch { /* best-effort */ }
}

export function clearDesktopHubAddress(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch { /* best-effort */ }
}
