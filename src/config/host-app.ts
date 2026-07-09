/** Mini App domain registered in the Nimiq Pay catalog (not the URL slug). */
const MINIAPP_DOMAIN = import.meta.env.VITE_NIMPAY_MINIAPP_DOMAIN ?? 'nimconnect.maestroi.cc'

export const NIMPAY_OPEN_URL = `https://nimpay.app/miniapps/open/${MINIAPP_DOMAIN}`

export const NIMPAY_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.nimiq.pay'

export const NIMPAY_APP_STORE_URL =
  'https://apps.apple.com/app/nimiq-pay/id6471844738'

export const BROWSER_MODE_KEY = 'nimconnect:browser-mode'

export function hasBrowserModeOptIn(): boolean {
  try {
    return globalThis.localStorage?.getItem(BROWSER_MODE_KEY) === '1'
  } catch {
    return false
  }
}

export function enableBrowserMode(): void {
  try {
    globalThis.localStorage?.setItem(BROWSER_MODE_KEY, '1')
  } catch {
    // private browsing — session-only fallback handled in App.vue
  }
}
