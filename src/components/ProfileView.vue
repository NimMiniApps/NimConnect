<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { insideNimiqPay, sendNim, messageBytes, MESSAGE_MAX_BYTES, resolveMyAddresses, receiveAddress, walletStatus } from '../services/nimiq'
import { makeRequestLink, makePaymentShareLink, transactionExplorerUrl } from '../services/links'
import { sendPaymentRequest, shouldAutoDeliverInbox, newNonce } from '../services/inbox'
import { makeProfileShareLink } from '../services/profile-share'
import { shareOrCopy, canShare, copyText } from '../services/share'
import { fetchHistory, timestampMs, type HistoryItem } from '../services/history'
import { getRates, nimToFiat, type NimRates } from '../services/rates'
import { preferredCurrency } from '../services/prefs'
import Identicon from './Identicon.vue'
import QrCode from './QrCode.vue'
import ActionSheet from './ActionSheet.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'
import TipSheet from './TipSheet.vue'
import SplitBillSheet from './SplitBillSheet.vue'
import InvoiceSheet from './InvoiceSheet.vue'

const props = defineProps<{ profile: Profile; own?: boolean }>()
defineEmits<{ edit: []; remove: [] }>()

const store = useProfilesStore()
const route = useRoute()
const sheet = ref<'send' | 'request' | 'history' | 'tip' | 'split' | 'invoice' | null>(null)
const amount = ref<number | null>(null)
const message = ref('')
const messageTooLong = computed(() => messageBytes(message.value) > MESSAGE_MAX_BYTES)
const sending = ref(false)
const sendResult = ref<'ok' | string | null>(null)
const history = ref<HistoryItem[] | null>(null)
const historyError = ref(false)
const copied = ref(false)

// Requests are always paid to *my* address — own profile or asking a contact.
const requestLink = computed(() => {
  const self = props.own ? props.profile.address : store.self?.address
  if (!self) return ''
  return makeRequestLink(receiveAddress(self) ?? self, amount.value ?? undefined)
})
const requestShareLink = computed(() => {
  const self = props.own ? props.profile.address : store.self?.address
  if (!self) return ''
  return makePaymentShareLink(receiveAddress(self) ?? self, amount.value ?? undefined)
})
const shareLink = computed(() => makeProfileShareLink(props.profile))
const dateAdded = computed(() => new Date(props.profile.createdAt).toLocaleDateString())
const lastSeen = computed(() =>
  props.profile.lastInteractionAt ? new Date(props.profile.lastInteractionAt).toLocaleDateString() : null,
)

const rates = ref<NimRates | null>(null)

onMounted(() => {
  if (props.own) return
  getRates().then(r => (rates.value = r))
  if (store.self) loadHistory()
  if (route.query.sheet === 'invoice') openSheet('invoice')
})

watch(() => walletStatus.value, (status, prev) => {
  if (props.own || !store.self) return
  if (status === 'ready' && prev !== 'ready') loadHistory()
})

/** Net NIM between you and this contact: positive = they've sent you more. */
const netBalance = computed(() => {
  if (!history.value?.length) return null
  return history.value.reduce((sum, h) => sum + (h.incoming ? h.valueNim : -h.valueNim), 0)
})

/** NIM sent/received with this contact since the 1st of the current month. */
const monthStats = computed(() => {
  if (!history.value?.length) return null
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  let sent = 0
  let received = 0
  for (const h of history.value) {
    if (timestampMs(h.timestamp) < start.getTime()) continue
    if (h.incoming) received += h.valueNim
    else sent += h.valueNim
  }
  if (!sent && !received) return null
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return { sent: fmt(sent), received: fmt(received) }
})

const netBalanceFiat = computed(() => {
  if (netBalance.value == null || preferredCurrency.value === 'NIM' || !rates.value) return null
  const amount = nimToFiat(Math.abs(netBalance.value), preferredCurrency.value, rates.value)
  if (amount == null) return null
  return `≈ ${amount.toLocaleString(undefined, { style: 'currency', currency: preferredCurrency.value })}`
})

/** "≈ 1.23 €" at today's rate, or null when NIM-only / rates missing. */
function fiatApprox(nim: number): string | null {
  if (preferredCurrency.value === 'NIM' || !rates.value) return null
  const amount = nimToFiat(nim, preferredCurrency.value, rates.value)
  if (amount == null) return null
  return `≈ ${amount.toLocaleString(undefined, { style: 'currency', currency: preferredCurrency.value })}`
}

async function copyAddress() {
  await copyText(props.profile.address)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

const sendAmountInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const requestAmountInput = ref<InstanceType<typeof CurrencyAmountInput>>()

function openSheet(which: 'send' | 'request' | 'history' | 'tip' | 'split' | 'invoice') {
  amount.value = null
  sendAmountInput.value?.reset()
  requestAmountInput.value?.reset()
  message.value = ''
  sendResult.value = null
  sheet.value = which
  if (which === 'history') {
    loadHistory()
    store.touchInteraction(props.profile.id)
  }
  if (which === 'request') {
    store.touchInteraction(props.profile.id)
    // One object id per sheet open: re-tapping Send delivers a reminder, not a duplicate
    requestObjectId = newNonce()
    sendingRequest.value = false
    requestSent.value = false
    requestError.value = null
    if (shouldAutoDeliverInbox(props.profile.address, store.contacts)) {
      void sendRequestToInbox()
    }
  }
}

let requestObjectId = ''
const sendingRequest = ref(false)
const requestSent = ref(false)
const requestError = ref<string | null>(null)

async function sendRequestToInbox() {
  if (!store.self) return
  sendingRequest.value = true
  requestError.value = null
  try {
    await sendPaymentRequest({
      recipient: props.profile.address,
      // Payload must pay the wallet-signed sender, so use the raw profile address
      payload: makeRequestLink(store.self.address, amount.value ?? undefined),
      objectId: requestObjectId,
      sender: store.self.address,
    })
    requestSent.value = true
    setTimeout(() => (requestSent.value = false), 2500)
  } catch (e) {
    requestError.value = e instanceof Error ? e.message : 'Sending failed'
  } finally {
    sendingRequest.value = false
  }
}

async function doSend() {
  if (!amount.value) return
  sending.value = true
  sendResult.value = null
  try {
    await sendNim(props.profile.address, amount.value, message.value)
    sendResult.value = 'ok'
    await store.touchInteraction(props.profile.id)
  } catch (e) {
    sendResult.value = (e as Error).message
  } finally {
    sending.value = false
  }
}

const requestLinkCopied = ref(false)

async function copyRequestLink() {
  const result = await shareOrCopy(requestShareLink.value, 'Payment request')
  if (result === 'copied') {
    requestLinkCopied.value = true
    setTimeout(() => (requestLinkCopied.value = false), 1500)
  }
  store.touchInteraction(props.profile.id)
}

async function loadHistory() {
  history.value = null
  historyError.value = false
  // Nimiq Pay pays from one account and receives on another — check all of them
  const mine = await resolveMyAddresses(store.self?.address)
  if (!mine.length) {
    historyError.value = true
    return
  }
  try {
    history.value = await fetchHistory(mine, props.profile.address)
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
      <p v-if="profile.bio" class="bio">{{ profile.bio }}</p>
      <button class="address" @click="copyAddress">
        {{ profile.address }}
        <span class="copy-hint">{{ copied ? 'Copied!' : 'Tap to copy' }}</span>
      </button>
      <div v-if="profile.tags.length" class="tag-row">
        <span v-for="t in profile.tags" :key="t" class="tag">{{ t }}</span>
      </div>
      <div v-if="profile.website || profile.github || profile.x" class="link-row">
        <a v-if="profile.website" :href="profile.website" target="_blank" rel="noopener" class="link-chip">🌐 Website</a>
        <a v-if="profile.github" :href="`https://github.com/${encodeURIComponent(profile.github)}`" target="_blank" rel="noopener" class="link-chip">GitHub</a>
        <a v-if="profile.x" :href="`https://x.com/${encodeURIComponent(profile.x)}`" target="_blank" rel="noopener" class="link-chip">𝕏 @{{ profile.x }}</a>
      </div>
      <div v-if="!own && netBalance != null && netBalance !== 0" class="balance" :class="netBalance > 0 ? 'pos' : 'neg'">
        {{ netBalance > 0 ? '+' : '−' }}{{ Math.abs(netBalance).toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
        <span v-if="netBalanceFiat" class="balance-fiat">{{ netBalanceFiat }}</span>
        <span class="balance-hint">{{ netBalance > 0 ? 'net received from them' : 'net sent to them' }}</span>
      </div>
      <div v-if="!own && monthStats" class="month-stats">
        This month: <span class="out">↑ {{ monthStats.sent }} NIM sent</span> · <span class="in">↓ {{ monthStats.received }} NIM received</span>
      </div>
      <div class="meta">
        <span>Added {{ dateAdded }}</span>
        <span v-if="lastSeen"> · Last activity {{ lastSeen }}</span>
      </div>
    </div>

    <div v-if="!own" class="actions">
      <button class="action live" @click="openSheet('send')">💸<span>Send</span></button>
      <button class="action live" @click="openSheet('request')">📥<span>Request</span></button>
      <button class="action live" @click="openSheet('tip')">💛<span>Tip</span></button>
    </div>
    <div v-if="!own" class="actions">
      <button v-if="!own && profile.type === 'person'" class="action live" @click="openSheet('split')">🍕<span>Split Bill</span></button>
      <button class="action live" @click="openSheet('invoice')">🧾<span>Invoice</span></button>
      <button class="action live" @click="openSheet('history')">🕘<span>History</span></button>
    </div>
    <button v-if="own" type="button" class="edit-profile" @click="$emit('edit')">
      <span aria-hidden="true">✎</span>
      Edit profile
    </button>

    <div v-if="own" class="card own-qr">
      <QrCode :text="shareLink" :size="220" />
      <p class="hint">Let others scan this to add your full profile in NimConnect.</p>
    </div>

    <div v-if="profile.notes" class="card notes">
      <h2>Notes</h2>
      <p>{{ profile.notes }}</p>
    </div>

    <div v-if="!own" class="manage">
      <button type="button" class="secondary" @click="$emit('edit')">Edit</button>
      <button type="button" class="secondary danger" @click="$emit('remove')">Delete</button>
    </div>

    <ActionSheet :open="sheet === 'send'" title="Send NIM" @close="sheet = null">
      <template v-if="insideNimiqPay">
        <label class="amount-label">
          Amount
          <CurrencyAmountInput ref="sendAmountInput" placeholder="0.00" @update:model-value="amount = $event" />
        </label>
        <label class="message-label">
          Message (optional, goes with the payment)
          <input v-model="message" maxlength="64" placeholder="Thanks for lunch! 🍜" />
          <span v-if="messageTooLong" class="err">Too long — max {{ MESSAGE_MAX_BYTES }} bytes (emoji count as more).</span>
        </label>
        <p v-if="sendResult === 'ok'" class="ok">✓ Sent to {{ profile.name }}</p>
        <p v-else-if="sendResult" class="err">{{ sendResult }}</p>
        <button
          v-if="sendResult === 'ok'"
          class="primary"
          @click="sheet = null"
        >Done</button>
        <button v-else class="primary" :disabled="!amount || sending || messageTooLong" @click="doSend">
          {{ sending ? 'Waiting for confirmation…' : `Send to ${profile.name}` }}
        </button>
      </template>
      <p v-else class="hint">Open NimConnect inside Nimiq Pay to send NIM directly.</p>
    </ActionSheet>

    <ActionSheet :open="sheet === 'request'" title="Request payment" @close="sheet = null">
      <template v-if="requestLink">
        <label class="amount-label">
          Amount (optional)
          <CurrencyAmountInput ref="requestAmountInput" placeholder="Any amount" @update:model-value="amount = $event" />
        </label>
        <QrCode :text="requestLink" :size="220" />
        <p v-if="shouldAutoDeliverInbox(profile.address, store.contacts)" class="hint">
          <template v-if="requestSent">Sent to {{ profile.name }}'s NimConnect.</template>
          <template v-else-if="sendingRequest">Sending to {{ profile.name }}'s NimConnect…</template>
          <template v-else-if="requestError">Inbox delivery failed — share the link below.</template>
          <template v-else>{{ profile.name }} gets this in NimConnect when you confirm the wallet signature.</template>
        </p>
        <p v-else class="hint">{{ profile.name }} can scan this QR or open the shared link to pay you.</p>
        <button
          v-if="shouldAutoDeliverInbox(profile.address, store.contacts)"
          type="button"
          class="secondary"
          :disabled="sendingRequest"
          @click="sendRequestToInbox"
        >
          {{ requestSent ? 'Sent!' : sendingRequest ? 'Sending…' : requestError ? 'Retry NimConnect' : 'Send again' }}
        </button>
        <p v-if="requestError" class="hint err">{{ requestError }}</p>
        <button type="button" class="primary" @click="copyRequestLink">
          {{ requestLinkCopied ? 'Copied!' : canShare() ? 'Share payment link' : 'Copy payment link' }}
        </button>
      </template>
      <p v-else class="hint">Create your own profile first — payment requests are paid to your address.</p>
    </ActionSheet>

    <TipSheet v-if="!own" :profile="profile" :open="sheet === 'tip'" @close="sheet = null" />
    <SplitBillSheet v-if="!own" :profile="profile" :open="sheet === 'split'" @close="sheet = null" />
    <InvoiceSheet v-if="!own" :profile="profile" :open="sheet === 'invoice'" @close="sheet = null" />

    <ActionSheet :open="sheet === 'history'" title="Payment history" @close="sheet = null">
      <p v-if="historyError" class="hint">History is unavailable right now{{ store.self ? '' : ' — connect inside Nimiq Pay first' }}.</p>
      <p v-else-if="history === null" class="hint">Loading…</p>
      <p v-else-if="history.length === 0" class="hint">No payments between you and {{ profile.name }} yet.</p>
      <ul v-else class="history">
        <li v-for="h in history" :key="h.hash">
          <span class="dir" :class="h.incoming ? 'in' : 'out'">{{ h.incoming ? '←' : '→' }}</span>
          <span class="value">
            {{ h.incoming ? '+' : '−' }}{{ h.valueNim }} NIM
            <span v-if="fiatApprox(h.valueNim)" class="tx-fiat">{{ fiatApprox(h.valueNim) }}</span>
            <span v-if="h.message" class="tx-message">“{{ h.message }}”</span>
          </span>
          <span class="when">{{ new Date(h.timestamp * (h.timestamp < 1e12 ? 1000 : 1)).toLocaleDateString() }}</span>
          <a class="tx-link" :href="transactionExplorerUrl(h.hash)" target="_blank" rel="noopener">Explorer</a>
        </li>
      </ul>
    </ActionSheet>
  </div>
</template>

<style scoped>
.profile { display: flex; flex-direction: column; gap: 16px; }
.head { padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.name { font-size: 24px; line-height: 1.2; margin: 4px 0 0; display: flex; align-items: center; gap: 8px; }
.star { background: none; border: none; font-size: 24px; color: var(--text-2); cursor: pointer; min-width: 44px; min-height: 44px; }
.star.on { color: var(--nq-gold); }
.address {
  background: none; border: none; cursor: pointer; color: var(--text-2);
  font-family: var(--nimiq-font-family-mono); font-size: 13px; line-height: 1.5; word-break: break-all; padding: 4px;
}
.copy-hint { display: block; font-family: var(--nimiq-font-family); font-size: 11px; color: var(--nq-light-blue); }
.bio { margin: 0; color: var(--text-2); font-size: 14px; max-width: 320px; }
.link-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.link-chip {
  display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill);
  color: var(--nq-light-blue); font-size: 13px; font-weight: 700; text-decoration: none;
}
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.tag { background: var(--text-6); border: 1px solid var(--border); border-radius: var(--nimiq-radius-small); padding: 3px 10px; font-size: 12px; }
.meta { font-size: 12px; color: var(--text-2); }
.month-stats { font-size: 13px; font-weight: 600; color: var(--text-2); }
.month-stats .out { color: var(--nq-gold-dark); }
.month-stats .in { color: var(--nq-green); }
.balance {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 16px; border-radius: var(--nimiq-radius-pill);
  font-size: 15px; font-weight: 800;
}
.balance.pos { color: var(--nq-green); background: rgba(33, 188, 165, 0.12); }
.balance.neg { color: var(--nq-gold-dark); background: var(--text-6); }
.balance-fiat { font-size: 12px; font-weight: 600; color: var(--text-2); }
.balance-hint { font-size: 11px; font-weight: 600; color: var(--text-2); }
.actions { display: flex; gap: 10px; }
.action {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 4px; min-height: 64px; font-size: 20px;
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); cursor: pointer; box-shadow: var(--shadow);
}
.action span { font-size: 12px; font-weight: 700; }
.action:disabled { cursor: default; }
.action.live:active { transform: scale(0.97); }
.edit-profile {
  width: 100%; min-height: 48px; padding: 0 24px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: none; border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-light-blue-bg); color: var(--nimiq-white);
  box-shadow: var(--nimiq-shadow); cursor: pointer;
  font: inherit; font-size: 16px; font-weight: 700;
  transition: transform var(--attr-duration) var(--nimiq-ease), filter var(--attr-duration) var(--nimiq-ease);
}
.edit-profile:hover { filter: brightness(0.96); }
.edit-profile:active { transform: scale(0.98); }
.edit-profile:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }
.own-qr { padding: 24px; text-align: center; }
.notes { padding: 16px 20px; }
.notes h2 { font-size: 14px; color: var(--text-2); margin: 0 0 6px; }
.notes p { margin: 0; white-space: pre-wrap; }
.manage { display: flex; gap: 8px; }
.manage .secondary { flex: 1; }
.secondary {
  min-height: 44px; padding: 0 16px; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
.secondary.danger { color: var(--nq-red); }
.amount-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 12px; }
.message-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 12px; }
.message-label input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.amount-label input {
  font: inherit; font-size: 24px; padding: 10px 12px; text-align: center;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); margin-top: 12px;
  background: var(--nimiq-gold-bg);
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
.tx-message { display: block; font-weight: 400; font-size: 13px; color: var(--text-2); }
.tx-fiat { display: inline-block; margin-left: 6px; font-weight: 400; font-size: 12px; color: var(--text-2); }
.when { color: var(--text-2); font-size: 13px; }
.tx-link { color: var(--nq-light-blue); font-size: 13px; font-weight: 800; text-decoration: none; }
</style>
