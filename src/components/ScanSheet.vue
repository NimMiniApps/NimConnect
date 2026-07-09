<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { classifyScan, shortAddress, type ParsedPaymentRequest, type ScanIntent } from '../services/links'
import ActionSheet from './ActionSheet.vue'
import Identicon from './Identicon.vue'
import QrScanner from './QrScanner.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  pay: [request: ParsedPaymentRequest]
}>()

const router = useRouter()
const store = useProfilesStore()

const phase = ref<'scan' | 'result'>('scan')
const intent = ref<ScanIntent | null>(null)
const linkInput = ref('')
const error = ref('')
const scannerKey = ref(0)
const scannerReady = ref(false)

const contact = computed(() =>
  intent.value ? store.getByAddress(intent.value.recipient) : undefined,
)

const title = computed(() => {
  if (phase.value === 'scan') return 'Scan'
  switch (intent.value?.requestType) {
    case 'split': return 'Split request'
    case 'invoice': return 'Invoice'
    case 'request': return 'Payment request'
    default: return contact.value ? contact.value.name : 'Nimiq address'
  }
})

const headline = computed(() => {
  if (!intent.value) return ''
  if (contact.value) return contact.value.name
  return shortAddress(intent.value.recipient)
})

const canPay = computed(() => intent.value != null)

watch(() => props.open, async open => {
  scannerReady.value = false
  if (!open) {
    reset()
    return
  }
  await store.load()
  reset()
  await nextTick()
  requestAnimationFrame(() => {
    if (props.open) scannerReady.value = true
  })
})

function reset() {
  phase.value = 'scan'
  intent.value = null
  linkInput.value = ''
  error.value = ''
  scannerKey.value += 1
}

function handleScan(text: string) {
  error.value = ''
  const next = classifyScan(text)
  if (!next) {
    error.value = 'Not a Nimiq address or payment link'
    return
  }
  intent.value = next
  phase.value = 'result'
}

function applyPaste() {
  handleScan(linkInput.value)
}

function pay() {
  if (!intent.value) return
  emit('pay', {
    recipient: intent.value.recipient,
    ...(intent.value.amountNim != null ? { amountNim: intent.value.amountNim } : {}),
    ...(intent.value.message ? { message: intent.value.message } : {}),
    ...(intent.value.label ? { label: intent.value.label } : {}),
  })
}

function viewProfile() {
  if (!contact.value) return
  close()
  router.push(`/profile/${contact.value.id}`)
}

function addContact() {
  if (!intent.value) return
  close()
  router.push({ path: '/add', query: { address: intent.value.recipient } })
}

function scanAgain() {
  phase.value = 'scan'
  intent.value = null
  linkInput.value = ''
  error.value = ''
  scannerKey.value += 1
  scannerReady.value = false
  nextTick(() => {
    requestAnimationFrame(() => {
      if (props.open) scannerReady.value = true
    })
  })
}

function close() {
  reset()
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" :title="title" @close="close">
    <template v-if="phase === 'scan'">
      <p class="lead">Scan a payment link, split request, invoice QR, or profile address.</p>
      <QrScanner
        v-if="scannerReady"
        :key="scannerKey"
        @scan="handleScan"
        @error="msg => { error = msg }"
      />
      <div class="paste-row">
        <input
          v-model="linkInput"
          type="text"
          class="paste-input"
          placeholder="Or paste nimiq: link / address…"
          @keydown.enter.prevent="applyPaste"
        />
        <button type="button" class="paste-btn" :disabled="!linkInput.trim()" @click="applyPaste">
          Go
        </button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </template>

    <template v-else-if="intent">
      <div class="result">
        <Identicon :address="intent.recipient" :size="72" />
        <p class="name">{{ headline }}</p>
        <p v-if="intent.hasAmount" class="amount">
          {{ intent.amountNim!.toLocaleString(undefined, { maximumFractionDigits: 5 }) }} NIM
        </p>
        <p v-if="intent.message" class="message">“{{ intent.message }}”</p>
        <p v-else-if="intent.requestType === 'profile'" class="subtle">Add this wallet or send NIM.</p>
      </div>

      <div class="actions">
        <button v-if="canPay" type="button" class="primary" @click="pay">
          {{ intent.hasAmount ? `Pay ${intent.amountNim!.toLocaleString(undefined, { maximumFractionDigits: 5 })} NIM` : 'Pay' }}
        </button>
        <button v-if="contact" type="button" class="secondary" @click="viewProfile">
          View profile
        </button>
        <button v-else type="button" class="secondary" @click="addContact">
          Add contact
        </button>
        <button type="button" class="ghost" @click="scanAgain">Scan again</button>
      </div>
    </template>
  </ActionSheet>
</template>

<style scoped>
.lead {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text-2);
  text-align: center;
}
.paste-row { display: flex; gap: 8px; margin-top: 12px; }
.paste-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  min-height: 44px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--bg);
  color: var(--text);
}
.paste-btn {
  min-width: 56px;
  min-height: 44px;
  padding: 0 14px;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-white);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.paste-btn:disabled { opacity: 0.5; cursor: default; }
.result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 0 16px;
  text-align: center;
}
.name { margin: 0; font-size: 20px; font-weight: 700; }
.amount { margin: 0; font-size: 24px; font-weight: 700; color: var(--nq-gold-dark); }
.message { margin: 0; font-size: 14px; color: var(--text-2); }
.subtle { margin: 0; font-size: 14px; color: var(--text-2); }
.actions { display: flex; flex-direction: column; gap: 10px; }
.primary,
.secondary,
.ghost {
  min-height: 48px;
  border-radius: var(--nimiq-radius-pill);
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}
.primary {
  border: none;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.secondary {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--nq-light-blue);
}
.ghost {
  border: none;
  background: transparent;
  color: var(--text-2);
}
.err { margin: 8px 0 0; color: var(--nq-red); font-size: 14px; text-align: center; }
</style>
