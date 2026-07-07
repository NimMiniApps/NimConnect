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
