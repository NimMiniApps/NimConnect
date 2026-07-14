<script setup lang="ts">
import { ref, watch } from 'vue'
import ActionSheet from './ActionSheet.vue'
import { insideNimiqPay } from '../services/nimiq'
import { isValidHandle, checkHandle, claimHandle } from '../services/handles'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; claimed: [handle: string] }>()

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'unknown'

const handle = ref('')
const availability = ref<Availability>('idle')
const claiming = ref(false)
const result = ref<'indexed' | 'pending' | null>(null)
const error = ref<string | null>(null)
let debounce: ReturnType<typeof setTimeout> | undefined

watch(handle, value => {
  clearTimeout(debounce)
  error.value = null
  const h = value.trim().toLowerCase()
  if (!h) {
    availability.value = 'idle'
    return
  }
  if (!isValidHandle(h)) {
    availability.value = 'invalid'
    return
  }
  availability.value = 'checking'
  debounce = setTimeout(async () => {
    try {
      const check = await checkHandle(h)
      availability.value = check.available
        ? 'available'
        : (check.reason as Availability) || 'taken'
    } catch {
      availability.value = 'unknown' // advisory only — claiming still allowed
    }
  }, 400)
})

const HINTS: Record<Availability, string> = {
  idle: '3–26 characters here (a–z, 0–9, _); longer names claim via NimFeed',
  checking: 'Checking…',
  available: 'Looks available ✓ (the chain has the final say)',
  taken: 'Already claimed',
  reserved: 'Reserved name',
  invalid: '3–26 characters here (a–z, 0–9, _); longer names claim via NimFeed',
  unknown: 'Could not check availability — you can still try to claim',
}

async function doClaim() {
  const h = handle.value.trim().toLowerCase()
  if (!isValidHandle(h) || claiming.value) return
  claiming.value = true
  error.value = null
  try {
    result.value = await claimHandle(h)
    emit('claimed', h)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    claiming.value = false
  }
}

function close() {
  handle.value = ''
  availability.value = 'idle'
  result.value = null
  error.value = null
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" title="Claim your @handle" @close="close">
    <template v-if="insideNimiqPay">
      <template v-if="result">
        <p class="ok">
          🎉 Claim for <strong>@{{ handle.trim().toLowerCase() }}</strong> is on the chain.
          <template v-if="result === 'pending'">
            It'll be confirmed within a couple of minutes — earliest claim wins.
          </template>
        </p>
        <button class="primary" @click="close">Done</button>
      </template>
      <template v-else>
        <p class="intro">
          Your @handle is claimed with a tiny on-chain transaction and belongs to
          your wallet address — permanently, first come first served.
        </p>
        <label class="handle-label">
          Handle
          <div class="handle-input">
            <span aria-hidden="true">@</span>
            <input
              v-model="handle"
              maxlength="26"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              placeholder="chuck"
            />
          </div>
        </label>
        <p class="hint" :class="{ good: availability === 'available', bad: availability === 'taken' || availability === 'reserved' }">
          {{ HINTS[availability] }}
        </p>
        <p v-if="error" class="err">{{ error }}</p>
        <button
          class="primary"
          :disabled="claiming || availability === 'taken' || availability === 'reserved' || !isValidHandle(handle.trim().toLowerCase())"
          @click="doClaim"
        >
          {{ claiming ? 'Waiting for confirmation…' : 'Claim with a dust transaction' }}
        </button>
      </template>
    </template>
    <p v-else class="hint">Open NimConnect inside Nimiq Pay to claim a handle.</p>
  </ActionSheet>
</template>

<style scoped>
.intro { margin: 0 0 12px; font-size: 14px; color: var(--text-2); line-height: 1.5; }
.handle-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); }
.handle-input {
  display: flex; align-items: center; gap: 4px; padding: 0 12px; min-height: 48px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); font-size: 17px; font-weight: 700; color: var(--text);
}
.handle-input input {
  flex: 1; min-width: 0; border: none; background: none; font: inherit; color: inherit; outline: none;
}
.hint { margin: 8px 0 0; font-size: 13px; color: var(--text-2); }
.hint.good { color: var(--nq-green); }
.hint.bad { color: var(--nq-red); }
.ok { color: var(--nq-green); font-weight: 700; line-height: 1.5; }
.err { color: var(--nq-red); font-size: 14px; }
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); margin-top: 12px;
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
</style>
