import { ref, watch } from 'vue'

const KEY = 'nimconnect:preferred-currency'

/** Default currency for amount inputs: 'NIM' or a fiat code from FIAT_CURRENCIES. */
export const preferredCurrency = ref<string>(
  globalThis.localStorage?.getItem(KEY) ?? 'NIM',
)

watch(preferredCurrency, (value) => {
  try {
    globalThis.localStorage?.setItem(KEY, value)
  } catch { /* best-effort */ }
})

const INCOMING_KEY = 'nimconnect:incoming-address'

/** Nimiq Pay uses a separate incoming address; set manually when the wallet only exposes one. */
export const incomingAddress = ref<string>(
  globalThis.localStorage?.getItem(INCOMING_KEY) ?? '',
)

watch(incomingAddress, (value) => {
  try {
    globalThis.localStorage?.setItem(INCOMING_KEY, value)
  } catch { /* best-effort */ }
})
