<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { getProvider, sendNim } from '../services/nimiq'
import { makeRequestLink } from '../services/links'
import { fetchHistory, type HistoryItem } from '../services/history'
import Identicon from './Identicon.vue'
import QrCode from './QrCode.vue'
import ActionSheet from './ActionSheet.vue'

const props = defineProps<{ profile: Profile; own?: boolean }>()
defineEmits<{ edit: []; remove: [] }>()

const store = useProfilesStore()
const insidePay = ref(false)
const sheet = ref<'send' | 'request' | 'history' | null>(null)
const amount = ref<number | null>(null)
const sending = ref(false)
const sendResult = ref<'ok' | string | null>(null)
const history = ref<HistoryItem[] | null>(null)
const historyError = ref(false)
const copied = ref(false)

onMounted(async () => {
  insidePay.value = (await getProvider()) !== null
})

const requestLink = computed(() => makeRequestLink(props.profile.address, amount.value ?? undefined))
const dateAdded = computed(() => new Date(props.profile.createdAt).toLocaleDateString())
const lastSeen = computed(() =>
  props.profile.lastInteractionAt ? new Date(props.profile.lastInteractionAt).toLocaleDateString() : null,
)

async function copyAddress() {
  await navigator.clipboard.writeText(props.profile.address)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function openSheet(which: 'send' | 'request' | 'history') {
  amount.value = null
  sendResult.value = null
  sheet.value = which
  if (which === 'history') loadHistory()
}

async function doSend() {
  if (!amount.value) return
  sending.value = true
  sendResult.value = null
  try {
    await sendNim(props.profile.address, amount.value)
    sendResult.value = 'ok'
    await store.touchInteraction(props.profile.id)
  } catch (e) {
    sendResult.value = (e as Error).message
  } finally {
    sending.value = false
  }
}

function copyRequestLink() {
  navigator.clipboard.writeText(requestLink.value)
  store.touchInteraction(props.profile.id)
}

async function loadHistory() {
  history.value = null
  historyError.value = false
  const me = store.self?.address
  if (!me) {
    historyError.value = true
    return
  }
  try {
    history.value = await fetchHistory(me, props.profile.address)
    await store.touchInteraction(props.profile.id)
  } catch {
    historyError.value = true
  }
}
</script>

<template>
  <div class="profile">
    <div class="card head">
      <Identicon :address="profile.address" :size="96" />
      <h1 class="name">
        {{ profile.name }}
        <button v-if="!own" class="star" :class="{ on: profile.favorite }" @click="store.toggleFavorite(profile.id)">
          {{ profile.favorite ? '★' : '☆' }}
        </button>
      </h1>
      <button class="address" @click="copyAddress">
        {{ profile.address }}
        <span class="copy-hint">{{ copied ? 'Copied!' : 'Tap to copy' }}</span>
      </button>
      <div v-if="profile.tags.length" class="tag-row">
        <span v-for="t in profile.tags" :key="t" class="tag">{{ t }}</span>
      </div>
      <div class="meta">
        <span>Added {{ dateAdded }}</span>
        <span v-if="lastSeen"> · Last activity {{ lastSeen }}</span>
      </div>
    </div>

    <div v-if="!own" class="actions">
      <button class="action live" @click="openSheet('send')">💸<span>Send</span></button>
      <button class="action live" @click="openSheet('request')">📥<span>Request</span></button>
      <button class="action live" @click="openSheet('history')">🕘<span>History</span></button>
    </div>
    <div v-if="!own" class="actions future">
      <button class="action" disabled>🧾<span>Invoice</span></button>
      <button class="action" disabled>🍕<span>Split Bill</span></button>
      <button class="action" disabled>💛<span>Tip</span></button>
      <button class="action" disabled>💬<span>Message</span></button>
    </div>

    <div v-if="own" class="card own-qr">
      <QrCode :text="requestLink" :size="220" />
      <p class="hint">Let others scan this to add you or pay you.</p>
    </div>

    <div v-if="profile.notes" class="card notes">
      <h2>Notes</h2>
      <p>{{ profile.notes }}</p>
    </div>

    <div class="manage">
      <button class="link" @click="$emit('edit')">Edit</button>
      <button v-if="!own" class="link danger" @click="$emit('remove')">Delete</button>
    </div>

    <ActionSheet :open="sheet === 'send'" title="Send NIM" @close="sheet = null">
      <template v-if="insidePay">
        <label class="amount-label">
          Amount (NIM)
          <input v-model.number="amount" type="number" min="0.00001" step="any" placeholder="0.00" />
        </label>
        <p v-if="sendResult === 'ok'" class="ok">✓ Sent to {{ profile.name }}</p>
        <p v-else-if="sendResult" class="err">{{ sendResult }}</p>
        <button class="primary" :disabled="!amount || sending" @click="doSend">
          {{ sending ? 'Waiting for confirmation…' : `Send to ${profile.name}` }}
        </button>
      </template>
      <p v-else class="hint">Open NimConnect inside Nimiq Pay to send NIM directly.</p>
    </ActionSheet>

    <ActionSheet :open="sheet === 'request'" title="Request payment" @close="sheet = null">
      <label class="amount-label">
        Amount (NIM, optional)
        <input v-model.number="amount" type="number" min="0" step="any" placeholder="Any amount" />
      </label>
      <QrCode :text="requestLink" :size="220" />
      <p class="hint">{{ profile.name }} can scan this QR or open the link to pay you.</p>
      <button class="primary" @click="copyRequestLink">
        Copy payment link
      </button>
    </ActionSheet>

    <ActionSheet :open="sheet === 'history'" title="Payment history" @close="sheet = null">
      <p v-if="historyError" class="hint">History is unavailable right now{{ store.self ? '' : ' — connect inside Nimiq Pay first' }}.</p>
      <p v-else-if="history === null" class="hint">Loading…</p>
      <p v-else-if="history.length === 0" class="hint">No payments between you and {{ profile.name }} yet.</p>
      <ul v-else class="history">
        <li v-for="h in history" :key="h.hash">
          <span class="dir" :class="h.incoming ? 'in' : 'out'">{{ h.incoming ? '←' : '→' }}</span>
          <span class="value">{{ h.incoming ? '+' : '−' }}{{ h.valueNim }} NIM</span>
          <span class="when">{{ new Date(h.timestamp * (h.timestamp < 1e12 ? 1000 : 1)).toLocaleDateString() }}</span>
        </li>
      </ul>
    </ActionSheet>
  </div>
</template>

<style scoped>
.profile { display: flex; flex-direction: column; gap: 16px; }
.head { padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.name { font-size: 24px; margin: 4px 0 0; display: flex; align-items: center; gap: 8px; }
.star { background: none; border: none; font-size: 24px; color: var(--text-2); cursor: pointer; min-width: 44px; min-height: 44px; }
.star.on { color: var(--nq-gold); }
.address {
  background: none; border: none; cursor: pointer; color: var(--text-2);
  font-family: monospace; font-size: 13px; line-height: 1.5; word-break: break-all; padding: 4px;
}
.copy-hint { display: block; font-family: 'Mulish', sans-serif; font-size: 11px; color: var(--nq-light-blue); }
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.tag { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 3px 10px; font-size: 12px; }
.meta { font-size: 12px; color: var(--text-2); }
.actions { display: flex; gap: 10px; }
.actions.future { opacity: 0.45; }
.action {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 4px; min-height: 64px; font-size: 20px;
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); cursor: pointer; box-shadow: var(--shadow);
}
.action span { font-size: 12px; font-weight: 700; }
.action:disabled { cursor: default; }
.action.live:active { transform: scale(0.97); }
.own-qr { padding: 24px; text-align: center; }
.notes { padding: 16px 20px; }
.notes h2 { font-size: 14px; color: var(--text-2); margin: 0 0 6px; }
.notes p { margin: 0; white-space: pre-wrap; }
.manage { display: flex; justify-content: center; gap: 24px; }
.link { background: none; border: none; color: var(--nq-light-blue); font-weight: 700; cursor: pointer; min-height: 44px; }
.link.danger { color: var(--nq-red); }
.amount-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 12px; }
.amount-label input {
  font: inherit; font-size: 24px; padding: 10px 12px; text-align: center;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text);
}
.primary {
  width: 100%; height: 48px; border: none; border-radius: 24px; cursor: pointer;
  font-weight: 700; font-size: 16px; color: #fff; margin-top: 12px;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
}
.primary:disabled { opacity: 0.5; }
.ok { color: var(--nq-green); font-weight: 700; }
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.history { list-style: none; margin: 0; padding: 0; }
.history li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.dir.in { color: var(--nq-green); }
.dir.out { color: var(--nq-red); }
.value { flex: 1; font-weight: 700; }
.when { color: var(--text-2); font-size: 13px; }
</style>
