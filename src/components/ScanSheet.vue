<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { classifyScan, shortAddress, type ParsedPaymentRequest, type ScanIntent } from '../services/links'
import { encodeSharedProfile, type SharedProfile } from '../services/profile-share'
import { parsePublicLookupQuery } from '../services/handles'
import { lookupContactPublicIdentity } from '../services/contact-public-lookup'
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
const resolvedHandle = ref<string | null>(null)
const linkInput = ref('')
const error = ref('')
const resolving = ref(false)
const scannerKey = ref(0)
const scannerReady = ref(false)
const scannerPaused = ref(false)
let pasteTimer: ReturnType<typeof setTimeout> | undefined

const contact = computed(() =>
  intent.value ? store.getByAddress(intent.value.recipient) : undefined,
)

const title = computed(() => {
  if (phase.value === 'scan') return 'Scan'
  switch (intent.value?.requestType) {
    case 'split': return 'Split request'
    case 'invoice': return 'Invoice'
    case 'bucket': return 'Shared bucket'
    case 'request': return 'Payment request'
    default: return contact.value || intent.value?.sharedProfile ? 'Profile' : 'Address'
  }
})

const subtitle = computed(() =>
  phase.value === 'scan'
    ? 'Open payment links, public profiles, invoices and more.'
    : undefined,
)

const supportChips = [
  { icon: '💰', label: 'Payment requests' },
  { icon: '📷', label: 'QR codes' },
  { icon: '👤', label: '@handles' },
  { icon: '📍', label: 'Addresses' },
  { icon: '🧾', label: 'Invoice links' },
] as const

const resultKind = computed(() => {
  if (!intent.value) return { icon: '📷', label: 'Scanned' }
  switch (intent.value.requestType) {
    case 'split': return { icon: '✂️', label: 'Split request' }
    case 'invoice': return { icon: '🧾', label: 'Invoice' }
    case 'bucket': return { icon: '🪣', label: 'Shared bucket' }
    case 'request': return { icon: '💰', label: 'Payment request' }
    default: return {
      icon: '👤',
      label: resolvedHandle.value || intent.value.sharedProfile ? 'Public profile' : 'Wallet address',
    }
  }
})

const headline = computed(() => {
  if (!intent.value) return ''
  if (intent.value.sharedProfile?.name) return intent.value.sharedProfile.name
  if (contact.value) return contact.value.name
  if (resolvedHandle.value) return `@${resolvedHandle.value}`
  return shortAddress(intent.value.recipient)
})

const primaryActionLabel = computed(() => {
  if (!intent.value) return 'Continue'
  if (intent.value.requestType === 'profile') {
    if (contact.value) return 'Open profile'
    return 'Open profile'
  }
  if (intent.value.hasAmount) {
    return `Review ${intent.value.amountNim!.toLocaleString(undefined, { maximumFractionDigits: 5 })} NIM`
  }
  return 'Review payment'
})

const canPay = computed(() => intent.value != null && intent.value.requestType !== 'profile')
const isProfile = computed(() => intent.value?.requestType === 'profile')

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

/** Auto-open once the paste field looks like a complete Nimiq object. */
function looksReadyToResolve(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (classifyScan(t)) return true
  const q = parsePublicLookupQuery(t)
  if (q.kind === 'handle' || q.kind === 'address') return true
  return /^(https?:|nimiq:)/i.test(t)
}

watch(linkInput, raw => {
  clearTimeout(pasteTimer)
  if (phase.value !== 'scan') return
  error.value = ''
  const trimmed = raw.trim()
  if (!looksReadyToResolve(trimmed)) return
  pasteTimer = setTimeout(() => {
    if (phase.value === 'scan' && linkInput.value.trim() === trimmed) {
      void handleScan(trimmed)
    }
  }, 350)
})

onUnmounted(() => clearTimeout(pasteTimer))

function reset() {
  clearTimeout(pasteTimer)
  phase.value = 'scan'
  intent.value = null
  resolvedHandle.value = null
  linkInput.value = ''
  error.value = ''
  resolving.value = false
  scannerPaused.value = false
  scannerKey.value += 1
}

function suggestionToShared(s: {
  address: string
  handle: string | null
  displayName: string | null
  bio?: string
  website?: string
  github?: string
  x?: string
  tags: string[]
}): SharedProfile {
  return {
    v: 1,
    address: s.address,
    name: s.displayName || (s.handle ? `@${s.handle}` : shortAddress(s.address)),
    type: 'person',
    tags: [...s.tags],
    ...(s.bio ? { bio: s.bio } : {}),
    ...(s.website ? { website: s.website } : {}),
    ...(s.github ? { github: s.github } : {}),
    ...(s.x ? { x: s.x } : {}),
  }
}

async function resolvePasteIdentity(text: string): Promise<ScanIntent | null> {
  const parsed = parsePublicLookupQuery(text)
  if (parsed.kind === 'invalid') return null
  resolving.value = true
  try {
    const result = await lookupContactPublicIdentity(text)
    if (result.status !== 'found') return null
    resolvedHandle.value = result.suggestion.handle
    return {
      recipient: result.suggestion.address,
      requestType: 'profile',
      hasAmount: false,
      sharedProfile: suggestionToShared(result.suggestion),
    }
  } catch {
    return null
  } finally {
    resolving.value = false
  }
}

async function handleScan(text: string) {
  if (phase.value === 'result' || resolving.value) return
  error.value = ''
  resolvedHandle.value = null

  let next = classifyScan(text)
  if (!next) {
    next = await resolvePasteIdentity(text)
  }
  if (!next) {
    error.value = 'Not a Nimiq QR, payment link, @handle or address'
    return
  }

  scannerPaused.value = true

  // Always land on a resolved result — never dump users into a form mid-scan.
  intent.value = next
  phase.value = 'result'
}

function applyPaste() {
  void handleScan(linkInput.value)
}

function primaryAction() {
  if (!intent.value) return
  if (isProfile.value) {
    if (contact.value) viewProfile()
    else addContact()
    return
  }
  pay()
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
  router.push({
    path: '/add',
    query: intent.value.sharedProfile
      ? { p: encodeSharedProfile(intent.value.sharedProfile) }
      : { address: intent.value.recipient },
  })
}

function scanAgain() {
  phase.value = 'scan'
  intent.value = null
  resolvedHandle.value = null
  linkInput.value = ''
  error.value = ''
  scannerPaused.value = false
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
  <ActionSheet :open="open" :title="title" :subtitle="subtitle" @close="close">
    <template v-if="phase === 'scan'">
      <QrScanner
        v-if="scannerReady"
        :key="scannerKey"
        :paused="scannerPaused"
        @scan="handleScan"
      />

      <div class="paste-row">
        <input
          v-model="linkInput"
          type="text"
          class="paste-input"
          placeholder="Paste a payment link, @handle or Nimiq address…"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          @keydown.enter.prevent="applyPaste"
        />
        <button
          type="button"
          class="paste-btn"
          :disabled="!linkInput.trim() || resolving"
          @click="applyPaste"
        >
          {{ resolving ? '…' : 'Open' }}
        </button>
      </div>

      <p v-if="resolving" class="resolving" role="status">Recognizing…</p>
      <p v-else-if="error" class="err">{{ error }}</p>

      <div class="supports">
        <p class="supports-label">Supports</p>
        <div class="chips">
          <span v-for="chip in supportChips" :key="chip.label" class="chip">
            <span aria-hidden="true">{{ chip.icon }}</span>
            {{ chip.label }}
          </span>
        </div>
      </div>
    </template>

    <template v-else-if="intent">
      <div class="result" key="result">
        <p class="result-kind">
          <span aria-hidden="true">{{ resultKind.icon }}</span>
          {{ resultKind.label }}
        </p>
        <Identicon :address="intent.recipient" :size="72" />
        <p class="name">{{ headline }}</p>
        <p v-if="resolvedHandle && headline !== `@${resolvedHandle}`" class="handle">
          @{{ resolvedHandle }}
        </p>
        <p v-if="intent.hasAmount" class="amount">
          {{ intent.amountNim!.toLocaleString(undefined, { maximumFractionDigits: 5 }) }} NIM
        </p>
        <p v-if="intent.message" class="message">“{{ intent.message }}”</p>
        <p v-else-if="isProfile" class="subtle">Ready to open in NimConnect</p>
      </div>

      <div class="actions">
        <button type="button" class="primary" @click="primaryAction">
          {{ primaryActionLabel }}
        </button>
        <button
          v-if="canPay && contact"
          type="button"
          class="secondary"
          @click="viewProfile"
        >
          Open profile
        </button>
        <button
          v-else-if="canPay && !contact"
          type="button"
          class="secondary"
          @click="addContact"
        >
          Save contact
        </button>
        <button type="button" class="ghost" @click="scanAgain">Scan again</button>
      </div>
    </template>
  </ActionSheet>
</template>

<style scoped>
.paste-row { display: flex; gap: 8px; margin-top: 14px; }
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
  min-width: 72px;
  min-height: 44px;
  padding: 0 16px;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-white);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.paste-btn:disabled { opacity: 0.5; cursor: default; }

.supports { margin-top: 16px; }
.supports-label {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-2);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--nimiq-radius-pill);
  background: var(--text-6);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 700;
}
.resolving {
  margin: 8px 0 0;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 0 16px;
  text-align: center;
  animation: result-in 0.35s var(--nimiq-ease);
}
@keyframes result-in {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
.result-kind {
  margin: 0 0 4px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--nimiq-radius-pill);
  background: var(--text-6);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 800;
}
.name { margin: 0; font-size: 20px; font-weight: 700; }
.handle { margin: 0; font-size: 14px; font-weight: 700; color: var(--nq-light-blue); }
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
