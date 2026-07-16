<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Profile, ProfileType } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { insideNimiqPay, sendNim, messageBytes, MESSAGE_MAX_BYTES, resolveMyAddresses, receiveAddress, walletStatus, formatNimAmount } from '../services/nimiq'
import { makeRequestLink, makePaymentShareLink, shortAddress, transactionExplorerUrl } from '../services/links'
import { makeProfileShareLink } from '../services/profile-share'
import { sendPaymentRequest, shouldAutoDeliverInbox, newNonce } from '../services/inbox'
import { shareOrCopy, canShare, copyText } from '../services/share'
import { fetchHistory, timestampMs, type HistoryItem } from '../services/history'
import { getRates, nimToFiat, type NimRates } from '../services/rates'
import { preferredCurrency } from '../services/prefs'
import { handleForAddress, handlesEnabled } from '../services/handles'
import Identicon from './Identicon.vue'
import QrCode from './QrCode.vue'
import ActionSheet from './ActionSheet.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'
import SpendableBalance from './SpendableBalance.vue'
import TipSheet from './TipSheet.vue'
import SplitBillSheet from './SplitBillSheet.vue'
import InvoiceSheet from './InvoiceSheet.vue'
import EmptyState from './EmptyState.vue'

type PaymentKind = 'paid' | 'received' | 'invoice' | 'split' | 'bucket'

const props = defineProps<{
  profile: Profile
  own?: boolean
  ownerHandle?: string
  ownerHandleConfirming?: boolean
  showClaimHandle?: boolean
}>()
defineEmits<{ edit: []; remove: []; 'claim-handle': [] }>()

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
const manageOpen = ref(false)
const shareFeedback = ref<string | null>(null)
const contactHandle = ref<string | null>(null)
const expandedTxHash = ref<string | null>(null)
const favPop = ref(false)
let favPopTimer: ReturnType<typeof setTimeout> | undefined

async function onFavoriteToggle() {
  await store.toggleFavorite(props.profile.id)
  favPop.value = false
  requestAnimationFrame(() => {
    favPop.value = true
    clearTimeout(favPopTimer)
    favPopTimer = setTimeout(() => { favPop.value = false }, 450)
  })
}

onUnmounted(() => clearTimeout(favPopTimer))

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
const dateAdded = computed(() => new Date(props.profile.createdAt).toLocaleDateString())
const abbreviatedAddress = computed(() => shortAddress(props.profile.address))

const rates = ref<NimRates | null>(null)

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(ms).toLocaleDateString()
}

function typeLabel(type: ProfileType): string | null {
  if (type === 'merchant') return 'Merchant'
  if (type === 'business') return 'Business'
  return null
}

function historyWhen(h: HistoryItem): string {
  return new Date(timestampMs(h.timestamp)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function historyDateTime(h: HistoryItem): string {
  const d = new Date(timestampMs(h.timestamp))
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${date} • ${time}`
}

function paymentKind(h: HistoryItem): PaymentKind {
  const msg = h.message?.trim() ?? ''
  if (msg.startsWith('🪣')) return 'bucket'
  if (/^split/i.test(msg)) return 'split'
  if (/invoice/i.test(msg)) return 'invoice'
  return h.incoming ? 'received' : 'paid'
}

function paymentIcon(kind: PaymentKind): string {
  if (kind === 'invoice') return '🧾'
  if (kind === 'split') return '👥'
  if (kind === 'bucket') return '🏖'
  return kind === 'received' ? '⬇' : '⬆'
}

function paymentVerb(h: HistoryItem): string {
  const kind = paymentKind(h)
  if (kind === 'invoice') return h.incoming ? 'Invoice paid' : 'Invoice paid'
  if (kind === 'split') return h.incoming ? 'Split bill' : 'Split bill'
  if (kind === 'bucket') return 'Bucket contribution'
  return h.incoming ? 'You received' : 'You paid'
}

/** Hide protocol noise; translate known payment tags into human labels. */
function displayMessage(h: HistoryItem): string | null {
  const msg = h.message?.trim()
  if (!msg) return null
  if (msg.startsWith('NFH:') || /^NB[0-9A-Z]*:/u.test(msg)) return null
  const compact = msg.replace(/\s+/g, '')
  if (/^[0-9a-fA-F]{12,}$/.test(compact)) return null
  const hexChars = (msg.match(/[0-9a-fA-F]/g) ?? []).length
  if (msg.length > 20 && hexChars / msg.length > 0.75) return null

  if (msg.startsWith('🪣')) {
    const body = msg.replace(/^🪣\s*/, '').replace(/\s*#[0-9a-fA-F]{4,}\s*$/i, '').trim()
    return body ? `🏖 ${body} contribution` : '🏖 Trip contribution'
  }
  if (/^split\s*:/i.test(msg)) {
    const body = msg.replace(/^split\s*:\s*/i, '').trim()
    return body ? `👥 ${body}` : null
  }
  if (/invoice/i.test(msg)) {
    const cleaned = msg.replace(/\binvoice\b/gi, '').replace(/\s{2,}/g, ' ').trim()
    return cleaned || null
  }
  return msg
}

function shortHash(hash: string): string {
  if (hash.length <= 12) return hash
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

function dayStartMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function historyGroupLabel(ms: number): string {
  const now = Date.now()
  const today = dayStartMs(now)
  const yesterday = today - 86_400_000
  const t = dayStartMs(ms)
  if (t === today) return 'Today'
  if (t === yesterday) return 'Yesterday'
  const date = new Date(ms)
  const current = new Date(now)
  if (date.getFullYear() === current.getFullYear() && date.getMonth() === current.getMonth()) {
    return 'This month'
  }
  if (date.getFullYear() === current.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'long' })
  }
  if (date.getFullYear() === current.getFullYear() - 1) {
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  }
  return 'Older'
}

function toggleTxDetails(hash: string) {
  expandedTxHash.value = expandedTxHash.value === hash ? null : hash
}

async function loadContactHandle() {
  if (props.own || !handlesEnabled()) {
    contactHandle.value = props.profile.handle ?? null
    return
  }
  try {
    const claim = await handleForAddress(props.profile.address)
    contactHandle.value = claim?.handle ?? props.profile.handle ?? null
    if (claim?.handle && claim.handle !== props.profile.handle) {
      await store.update(props.profile.id, { handle: claim.handle })
    }
  } catch {
    contactHandle.value = props.profile.handle ?? null
  }
}

onMounted(() => {
  const q = route.query.sheet
  if (q === 'invoice' || q === 'request') openSheet(q)
  if (props.own) return
  getRates().then(r => (rates.value = r))
  void loadContactHandle()
  if (store.self) loadHistory()
})

watch(() => props.profile.address, () => {
  if (!props.own) void loadContactHandle()
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

const paymentCounts = computed(() => {
  if (!history.value?.length) return null
  let sent = 0
  let received = 0
  for (const h of history.value) {
    if (h.incoming) received += 1
    else sent += 1
  }
  return { sent, received }
})

const lastPayment = computed(() => history.value?.[0] ?? null)

const relationshipHeadline = computed(() => {
  if (lastPayment.value) {
    const when = formatRelative(timestampMs(lastPayment.value.timestamp))
    return lastPayment.value.incoming ? `They paid you ${when}` : `You paid them ${when}`
  }
  if (props.profile.lastInteractionAt) {
    return `Last activity ${formatRelative(props.profile.lastInteractionAt)}`
  }
  return null
})

const lastTouchLabel = computed(() => {
  if (lastPayment.value) return lastPayment.value.incoming ? 'They paid you last' : 'You paid them last'
  if (props.profile.lastInteractionAt) return 'Last activity'
  return null
})

const lastTouchWhen = computed(() => {
  if (lastPayment.value) return formatRelative(timestampMs(lastPayment.value.timestamp))
  if (props.profile.lastInteractionAt) return formatRelative(props.profile.lastInteractionAt)
  return null
})

const recentActivity = computed(() => (history.value ?? []).slice(0, 2))

const historyGroups = computed(() => {
  if (!history.value?.length) return [] as { label: string; items: HistoryItem[] }[]
  const buckets = new Map<string, HistoryItem[]>()
  const labels: string[] = []
  for (const item of history.value) {
    const label = historyGroupLabel(timestampMs(item.timestamp))
    const list = buckets.get(label)
    if (list) list.push(item)
    else {
      buckets.set(label, [item])
      labels.push(label)
    }
  }
  // History is newest-first, so first-seen label order is Today → … → Older.
  return labels.map(label => ({ label, items: buckets.get(label)! }))
})

const contactTypeLabel = computed(() => typeLabel(props.profile.type))

const historySheetTitle = computed(() => `History with ${props.profile.name}`)

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

async function shareContact() {
  const result = await shareOrCopy(makeProfileShareLink(props.profile), props.profile.name)
  shareFeedback.value = result === 'shared' ? 'Shared ✓' : 'Link copied ✓'
  setTimeout(() => (shareFeedback.value = null), 2000)
}

const sendAmountInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const requestAmountInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const spendBalance = ref<number | null>(null)

function setMaxSend(nim: number) {
  amount.value = nim > 0 ? nim : null
  if (nim > 0) sendAmountInput.value?.setNim(nim)
  else sendAmountInput.value?.reset()
}

function openSheet(which: 'send' | 'request' | 'history' | 'tip' | 'split' | 'invoice') {
  amount.value = null
  sendAmountInput.value?.reset()
  requestAmountInput.value?.reset()
  message.value = ''
  sendResult.value = null
  expandedTxHash.value = null
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
  if (spendBalance.value != null && amount.value > spendBalance.value) {
    sendResult.value = `You have ${formatNimAmount(spendBalance.value)} NIM available for sending. Use Max or send a smaller amount.`
    return
  }
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

      <div class="name-row">
        <h1 class="name">{{ profile.name }}</h1>
        <button
          v-if="!own"
          type="button"
          class="favorite-btn"
          :class="{ on: profile.favorite }"
          :aria-label="profile.favorite ? 'Remove from favorites' : 'Add to favorites'"
          :aria-pressed="profile.favorite"
          @click="onFavoriteToggle"
        >
          <span
            class="favorite-star"
            :class="{ 'star-pop': favPop }"
            aria-hidden="true"
          >★</span>
        </button>
      </div>

      <div v-if="own && ownerHandle" class="owner-identity">
        <p class="owner-handle">
          @{{ ownerHandle }}
          <span v-if="ownerHandleConfirming" class="handle-status">Confirming…</span>
        </p>
        <div v-if="!ownerHandleConfirming" class="owner-status-row" aria-label="Identity status">
          <span class="owner-status-chip chip-verified">✓ Verified</span>
          <span class="owner-status-chip chip-live">🌍 Public profile live</span>
        </div>
      </div>
      <div v-else-if="!own && contactHandle" class="contact-identity">
        <router-link :to="`/u/${contactHandle}`" class="contact-handle">@{{ contactHandle }}</router-link>
        <span class="verified-chip">Verified public profile</span>
      </div>

      <div v-if="!own && (profile.favorite || contactTypeLabel || profile.tags.length)" class="identity-row">
        <span v-if="profile.favorite" class="identity-chip favorite-chip">★ Favorite</span>
        <span v-if="contactTypeLabel" class="identity-chip">{{ contactTypeLabel }}</span>
        <span v-for="t in profile.tags" :key="t" class="identity-chip">{{ t }}</span>
      </div>
      <div v-else-if="own && profile.tags.length" class="identity-row">
        <span v-for="t in profile.tags" :key="t" class="identity-chip">{{ t }}</span>
      </div>

      <p v-if="!own && relationshipHeadline" class="relationship-line">{{ relationshipHeadline }}</p>
      <p v-if="profile.bio" class="bio">{{ profile.bio }}</p>

      <button type="button" class="address" @click="copyAddress">
        <span class="address-value">{{ abbreviatedAddress }}</span>
        <span class="copy-hint">{{ copied ? 'Copied!' : 'Tap to copy' }}</span>
      </button>

      <div v-if="profile.website || profile.github || profile.x" class="link-row">
        <a v-if="profile.website" :href="profile.website" target="_blank" rel="noopener" class="link-chip">🌐 Website</a>
        <a v-if="profile.github" :href="`https://github.com/${encodeURIComponent(profile.github)}`" target="_blank" rel="noopener" class="link-chip">GitHub</a>
        <a v-if="profile.x" :href="`https://x.com/${encodeURIComponent(profile.x)}`" target="_blank" rel="noopener" class="link-chip">𝕏 @{{ profile.x }}</a>
      </div>
    </div>

    <div v-if="!own" class="card relationship">
      <div v-if="netBalance != null && netBalance !== 0" class="rel-block">
        <span class="rel-label">Net</span>
        <span class="rel-value" :class="netBalance > 0 ? 'pos' : 'neg'">
          {{ netBalance > 0 ? '+' : '−' }}{{ Math.abs(netBalance).toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
        </span>
        <span v-if="netBalanceFiat" class="rel-sub">{{ netBalanceFiat }}</span>
        <span class="rel-sub">{{
          netBalance > 0
            ? "You've received more than you've sent."
            : "You've sent more than you've received."
        }}</span>
      </div>

      <div v-if="lastTouchLabel && lastTouchWhen" class="rel-block">
        <span class="rel-label">{{ lastTouchLabel }}</span>
        <span class="rel-value quiet">{{ lastTouchWhen }}</span>
      </div>

      <div v-if="paymentCounts" class="rel-block">
        <span class="rel-label">Payments</span>
        <span class="rel-value quiet">
          You've sent {{ paymentCounts.sent }} · Received {{ paymentCounts.received }}
        </span>
      </div>

      <div v-if="monthStats" class="rel-block">
        <span class="rel-label">This month</span>
        <span class="rel-value quiet month-line">
          <span class="out">↑ {{ monthStats.sent }} NIM sent</span>
          <span class="in">↓ {{ monthStats.received }} NIM received</span>
        </span>
      </div>

      <div class="rel-block">
        <span class="rel-label">Added</span>
        <span class="rel-value quiet">{{ dateAdded }}</span>
      </div>
    </div>

    <div v-if="!own" class="primary-actions">
      <button type="button" class="primary-action send" @click="openSheet('send')">
        Send
      </button>
      <button type="button" class="primary-action request" @click="openSheet('request')">
        Request
      </button>
    </div>

    <div v-if="!own" class="secondary-actions">
      <button type="button" class="secondary-action" @click="openSheet('tip')">
        <span aria-hidden="true">💛</span>
        Tip
      </button>
      <button
        v-if="profile.type === 'person'"
        type="button"
        class="secondary-action"
        @click="openSheet('split')"
      >
        <span aria-hidden="true">🍕</span>
        Split bill
      </button>
      <button type="button" class="secondary-action" @click="openSheet('invoice')">
        <span aria-hidden="true">🧾</span>
        Invoice
      </button>
      <button type="button" class="secondary-action" @click="openSheet('history')">
        <span aria-hidden="true">🕘</span>
        History
      </button>
    </div>

    <div v-if="!own && store.self" class="card activity">
      <div class="activity-head">
        <h2>Recent activity</h2>
        <button
          v-if="recentActivity.length"
          type="button"
          class="view-all"
          @click="openSheet('history')"
        >
          View all →
        </button>
      </div>
      <div v-if="history === null && !historyError" class="activity-skeleton" aria-busy="true" aria-label="Loading activity">
        <div class="skeleton-row">
          <div class="skeleton skeleton-avatar" />
          <div class="skeleton-stack">
            <div class="skeleton skeleton-line medium" />
            <div class="skeleton skeleton-line short" />
          </div>
        </div>
        <div class="skeleton-row">
          <div class="skeleton skeleton-avatar" />
          <div class="skeleton-stack">
            <div class="skeleton skeleton-line long" />
            <div class="skeleton skeleton-line short" />
          </div>
        </div>
      </div>
      <p v-else-if="historyError" class="activity-empty">
        Activity is unavailable right now.
        <button type="button" class="view-all inline" @click="openSheet('history')">Try History</button>
      </p>
      <p v-else-if="!recentActivity.length" class="activity-empty">
        No payments yet — send or request to start this relationship.
      </p>
      <ul v-else class="activity-list">
        <li v-for="h in recentActivity" :key="h.hash">
          <span class="activity-check" aria-hidden="true">✓</span>
          <div class="activity-main">
            <span class="activity-verb">{{ h.incoming ? 'They paid you' : 'You paid' }}</span>
            <span class="activity-amount">
              {{ h.valueNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
            </span>
            <span v-if="h.message" class="activity-msg">“{{ h.message }}”</span>
          </div>
          <span class="activity-when">{{ historyWhen(h) }}</span>
        </li>
      </ul>
    </div>

    <div v-if="own" class="own-actions">
      <button type="button" class="edit-profile" @click="$emit('edit')">
        <span aria-hidden="true">✎</span>
        Edit public profile
      </button>
      <button
        v-if="showClaimHandle"
        type="button"
        class="claim-profile"
        @click="$emit('claim-handle')"
      >
        Claim your handle
      </button>
    </div>

    <div v-if="profile.notes" class="card notes">
      <h2>Notes</h2>
      <p>{{ profile.notes }}</p>
    </div>

    <div v-if="!own" class="manage-card">
      <button
        type="button"
        class="manage-toggle"
        :aria-expanded="manageOpen"
        @click="manageOpen = !manageOpen"
      >
        <span>Manage contact</span>
        <span class="manage-chevron" aria-hidden="true">{{ manageOpen ? '▴' : '▾' }}</span>
      </button>
      <div v-if="manageOpen" class="manage-menu">
        <button type="button" class="manage-item" @click="$emit('edit')">Edit</button>
        <button type="button" class="manage-item" @click="shareContact">
          {{ shareFeedback ?? (canShare() ? 'Share' : 'Export link') }}
        </button>
        <button type="button" class="manage-item danger" @click="$emit('remove')">Delete</button>
      </div>
    </div>

    <ActionSheet :open="sheet === 'send'" title="Send NIM" @close="sheet = null">
      <template v-if="insideNimiqPay">
        <SpendableBalance :when="sheet === 'send'" @balance="spendBalance = $event" @max="setMaxSend" />
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

    <ActionSheet :open="sheet === 'history'" :title="historySheetTitle" @close="sheet = null">
      <p v-if="historyError" class="hint">History is unavailable right now{{ store.self ? '' : ' — connect inside Nimiq Pay first' }}.</p>
      <div v-else-if="history === null" class="history-skeleton" aria-busy="true" aria-label="Loading history">
        <div class="skeleton skeleton-line long" />
        <div class="skeleton skeleton-line medium" />
        <div class="skeleton skeleton-line short" />
      </div>
      <EmptyState
        v-else-if="history.length === 0"
        icon="🕘"
        title="No payments yet"
        :hint="`Your payment history with ${profile.name} will appear here.`"
      />
      <div v-else class="history-feed">
        <section v-for="group in historyGroups" :key="group.label" class="history-group">
          <h3 class="history-group-label">{{ group.label }}</h3>
          <article
            v-for="h in group.items"
            :key="h.hash"
            class="history-card"
            :class="h.incoming ? 'in' : 'out'"
          >
            <div class="history-card-top">
              <span class="history-icon" aria-hidden="true">{{ paymentIcon(paymentKind(h)) }}</span>
              <span class="history-verb">{{ paymentVerb(h) }}</span>
            </div>
            <p class="history-amount">
              {{ h.valueNim.toLocaleString(undefined, { maximumFractionDigits: 5 }) }} NIM
            </p>
            <p v-if="fiatApprox(h.valueNim)" class="history-fiat">{{ fiatApprox(h.valueNim) }}</p>
            <p class="history-when">{{ historyDateTime(h) }}</p>
            <p v-if="displayMessage(h)" class="history-message">
              <span class="history-message-label">Message</span>
              {{ displayMessage(h) }}
            </p>
            <div class="history-details">
              <button
                type="button"
                class="history-details-toggle"
                :aria-expanded="expandedTxHash === h.hash"
                @click="toggleTxDetails(h.hash)"
              >
                <span aria-hidden="true">{{ expandedTxHash === h.hash ? '▾' : '▸' }}</span>
                Details
              </button>
              <div v-if="expandedTxHash === h.hash" class="history-tech">
                <div class="history-tech-row">
                  <span class="history-tech-label">Transaction hash</span>
                  <span class="history-tech-value mono">{{ shortHash(h.hash) }}</span>
                </div>
                <div v-if="h.blockNumber" class="history-tech-row">
                  <span class="history-tech-label">Block height</span>
                  <span class="history-tech-value">{{ h.blockNumber.toLocaleString() }}</span>
                </div>
                <div v-if="h.message" class="history-tech-row">
                  <span class="history-tech-label">Raw memo</span>
                  <span class="history-tech-value mono">{{ h.message }}</span>
                </div>
                <a
                  class="history-explorer"
                  :href="transactionExplorerUrl(h.hash)"
                  target="_blank"
                  rel="noopener"
                >
                  Explorer ↗
                </a>
              </div>
            </div>
          </article>
        </section>
      </div>
    </ActionSheet>
  </div>
</template>

<style scoped>
.profile { display: flex; flex-direction: column; gap: 16px; }
.head {
  padding: 28px 24px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  text-align: center;
}
.name-row {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-top: 4px; max-width: 100%;
}
.name {
  font-size: 28px; line-height: 1.15; margin: 0; font-weight: 800;
  letter-spacing: -0.02em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.favorite-btn {
  flex-shrink: 0;
  min-width: 44px; min-height: 44px; padding: 0;
  display: inline-grid; place-items: center;
  border: 1.5px solid var(--border); border-radius: 50%;
  background: var(--card); color: var(--text-40, var(--text-2));
  cursor: pointer;
  transition:
    background var(--attr-duration) var(--nimiq-ease),
    color var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease),
    box-shadow var(--attr-duration) var(--nimiq-ease);
}
.favorite-btn.on {
  background: var(--nimiq-gold-bg);
  border-color: transparent;
  color: var(--nimiq-blue);
  box-shadow: 0 2px 8px rgba(233, 178, 19, 0.35);
}
.favorite-star { font-size: 22px; line-height: 1; }
.favorite-btn.on .favorite-star { font-size: 24px; }
.activity-skeleton, .history-skeleton { margin-top: 8px; }
.history-skeleton { display: flex; flex-direction: column; gap: 10px; padding: 8px 0; }
.owner-identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.owner-handle {
  margin: 0; font-size: 16px; font-weight: 800; color: var(--nq-gold-dark);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center;
}
.handle-status { font-size: 12px; font-weight: 600; color: var(--text-2); }
.owner-status-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
.owner-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 0 10px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}
.chip-verified {
  color: var(--nq-green);
  background: color-mix(in srgb, var(--nq-green) 18%, transparent);
}
.chip-live {
  color: var(--nq-light-blue);
  background: color-mix(in srgb, var(--nq-light-blue) 16%, transparent);
}
.contact-identity {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.contact-handle {
  font-size: 16px; font-weight: 800; color: var(--nq-gold-dark);
  text-decoration: none;
}
.contact-handle:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 2px; border-radius: 4px; }
.verified-chip {
  display: inline-flex; align-items: center; min-height: 24px; padding: 0 10px;
  border-radius: var(--nimiq-radius-pill);
  background: rgba(33, 188, 165, 0.12);
  color: var(--nq-green);
  font-size: 11px; font-weight: 800;
}
.identity-row {
  display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
  margin-top: 2px;
}
.identity-chip {
  display: inline-flex; align-items: center; min-height: 28px; padding: 0 12px;
  border-radius: var(--nimiq-radius-pill);
  background: var(--text-6); border: 1px solid var(--border);
  font-size: 12px; font-weight: 700; color: var(--text-80, var(--text-2));
  text-transform: capitalize;
}
.favorite-chip {
  background: rgba(233, 178, 19, 0.16);
  border-color: rgba(233, 178, 19, 0.35);
  color: var(--nq-gold-dark);
}
.relationship-line {
  margin: 2px 0 0;
  font-size: 14px; font-weight: 700; color: var(--text-2);
}
.bio { margin: 0; color: var(--text-2); font-size: 14px; max-width: 320px; }
.address {
  margin-top: 4px;
  background: none; border: none; cursor: pointer; color: var(--text-2);
  padding: 6px 8px; border-radius: var(--nimiq-radius-small);
}
.address:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 2px; }
.address-value {
  display: block;
  font-family: var(--nimiq-font-family-mono); font-size: 13px; line-height: 1.4;
}
.copy-hint {
  display: block; margin-top: 2px;
  font-family: var(--nimiq-font-family); font-size: 11px; font-weight: 700;
  color: var(--nq-light-blue);
}
.link-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.link-chip {
  display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill);
  color: var(--nq-light-blue); font-size: 13px; font-weight: 700; text-decoration: none;
}

.relationship {
  padding: 8px 20px 12px;
  display: flex; flex-direction: column;
}
.rel-block {
  display: flex; flex-direction: column; gap: 4px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.rel-block:last-child { border-bottom: none; }
.rel-label {
  font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
  text-transform: uppercase; color: var(--text-2);
}
.rel-value { font-size: 18px; font-weight: 800; line-height: 1.25; }
.rel-value.quiet { font-size: 15px; font-weight: 700; }
.rel-value.pos { color: var(--nq-green); }
.rel-value.neg { color: var(--nq-gold-dark); }
.rel-sub { font-size: 13px; font-weight: 600; color: var(--text-2); }
.month-line { display: flex; flex-direction: column; gap: 4px; }
.month-line .out { color: var(--nq-gold-dark); }
.month-line .in { color: var(--nq-green); }

.primary-actions { display: flex; gap: 10px; }
.primary-action {
  flex: 1; min-height: 56px; padding: 0 16px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: none; border-radius: var(--nimiq-radius-pill);
  font: inherit; font-size: 17px; font-weight: 800;
  cursor: pointer; box-shadow: var(--nimiq-shadow);
  transition: transform var(--attr-duration) var(--nimiq-ease), filter var(--attr-duration) var(--nimiq-ease);
}
.primary-action:active { transform: scale(0.98); }
.primary-action:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }
.primary-action.send {
  background: var(--nimiq-gold-bg); color: var(--nimiq-blue);
}
.primary-action.request {
  background: var(--nimiq-light-blue-darkened); color: var(--nimiq-white);
}
.secondary-actions {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.secondary-action {
  flex: 1 1 calc(25% - 6px); min-width: 72px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  min-height: 64px; padding: 10px 4px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--card); color: var(--text);
  font: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; box-shadow: var(--shadow);
}
.secondary-action span:first-child { font-size: 18px; line-height: 1; }
.secondary-action:active { transform: scale(0.97); }

.activity { padding: 18px 20px; }
.activity-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 8px;
}
.activity h2 { margin: 0; font-size: 15px; font-weight: 800; }
.view-all {
  background: none; border: none; padding: 4px 0; cursor: pointer;
  color: var(--nq-light-blue); font: inherit; font-size: 13px; font-weight: 800;
}
.activity-empty { margin: 8px 0 0; color: var(--text-2); font-size: 14px; line-height: 1.45; }
.view-all.inline {
  display: inline; margin-left: 4px; padding: 0;
  font-size: inherit;
}
.activity-list { list-style: none; margin: 0; padding: 0; }
.activity-list li {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.activity-list li:last-child { border-bottom: none; padding-bottom: 0; }
.activity-check {
  flex-shrink: 0; width: 22px; height: 22px; margin-top: 1px;
  display: inline-grid; place-items: center;
  border-radius: 50%;
  background: rgba(33, 188, 165, 0.14); color: var(--nq-green);
  font-size: 12px; font-weight: 800;
}
.activity-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.activity-verb { font-size: 13px; font-weight: 700; color: var(--text-2); }
.activity-amount { font-size: 15px; font-weight: 800; }
.activity-msg {
  font-size: 13px; color: var(--text-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.activity-when { flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--text-2); }

.own-actions { display: flex; gap: 10px; width: 100%; }
.edit-profile {
  flex: 1; min-height: 48px; padding: 0 16px;
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
.claim-profile {
  flex: 1; min-height: 48px; padding: 0 16px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-gold-bg); color: var(--nimiq-white);
  box-shadow: var(--nimiq-shadow);
  cursor: pointer; font: inherit; font-size: 15px; font-weight: 700;
}
.claim-profile:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }
.notes { padding: 16px 20px; }
.notes h2 { font-size: 14px; color: var(--text-2); margin: 0 0 6px; }
.notes p { margin: 0; white-space: pre-wrap; }

.manage-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  overflow: hidden;
}
.manage-toggle {
  width: 100%; min-height: 48px; padding: 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  border: none; background: transparent; color: var(--text-2);
  font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
}
.manage-chevron { font-size: 12px; }
.manage-menu {
  display: flex; flex-direction: column;
  border-top: 1px solid var(--border);
  padding: 4px 0;
}
.manage-item {
  min-height: 44px; padding: 0 16px;
  border: none; background: none; text-align: left;
  color: var(--nq-light-blue); font: inherit; font-weight: 700; cursor: pointer;
}
.manage-item.danger { color: var(--nq-red); }

.secondary {
  min-height: 44px; padding: 0 16px; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
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

.history-feed { display: flex; flex-direction: column; gap: 20px; padding-bottom: 8px; }
.history-group { display: flex; flex-direction: column; gap: 10px; }
.history-group-label {
  margin: 0;
  font-size: 12px; font-weight: 800; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--text-2);
}
.history-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}
.history-card-top {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 2px;
}
.history-icon { font-size: 16px; line-height: 1; }
.history-verb { font-size: 13px; font-weight: 700; color: var(--text-2); }
.history-card.out .history-verb { color: var(--nq-gold-dark); }
.history-card.in .history-verb { color: var(--nq-green); }
.history-amount {
  margin: 0;
  font-size: 24px; font-weight: 800; line-height: 1.15;
  letter-spacing: -0.02em;
}
.history-fiat { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.history-when { margin: 4px 0 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.history-message {
  margin: 8px 0 0; padding: 10px 12px;
  border-radius: var(--nimiq-radius-small);
  background: var(--card);
  border: 1px solid var(--border);
  font-size: 14px; font-weight: 600; color: var(--text);
  white-space: pre-wrap; word-break: break-word;
}
.history-message-label {
  display: block; margin-bottom: 2px;
  font-size: 11px; font-weight: 800; letter-spacing: 0.03em;
  text-transform: uppercase; color: var(--text-2);
}
.history-details { margin-top: 10px; }
.history-details-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; padding: 0;
  color: var(--text-2); font: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer;
}
.history-details-toggle:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 2px; border-radius: 4px; }
.history-tech {
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 10px; padding: 12px;
  border-radius: var(--nimiq-radius-small);
  background: var(--card);
  border: 1px solid var(--border);
}
.history-tech-row {
  display: flex; flex-direction: column; gap: 2px;
}
.history-tech-label {
  font-size: 11px; font-weight: 800; letter-spacing: 0.03em;
  text-transform: uppercase; color: var(--text-2);
}
.history-tech-value {
  font-size: 13px; font-weight: 600; color: var(--text);
  word-break: break-all;
}
.history-tech-value.mono { font-family: var(--nimiq-font-family-mono); font-weight: 500; }
.history-explorer {
  align-self: flex-start;
  margin-top: 2px;
  color: var(--nq-light-blue); text-decoration: none;
  font-size: 13px; font-weight: 800;
}
.history-explorer:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 2px; border-radius: 4px; }

@media (max-width: 360px) {
  .secondary-action { flex-basis: calc(50% - 4px); }
  .name { font-size: 24px; }
}
</style>
