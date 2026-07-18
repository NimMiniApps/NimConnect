<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore } from '../stores/invoices'
import { makeRequestLink, makePaymentShareLink, nimToLunas } from '../services/links'
import { receiveAddress } from '../services/nimiq'
import { splitAmount } from '../utils/split'
import { sendPaymentRequest, shouldAutoDeliverInbox, inboxAvailable } from '../services/inbox'
import { shareOrCopy, canShare } from '../services/share'
import { celebrateOnce } from '../services/delight'
import { getRates, nimToFiat, type NimRates } from '../services/rates'
import { preferredCurrency } from '../services/prefs'
import ActionSheet from './ActionSheet.vue'
import Identicon from './Identicon.vue'
import QrCode from './QrCode.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'

const props = defineProps<{ profile?: Profile; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const store = useProfilesStore()
const invoicesStore = useInvoicesStore()

const total = ref<number | null>(null)
const fiatInfo = ref<{ amount: number; currency: string } | null>(null)
const rates = ref<NimRates | null>(null)
const totalInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const note = ref('')
const includeMe = ref(true)
const splitMode = ref<'equal' | 'custom'>('equal')
const selected = ref<Set<string>>(new Set())
const shares = ref<Record<string, number>>({})
const copiedId = ref<string | null>(null)
const creating = ref(false)
const created = ref(false)
const invoiceIds = ref<Record<string, string>>({})
const sendingId = ref<string | null>(null)
const sentId = ref<string | null>(null)
const sendErrors = ref<Record<string, string>>({})
const filter = ref('')

const splittable = computed(() => store.sortedContacts.filter(p => p.type === 'person'))

onMounted(async () => {
  void store.load()
  void invoicesStore.load()
  rates.value = await getRates()
})

watch(() => props.open, async open => {
  if (!open) return
  void store.load()
  rates.value = await getRates()
  selected.value = new Set(props.profile?.type === 'person' ? [props.profile.id] : [])
  created.value = false
  invoiceIds.value = {}
  sendErrors.value = {}
  splitMode.value = 'equal'
})

watch([total, selected, includeMe, shares], () => {
  created.value = false
})

const participants = computed(() =>
  splittable.value.filter(p => selected.value.has(p.id)),
)

const headcount = computed(() => participants.value.length + (includeMe.value ? 1 : 0))

function matchesFilter(p: Profile): boolean {
  const q = filter.value.trim().toLowerCase()
  if (!q) return true
  return store.search(filter.value).some(r => r.id === p.id)
}

const favoriteIds = computed(() => new Set(store.favorites.map(p => p.id)))

const pickerSections = computed(() => {
  const unused = (p: Profile) => p.type === 'person' && !selected.value.has(p.id) && matchesFilter(p)
  const favorites = store.favorites.filter(unused)
  const favIds = new Set(favorites.map(p => p.id))
  const recent = store.recent.filter(p => unused(p) && !favoriteIds.value.has(p.id) && !favIds.has(p.id))
  const recentIds = new Set(recent.map(p => p.id))
  const everyone = store.sortedContacts.filter(
    p => unused(p) && !favoriteIds.value.has(p.id) && !recentIds.has(p.id),
  )
  const searching = filter.value.trim().length > 0
  if (searching) {
    return [{ title: 'Matches', items: store.search(filter.value).filter(p => unused(p)) }]
      .filter(s => s.items.length > 0)
  }
  return [
    { title: '⭐ Favorites', items: favorites },
    { title: '🕒 Recently active', items: recent },
    { title: '👥 Everyone', items: everyone },
  ].filter(s => s.items.length > 0)
})

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

watch([total, selected, includeMe, splitMode], () => {
  if (splitMode.value !== 'equal') return
  const n = headcount.value
  if (!total.value || n === 0) {
    shares.value = {}
    return
  }
  const parts = splitAmount(total.value, n)
  const next: Record<string, number> = {}
  participants.value.forEach((p, i) => { next[p.id] = parts[i + (includeMe.value ? 1 : 0)] })
  shares.value = next
})

const contactsSumLunas = computed(() =>
  participants.value.reduce((s, p) => s + nimToLunas(shares.value[p.id] ?? 0), 0),
)
const myShareNim = computed(() => {
  if (!total.value) return 0
  return (nimToLunas(total.value) - contactsSumLunas.value) / 1e5
})
const valid = computed(() => {
  if (!total.value || participants.value.length === 0) return false
  if (participants.value.some(p => !((shares.value[p.id] ?? 0) > 0))) return false
  if (includeMe.value) return myShareNim.value >= 0
  return contactsSumLunas.value === nimToLunas(total.value)
})

function formatFiat(amount: number, currency: string): string {
  return amount.toLocaleString(undefined, { style: 'currency', currency })
}

function formatNim(nim: number): string {
  return `${nim.toLocaleString(undefined, { maximumFractionDigits: 2 })} NIM`
}

/** Display a share in the user's entry currency first when possible. */
function shareLabels(nim: number): { primary: string; secondary: string | null } {
  if (fiatInfo.value && total.value && total.value > 0) {
    const fiatShare = fiatInfo.value.amount * (nim / total.value)
    return {
      primary: formatFiat(fiatShare, fiatInfo.value.currency),
      secondary: `≈ ${formatNim(nim)}`,
    }
  }
  const currency = preferredCurrency.value
  if (currency !== 'NIM' && rates.value) {
    const fiat = nimToFiat(nim, currency, rates.value)
    if (fiat != null) {
      return {
        primary: formatNim(nim),
        secondary: `≈ ${formatFiat(fiat, currency)}`,
      }
    }
  }
  return { primary: formatNim(nim), secondary: null }
}

const summaryTitle = computed(() => note.value.trim() || 'Untitled bill')
const summaryTotal = computed(() => {
  if (fiatInfo.value) return formatFiat(fiatInfo.value.amount, fiatInfo.value.currency)
  if (total.value) return formatNim(total.value)
  return ''
})

/** Live visual split — recalculates as people are added or shares change. */
const breakdownRows = computed(() => {
  const rows: { key: string; label: string; amount: string }[] = []
  if (includeMe.value && total.value && headcount.value > 0) {
    rows.push({
      key: 'me',
      label: 'Me',
      amount: shareLabels(myShareNim.value).primary,
    })
  }
  for (const p of participants.value) {
    rows.push({
      key: p.id,
      label: p.name,
      amount: shareLabels(shares.value[p.id] ?? 0).primary,
    })
  }
  return rows
})

const ctaLabel = computed(() => {
  if (creating.value) return inboxAvailable() ? 'Creating & sending…' : 'Saving…'
  const n = participants.value.length
  if (n === 1) {
    const p = participants.value[0]!
    const share = shareLabels(shares.value[p.id] ?? 0).primary
    return `Request ${share} from ${p.name}`
  }
  return `Create ${n} requests`
})

const previewLines = computed(() => {
  if (!valid.value) return [] as string[]
  const lines: string[] = []
  for (const p of participants.value) {
    const share = shareLabels(shares.value[p.id] ?? 0).primary
    lines.push(`${p.name} will receive a payment request for ${share}.`)
  }
  if (includeMe.value) {
    lines.push(`You will owe ${shareLabels(myShareNim.value).primary}.`)
  }
  return lines
})

function linkFor(p: Profile): string {
  const me = store.self?.name && store.self.name !== 'Me' ? ` to ${store.self.name}` : ''
  const addr = receiveAddress(store.self?.address) ?? store.self?.address ?? p.address
  return makeRequestLink(
    addr,
    shares.value[p.id],
    `Split${note.value.trim() ? `: ${note.value.trim()}` : ''}${me}`,
  )
}

async function copyLink(p: Profile) {
  const addr = receiveAddress(store.self?.address) ?? store.self?.address ?? p.address
  const result = await shareOrCopy(
    makePaymentShareLink(addr, shares.value[p.id], splitDescription.value),
    splitDescription.value,
  )
  if (result === 'copied') {
    copiedId.value = p.id
    setTimeout(() => (copiedId.value = null), 1500)
  }
  await store.touchInteraction(p.id)
}

const splitDescription = computed(() =>
  `Split${note.value.trim() ? `: ${note.value.trim()}` : ''}`,
)

async function sendToInbox(p: Profile, invoiceId: string) {
  if (!store.self) return
  sendingId.value = p.id
  const nextErrors = { ...sendErrors.value }
  delete nextErrors[p.id]
  sendErrors.value = nextErrors
  try {
    await sendPaymentRequest({
      recipient: p.address,
      payload: makeRequestLink(store.self.address, shares.value[p.id], splitDescription.value),
      objectId: invoiceId,
      sender: store.self.address,
    })
    sentId.value = p.id
    setTimeout(() => { if (sentId.value === p.id) sentId.value = null }, 2500)
  } catch (e) {
    sendErrors.value = {
      ...sendErrors.value,
      [p.id]: e instanceof Error ? e.message : 'Sending failed',
    }
  } finally {
    sendingId.value = null
  }
}

async function createRequests() {
  if (!valid.value || creating.value) return
  creating.value = true
  invoiceIds.value = {}
  sendErrors.value = {}
  try {
    for (const p of participants.value) {
      const inv = await invoicesStore.create({
        address: p.address,
        amountNim: shares.value[p.id],
        description: splitDescription.value,
        ...(fiatInfo.value && total.value
          ? {
              fiatAmount: fiatInfo.value.amount * (shares.value[p.id] / total.value),
              fiatCurrency: fiatInfo.value.currency,
            }
          : {}),
      })
      invoiceIds.value = { ...invoiceIds.value, [p.id]: inv.id }
      await store.touchInteraction(p.id)
      if (shouldAutoDeliverInbox(p.address, store.contacts)) await sendToInbox(p, inv.id)
    }
    created.value = true
    celebrateOnce('first-split')
  } finally {
    creating.value = false
  }
}

function goAddContact() {
  router.push('/add')
  close()
}

function close() {
  total.value = null
  fiatInfo.value = null
  totalInput.value?.reset()
  note.value = ''
  filter.value = ''
  includeMe.value = true
  splitMode.value = 'equal'
  selected.value = new Set()
  created.value = false
  invoiceIds.value = {}
  sendErrors.value = {}
  emit('close')
}
</script>

<template>
  <ActionSheet
    :open="open"
    title="Split a bill"
    subtitle="What happened, who was there, and how to divide it."
    @close="close"
  >
    <p v-if="!store.self" class="hint">Connect inside Nimiq Pay first — split requests are paid to your address.</p>
    <div v-else-if="store.loaded && splittable.length === 0" class="split-empty">
      <p class="split-empty-title">Split bills with people, not wallet addresses.</p>
      <p class="split-empty-hint">Add your first contact to start splitting expenses.</p>
      <button type="button" class="primary" @click="goAddContact">Add your first contact</button>
    </div>
    <template v-else>
      <label class="field-label">
        What was it for?
        <input v-model="note" maxlength="40" placeholder="Dinner" />
      </label>

      <label class="field-label">
        Total
        <CurrencyAmountInput
          ref="totalInput"
          placeholder="0.00"
          @update:model-value="total = $event"
          @fiat="fiatInfo = $event"
        />
      </label>

      <div class="split-mode" role="radiogroup" aria-label="Split mode">
        <span class="field-label static">Split</span>
        <div class="mode-row">
          <button
            type="button"
            class="mode-btn"
            :class="{ on: splitMode === 'equal' }"
            role="radio"
            :aria-checked="splitMode === 'equal'"
            @click="splitMode = 'equal'"
          >
            Equal
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ on: splitMode === 'custom' }"
            role="radio"
            :aria-checked="splitMode === 'custom'"
            @click="splitMode = 'custom'"
          >
            Custom
          </button>
        </div>
      </div>

      <div
        v-if="total && breakdownRows.length"
        :key="`split-${headcount}-${summaryTotal}`"
        class="breakdown"
        aria-live="polite"
      >
        <div class="breakdown-bill">
          <span class="breakdown-emoji" aria-hidden="true">🍕</span>
          <div class="breakdown-bill-text">
            <p class="breakdown-title">{{ summaryTitle }}</p>
            <p class="breakdown-total">{{ summaryTotal }}</p>
          </div>
        </div>
        <div class="breakdown-rule" role="separator" />
        <ul class="breakdown-people">
          <li v-for="row in breakdownRows" :key="row.key" class="breakdown-row">
            <span class="breakdown-who">
              <span aria-hidden="true">👤</span>
              {{ row.label }}
            </span>
            <span :key="row.amount" class="breakdown-amt amount-pop">{{ row.amount }}</span>
          </li>
        </ul>
      </div>

      <div class="who">
        <span class="who-title">Participants</span>

        <label class="me-card">
          <input v-model="includeMe" type="checkbox" />
          <div class="card-body">
            <span class="card-name">Include me</span>
            <template v-if="includeMe && total && headcount > 0">
              <span :key="shareLabels(myShareNim).primary" class="card-share amount-pop">{{ shareLabels(myShareNim).primary }}</span>
              <span v-if="shareLabels(myShareNim).secondary" class="card-nim">
                {{ shareLabels(myShareNim).secondary }}
              </span>
            </template>
          </div>
        </label>

        <label v-for="p in participants" :key="p.id" class="person-card selected">
          <input type="checkbox" checked @change="toggle(p.id)" />
          <Identicon :address="p.address" :size="40" />
          <div class="card-body">
            <span class="card-name">{{ p.name }}</span>
            <template v-if="total">
              <template v-if="splitMode === 'equal'">
                <span :key="shareLabels(shares[p.id] ?? 0).primary" class="card-share amount-pop">{{ shareLabels(shares[p.id] ?? 0).primary }}</span>
                <span v-if="shareLabels(shares[p.id] ?? 0).secondary" class="card-nim">
                  {{ shareLabels(shares[p.id] ?? 0).secondary }}
                </span>
              </template>
              <input
                v-else
                class="share-input"
                type="number"
                min="0.00001"
                step="any"
                :value="shares[p.id]"
                aria-label="Share in NIM"
                @input="shares = { ...shares, [p.id]: Number(($event.target as HTMLInputElement).value) }"
              />
            </template>
          </div>
        </label>

        <p v-if="total && participants.length === 0" class="empty-hint">
          Add at least one contact to split this bill.
        </p>

        <input
          v-if="splittable.length > participants.length"
          v-model="filter"
          type="search"
          class="filter-input"
          placeholder="Search people to add…"
        />

        <template v-for="section in pickerSections" :key="section.title">
          <p class="section-title">{{ section.title }}</p>
          <label v-for="p in section.items" :key="p.id" class="person-card">
            <input type="checkbox" @change="toggle(p.id); filter = ''" />
            <Identicon :address="p.address" :size="40" />
            <div class="card-body">
              <span class="card-name">{{ p.name }}</span>
              <span v-if="p.handle" class="card-sub">@{{ p.handle }}</span>
              <span v-else-if="p.tags[0]" class="card-sub">{{ p.tags[0] }}</span>
            </div>
          </label>
        </template>

        <p v-if="filter && pickerSections.length === 0" class="hint">No matches.</p>
      </div>

      <div v-if="previewLines.length" class="preview">
        <p v-for="(line, i) in previewLines" :key="i">{{ line }}</p>
      </div>

      <p v-if="total && participants.length && !valid" class="err">
        Shares must be positive and add up to {{ formatNim(total) }}{{ includeMe ? ' (your share covers the rest)' : '' }}.
      </p>

      <button
        v-if="valid && !created"
        type="button"
        class="primary"
        :disabled="creating"
        @click="createRequests"
      >
        {{ ctaLabel }}
      </button>

      <template v-if="created">
        <div class="requests">
          <div v-for="p in participants" :key="p.id" class="request">
            <div class="request-header">
              <span class="card-name">{{ p.name }}</span>
              <span class="share">{{ shareLabels(shares[p.id] ?? 0).primary }}</span>
            </div>
            <div class="request-detail">
              <QrCode :text="linkFor(p)" :size="180" />
              <div class="request-actions">
                <button
                  v-if="inboxAvailable()"
                  type="button"
                  class="secondary"
                  :disabled="sendingId === p.id"
                  @click="sendToInbox(p, invoiceIds[p.id])"
                >
                  {{ sentId === p.id ? 'Sent!' : sendingId === p.id ? 'Sending…' : sendErrors[p.id] ? 'Retry NimConnect' : 'Send to their NimConnect' }}
                </button>
                <button type="button" class="secondary" @click="copyLink(p)">
                  {{ copiedId === p.id ? 'Copied!' : canShare() ? 'Share request link' : 'Copy request link' }}
                </button>
              </div>
              <p v-if="sendErrors[p.id]" class="err">{{ sendErrors[p.id] }}</p>
            </div>
          </div>
        </div>
        <p class="hint">
          <template v-if="inboxAvailable()">
            Requests go to each person's NimConnect when you confirm the wallet signatures.
            Share a QR or link if someone didn't get it.
          </template>
          <template v-else>
            Show each person their QR, or copy their link into any chat.
          </template>
          Track payments on <router-link to="/" class="inline-link" @click="close">Home</router-link>.
        </p>
      </template>
    </template>
  </ActionSheet>
</template>

<style scoped>
.field-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-2);
  margin-bottom: 12px;
}
.field-label.static { margin-bottom: 6px; }
.field-label input {
  font: inherit;
  padding: 10px 12px;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-input);
  background: var(--bg);
  color: var(--text);
}

.breakdown {
  margin: 0 0 16px;
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--text-6);
  animation: breakdown-in 0.28s var(--nimiq-ease);
}
@keyframes breakdown-in {
  from { opacity: 0.55; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
.breakdown-bill {
  display: flex;
  align-items: center;
  gap: 12px;
}
.breakdown-emoji { font-size: 28px; line-height: 1; }
.breakdown-bill-text { min-width: 0; }
.breakdown-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.breakdown-total {
  margin: 2px 0 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--nq-gold-dark);
  font-variant-numeric: tabular-nums;
  transition: color 0.2s ease;
}
.breakdown-rule {
  height: 1px;
  margin: 12px 0;
  background: var(--border);
}
.breakdown-people {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.breakdown-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  animation: row-in 0.22s var(--nimiq-ease);
}
@keyframes row-in {
  from { opacity: 0; transform: translateX(-4px); }
  to { opacity: 1; transform: none; }
}
.breakdown-who {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 700;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.breakdown-amt {
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--nq-gold-dark);
  font-variant-numeric: tabular-nums;
}

.split-mode { margin-bottom: 14px; }
.mode-row { display: flex; gap: 8px; }
.mode-btn {
  flex: 1;
  min-height: 40px;
  border: 1.5px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--card);
  color: var(--text-2);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.mode-btn.on {
  border-color: transparent;
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-blue);
}

.who { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.who-title { font-size: 13px; font-weight: 700; color: var(--text-2); }
.section-title {
  margin: 8px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.me-card,
.person-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  min-height: 64px;
}
.person-card.selected { border-color: rgba(233, 178, 19, 0.45); }
.me-card input,
.person-card input[type='checkbox'] {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-name {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-share { font-size: 15px; font-weight: 800; color: var(--nq-gold-dark); }
.card-nim, .card-sub { font-size: 12px; font-weight: 600; color: var(--text-2); }

.filter-input {
  font: inherit;
  padding: 10px 12px;
  min-height: 44px;
  margin-top: 4px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--bg);
  color: var(--text);
}
.share-input {
  width: 110px;
  font: inherit;
  padding: 6px 8px;
  text-align: right;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-input);
  background: var(--bg);
  color: var(--text);
}

.empty-hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--text-6);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.split-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 12px 8px;
  text-align: center;
}
.split-empty-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}
.split-empty-hint {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
}
.split-empty .primary {
  width: auto;
  min-width: 220px;
  padding: 0 24px;
  margin-bottom: 4px;
}

.preview {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--text-6);
}
.preview p {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  line-height: 1.4;
}
.preview p + p { margin-top: 4px; }

.primary {
  width: 100%;
  height: 48px;
  margin-bottom: 12px;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  cursor: pointer;
  font-weight: 700;
  font-size: 16px;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; cursor: default; }

.requests { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
.request {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  padding: 12px;
}
.request-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.share { font-weight: 700; color: var(--nq-gold-dark); }
.request-detail { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.request-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.secondary {
  min-height: 44px;
  padding: 0 20px;
  border-radius: var(--nimiq-radius-pill);
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--nq-light-blue);
  font-weight: 700;
}
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.inline-link { color: var(--nq-light-blue); font-weight: 700; }
</style>
