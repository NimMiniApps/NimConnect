<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { getRates, fiatToNim, FIAT_CURRENCIES, type NimRates } from '../services/rates'
import { preferredCurrency } from '../services/prefs'

defineProps<{ placeholder?: string }>()
const emit = defineEmits<{
  /** NIM amount (converted when a fiat currency is selected), null while invalid */
  'update:modelValue': [nim: number | null]
  /** Original fiat entry when a fiat currency is selected, null for NIM */
  fiat: [info: { amount: number; currency: string } | null]
}>()

const raw = ref<number | null>(null)
const currency = ref<string>(preferredCurrency.value)
const rates = ref<NimRates | null>(null)

onMounted(async () => {
  rates.value = await getRates()
})

const nimValue = computed<number | null>(() => {
  if (!raw.value || !(raw.value > 0)) return null
  if (currency.value === 'NIM') return raw.value
  if (!rates.value) return null
  return fiatToNim(raw.value, currency.value, rates.value)
})

const ratesMissing = computed(() => currency.value !== 'NIM' && !rates.value)

watch([nimValue, currency, raw], () => {
  emit('update:modelValue', nimValue.value)
  emit('fiat', currency.value !== 'NIM' && raw.value
    ? { amount: raw.value, currency: currency.value }
    : null)
})

function reset() {
  raw.value = null
  currency.value = preferredCurrency.value
}
defineExpose({ reset })
</script>

<template>
  <div class="cai">
    <div class="row">
      <input
        v-model.number="raw"
        type="number"
        min="0.00001"
        step="any"
        :placeholder="placeholder ?? '0.00'"
      />
      <select v-model="currency">
        <option value="NIM">NIM</option>
        <option v-for="c in FIAT_CURRENCIES" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>
    <p v-if="ratesMissing" class="warn">Exchange rates unavailable — enter the amount in NIM.</p>
    <p v-else-if="currency !== 'NIM' && nimValue" class="approx">
      ≈ {{ nimValue.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
      <template v-if="rates?.stale"> · rates may be outdated</template>
    </p>
  </div>
</template>

<style scoped>
.cai { display: flex; flex-direction: column; gap: 4px; }
.row { display: flex; gap: 8px; }
.row input {
  flex: 1; min-width: 0; font: inherit; font-size: 24px; text-align: center;
  padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text);
}
.row select {
  width: 84px; font: inherit; font-weight: 700; padding: 0 8px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text);
}
.approx { margin: 0; font-size: 13px; color: var(--nq-green); font-weight: 700; text-align: center; }
.warn { margin: 0; font-size: 13px; color: var(--nq-red); text-align: center; }
</style>
