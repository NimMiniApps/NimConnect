<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { insideNimiqPay, sendNim } from '../services/nimiq'
import { getRates, fiatToNim, type NimRates } from '../services/rates'
import { preferredCurrency } from '../services/prefs'
import ActionSheet from './ActionSheet.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'
import Identicon from './Identicon.vue'

const props = defineProps<{ profile: Profile; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

interface TipPreset {
  id: string
  nim: number
  /** Primary chip label — fiat when rates work, NIM when offline */
  label: string
  /** Secondary line, e.g. "≈ 11,267 NIM" */
  sub: string | null
  /** For CTA copy when tipping in fiat terms */
  fiatLabel: string | null
}

const store = useProfilesStore()
const rates = ref<NimRates | null>(null)
const selectedPresetId = ref<string | null>(null)
const customMode = ref(false)
const customAmount = ref<number | null>(null)
const message = ref('')
const sending = ref(false)
const result = ref<'ok' | string | null>(null)
const amountInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const sentAmount = ref<number | null>(null)
const sentFiatLabel = ref<string | null>(null)

function fiatPresetAmounts(currency: string): number[] {
  if (currency === 'JPY' || currency === 'INR') return [100, 500, 1000, 2500]
  if (currency === 'CNY') return [5, 20, 50, 100]
  return [1, 5, 10, 25]
}

function formatFiat(amount: number, currency: string): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  })
}

function formatNim(nim: number): string {
  return nim.toLocaleString(undefined, { maximumFractionDigits: nim >= 100 ? 0 : 2 })
}

const tipCurrency = computed(() => {
  const preferred = preferredCurrency.value
  if (preferred !== 'NIM' && rates.value?.nim[preferred]) return preferred
  if (rates.value?.nim.EUR) return 'EUR'
  return null
})

const presets = computed<TipPreset[]>(() => {
  const currency = tipCurrency.value
  if (currency && rates.value) {
    return fiatPresetAmounts(currency).flatMap((fiat) => {
      const nim = fiatToNim(fiat, currency, rates.value!)
      if (nim == null || !(nim > 0)) return []
      const fiatLabel = formatFiat(fiat, currency)
      return [{
        id: `${currency}-${fiat}`,
        nim,
        label: fiatLabel,
        sub: `≈ ${formatNim(nim)} NIM`,
        fiatLabel,
      }]
    })
  }
  // Offline / no rates — keep chips usable, but avoid tiny 1–25 NIM tips.
  return [2500, 10000, 25000, 50000].map(nim => ({
    id: `nim-${nim}`,
    nim,
    label: `${formatNim(nim)} NIM`,
    sub: null,
    fiatLabel: null,
  }))
})

const selectedPreset = computed(() =>
  presets.value.find(p => p.id === selectedPresetId.value) ?? null,
)

const amount = computed(() => (customMode.value ? customAmount.value : selectedPreset.value?.nim ?? null))

const ctaLabel = computed(() => {
  if (sending.value) return 'Waiting for confirmation…'
  if (amount.value) {
    if (!customMode.value && selectedPreset.value?.fiatLabel) {
      return `Send ${selectedPreset.value.fiatLabel} tip`
    }
    return `Send ${formatNim(amount.value)} NIM tip`
  }
  if (customMode.value) return 'Continue'
  return 'Pick an amount'
})

watch(() => props.open, (open) => {
  if (open) {
    resetForm()
    void loadRates()
  }
})

async function loadRates() {
  rates.value = await getRates()
}

function resetForm() {
  selectedPresetId.value = null
  customMode.value = false
  customAmount.value = null
  message.value = ''
  result.value = null
  sentAmount.value = null
  sentFiatLabel.value = null
  amountInput.value?.reset()
}

function close() {
  resetForm()
  emit('close')
}

function selectPreset(p: TipPreset) {
  customMode.value = false
  selectedPresetId.value = p.id
  customAmount.value = null
  amountInput.value?.reset()
}

function selectCustom() {
  customMode.value = true
  selectedPresetId.value = null
}

async function doTip() {
  if (!amount.value) return
  sending.value = true
  result.value = null
  try {
    await sendNim(props.profile.address, amount.value, message.value)
    sentAmount.value = amount.value
    sentFiatLabel.value = !customMode.value ? selectedPreset.value?.fiatLabel ?? null : null
    result.value = 'ok'
    await store.touchInteraction(props.profile.id)
  } catch (e) {
    result.value = (e as Error).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <ActionSheet :open="open" title="Send a tip" @close="close">
    <template v-if="insideNimiqPay">
      <div v-if="result === 'ok'" class="success">
        <div class="success-avatar">
          <Identicon :address="profile.address" :size="80" />
          <span class="success-badge" aria-hidden="true">✓</span>
        </div>
        <p class="success-title">Tip sent</p>
        <p class="success-body">
          {{ profile.name }} received your
          <template v-if="sentFiatLabel">{{ sentFiatLabel }}</template>
          <template v-else-if="sentAmount">{{ formatNim(sentAmount) }} NIM</template>
          tip.
        </p>
        <button type="button" class="primary" @click="close">Done</button>
      </div>

      <template v-else>
        <div class="recipient">
          <Identicon :address="profile.address" :size="72" />
          <h3 class="recipient-name">{{ profile.name }}</h3>
          <p class="recipient-line">You're sending a tip</p>
          <p class="helper">
            A tip is a quick thank-you.<br />
            Add a message if you'd like.
          </p>
        </div>

        <div class="presets" role="group" aria-label="Tip amounts">
          <button
            v-for="p in presets"
            :key="p.id"
            type="button"
            class="preset"
            :class="{ selected: !customMode && selectedPresetId === p.id }"
            :aria-pressed="!customMode && selectedPresetId === p.id"
            @click="selectPreset(p)"
          >
            <span class="preset-main">
              <span v-if="!customMode && selectedPresetId === p.id" class="check" aria-hidden="true">✓</span>
              {{ p.label }}
            </span>
            <span v-if="p.sub" class="preset-sub">{{ p.sub }}</span>
          </button>
          <button
            type="button"
            class="preset custom"
            :class="{ selected: customMode }"
            :aria-pressed="customMode"
            @click="selectCustom"
          >
            <span class="preset-main">
              <span v-if="customMode" class="check" aria-hidden="true">✓</span>
              Custom…
            </span>
          </button>
        </div>

        <label v-if="customMode" class="custom-label">
          Custom amount
          <CurrencyAmountInput
            ref="amountInput"
            placeholder="0.00"
            @update:model-value="customAmount = $event"
          />
        </label>

        <label class="message-label">
          Message <span class="optional">(optional)</span>
          <input v-model="message" maxlength="64" placeholder="Say thanks…" />
        </label>

        <p v-if="result" class="err">{{ result }}</p>
        <button type="button" class="primary" :disabled="!amount || sending" @click="doTip">
          {{ ctaLabel }}
        </button>
      </template>
    </template>
    <p v-else class="hint">Open NimConnect inside Nimiq Pay to send tips.</p>
  </ActionSheet>
</template>

<style scoped>
.recipient {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  text-align: center;
  margin: 4px 0 18px;
}
.recipient-name {
  margin: 4px 0 0;
  font-size: 22px; font-weight: 800; line-height: 1.2;
  letter-spacing: -0.02em;
}
.recipient-line {
  margin: 0;
  font-size: 14px; font-weight: 700; color: var(--text-2);
}
.helper {
  margin: 6px 0 0;
  max-width: 280px;
  font-size: 13px; font-weight: 600; color: var(--text-2);
  line-height: 1.4;
}

.presets {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}
.preset {
  min-height: 64px; padding: 8px 6px;
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  border-radius: var(--nimiq-radius-small); cursor: pointer;
  border: 2px solid var(--border); background: var(--bg); color: var(--text);
  font: inherit;
  transition:
    background var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease),
    color var(--attr-duration) var(--nimiq-ease),
    box-shadow var(--attr-duration) var(--nimiq-ease),
    transform var(--attr-duration) var(--nimiq-ease);
}
.preset:active { transform: scale(0.97); }
.preset.selected {
  border-color: var(--nq-gold);
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-blue);
  box-shadow: 0 3px 12px rgba(233, 178, 19, 0.4);
  transform: translateY(-1px);
}
.preset-main {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  font-weight: 800; font-size: 15px; line-height: 1.1;
}
.preset-sub {
  font-size: 11px; font-weight: 700; line-height: 1.2;
  opacity: 0.72;
}
.preset.selected .preset-sub { opacity: 0.8; }
.preset.custom { font-size: 13px; }
.check {
  width: 16px; height: 16px;
  display: inline-grid; place-items: center;
  border-radius: 50%;
  background: rgba(31, 35, 72, 0.12);
  font-size: 10px; line-height: 1; font-weight: 900;
}

.custom-label,
.message-label {
  display: flex; flex-direction: column; gap: 6px;
  font-size: 13px; font-weight: 700; color: var(--text-2);
  margin-bottom: 12px;
}
.optional { font-weight: 600; opacity: 0.8; }
.message-label input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); color: var(--text);
}

.success {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  text-align: center;
  padding: 12px 0 4px;
  animation: tip-success-in var(--movement-duration) var(--nimiq-ease);
}
.success-avatar {
  position: relative;
  animation: tip-pop 0.45s var(--nimiq-ease);
}
.success-badge {
  position: absolute; right: -4px; bottom: -2px;
  width: 28px; height: 28px;
  display: inline-grid; place-items: center;
  border-radius: 50%;
  background: var(--nimiq-green-bg);
  color: var(--nimiq-white);
  font-size: 14px; font-weight: 900;
  box-shadow: 0 2px 8px rgba(33, 188, 165, 0.35);
}
.success-title {
  margin: 10px 0 0;
  font-size: 22px; font-weight: 800; color: var(--nq-green);
}
.success-body {
  margin: 0 0 8px;
  max-width: 280px;
  font-size: 15px; font-weight: 600; color: var(--text-2);
  line-height: 1.4;
}
@keyframes tip-success-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes tip-pop {
  0% { transform: scale(0.86); opacity: 0.6; }
  70% { transform: scale(1.04); opacity: 1; }
  100% { transform: scale(1); }
}

.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-blue); margin-top: 12px;
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
.primary:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
</style>
