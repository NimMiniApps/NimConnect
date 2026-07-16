<script setup lang="ts">
import { ref, watch } from 'vue'
import ActionSheet from './ActionSheet.vue'
import { insideNimiqPay } from '../services/nimiq'
import { isValidHandle, checkHandle, claimHandle, type HandleClaim } from '../services/handles'
import { celebrate } from '../services/delight'
import { myAddresses } from '../services/nimiq'
import { useProfilesStore } from '../stores/profiles'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; claimed: [handle: string, txHash: string, claim?: HandleClaim] }>()

const store = useProfilesStore()

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'unknown'

const handle = ref('')
const availability = ref<Availability>('idle')
const claiming = ref(false)
const result = ref<'indexed' | 'pending' | null>(null)
const error = ref<string | null>(null)
const debugInfo = ref<string | null>(null)
const debugCopied = ref(false)

async function copyDebug() {
  if (!debugInfo.value) return
  try {
    await navigator.clipboard.writeText(debugInfo.value)
    debugCopied.value = true
    setTimeout(() => { debugCopied.value = false }, 2000)
  } catch {
    // clipboard unavailable — the text is selectable
  }
}
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

function claimErrorHint(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('invalidated')) {
    return `${message} — check your Nimiq Pay spending balance (not just incoming): you need enough NIM for the dust amount plus the network fee. Try sending a small payment from Home first.`
  }
  return message
}

async function doClaim() {
  const h = handle.value.trim().toLowerCase()
  if (!isValidHandle(h) || claiming.value) return
  claiming.value = true
  error.value = null
  try {
    const wallets = store.self ? myAddresses(store.self.address) : []
    const { status, txHash, claim } = await claimHandle(h, wallets)
    result.value = status
    celebrate()
    emit('claimed', h, txHash, claim)
  } catch (e) {
    error.value = claimErrorHint((e as Error).message)
    const dbg = (e as Error & { debug?: unknown }).debug
    debugInfo.value = dbg ? JSON.stringify(dbg, null, 2) : `${(e as Error).name}: ${(e as Error).message}`
  } finally {
    claiming.value = false
  }
}

function close() {
  handle.value = ''
  availability.value = 'idle'
  result.value = null
  error.value = null
  debugInfo.value = null
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
        <details v-if="debugInfo" class="debug">
          <summary>Debug info</summary>
          <pre>{{ debugInfo }}</pre>
          <button type="button" class="debug-copy" @click="copyDebug">
            {{ debugCopied ? 'Copied ✓' : 'Copy debug info' }}
          </button>
        </details>
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
.debug { margin-top: 8px; font-size: 12px; color: var(--text-2); }
.debug summary { cursor: pointer; font-weight: 700; }
.debug pre {
  margin: 6px 0; padding: 8px; max-height: 180px; overflow: auto;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg);
  font-size: 11px; line-height: 1.4; white-space: pre-wrap; word-break: break-all;
  user-select: all;
}
.debug-copy {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill);
  background: var(--card); color: var(--text); font: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer;
}
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); margin-top: 12px;
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
</style>
