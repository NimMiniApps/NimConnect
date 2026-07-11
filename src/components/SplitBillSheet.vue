<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore } from '../stores/invoices'
import { makeRequestLink, makePaymentShareLink, nimToLunas } from '../services/links'
import { receiveAddress } from '../services/nimiq'
import { splitAmount } from '../utils/split'
import { sendPaymentRequest, shouldAutoDeliverInbox, inboxAvailable } from '../services/inbox'
import { shareOrCopy, canShare } from '../services/share'
import ActionSheet from './ActionSheet.vue'
import Identicon from './Identicon.vue'
import QrCode from './QrCode.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'

const props = defineProps<{ profile?: Profile; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useProfilesStore()
const invoicesStore = useInvoicesStore()

const total = ref<number | null>(null)
const totalInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const note = ref('')
const includeMe = ref(true)
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

onMounted(() => {
  void store.load()
  void invoicesStore.load()
})

watch(() => props.open, open => {
  if (!open) return
  void store.load()
  selected.value = new Set(props.profile?.type === 'person' ? [props.profile.id] : [])
  created.value = false
  invoiceIds.value = {}
  sendErrors.value = {}
})

watch([total, selected, includeMe, shares], () => {
  created.value = false
})

const participants = computed(() =>
  splittable.value.filter(p => selected.value.has(p.id)),
)

// Selected pinned on top; the rest searchable so long lists stay usable
const pickable = computed(() =>
  store.search(filter.value).filter(p => p.type === 'person' && !selected.value.has(p.id)),
)

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

// Recompute equal shares whenever total or the participant set changes;
// manual edits below override until the next recompute.
watch([total, selected, includeMe], () => {
  const n = participants.value.length + (includeMe.value ? 1 : 0)
  if (!total.value || n === 0) {
    shares.value = {}
    return
  }
  const parts = splitAmount(total.value, n)
  const next: Record<string, number> = {}
  // My share (when included) takes the first slot so contacts get the smaller remainders
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
      })
      invoiceIds.value = { ...invoiceIds.value, [p.id]: inv.id }
      await store.touchInteraction(p.id)
      if (shouldAutoDeliverInbox(p.address, store.contacts)) await sendToInbox(p, inv.id)
    }
    created.value = true
  } finally {
    creating.value = false
  }
}

function close() {
  total.value = null
  totalInput.value?.reset()
  note.value = ''
  filter.value = ''
  includeMe.value = true
  selected.value = new Set()
  created.value = false
  invoiceIds.value = {}
  sendErrors.value = {}
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" title="Split a bill" @close="close">
    <p v-if="!store.self" class="hint">Connect inside Nimiq Pay first — split requests are paid to your address.</p>
    <template v-else>
      <label class="amount-label">
        Total
        <CurrencyAmountInput ref="totalInput" placeholder="0.00" @update:model-value="total = $event" />
      </label>
      <label class="message-label">
        What for? (optional)
        <input v-model="note" maxlength="40" placeholder="Dinner at Luigi's" />
      </label>

      <div class="who">
        <span class="who-title">Who's in?</span>
        <label class="me-row">
          <input v-model="includeMe" type="checkbox" />
          <span>Include me<template v-if="includeMe && total"> — my share {{ myShareNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM</template></span>
        </label>
        <label v-for="p in participants" :key="p.id" class="person-row">
          <input type="checkbox" checked @change="toggle(p.id)" />
          <Identicon :address="p.address" :size="32" />
          <span class="person-name">{{ p.name }}</span>
          <input
            v-if="total"
            class="share-input"
            type="number"
            min="0.00001"
            step="any"
            :value="shares[p.id]"
            @input="shares = { ...shares, [p.id]: Number(($event.target as HTMLInputElement).value) }"
          />
        </label>

        <input
          v-if="splittable.length > participants.length"
          v-model="filter"
          type="search"
          class="filter-input"
          placeholder="Search contacts to add…"
        />
        <label v-for="p in pickable" :key="p.id" class="person-row">
          <input type="checkbox" @change="toggle(p.id); filter = ''" />
          <Identicon :address="p.address" :size="32" />
          <span class="person-name">{{ p.name }}</span>
        </label>
        <p v-if="filter && pickable.length === 0" class="hint">No matches.</p>
        <p v-if="store.loaded && splittable.length === 0" class="hint">
          Add a person contact first, then come back to split a bill.
          <router-link to="/add" class="inline-link" @click="close">Add contact</router-link>
        </p>
        <p v-else-if="total && participants.length === 0" class="hint">
          Select at least one contact above to split with.
        </p>
      </div>

      <p v-if="total && participants.length && !valid" class="err">
        Shares must be positive and add up to {{ total.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM{{ includeMe ? ' (your share covers the rest)' : '' }}.
      </p>

      <button
        v-if="valid && !created"
        type="button"
        class="primary"
        :disabled="creating"
        @click="createRequests"
      >
        {{ creating ? (inboxAvailable() ? 'Creating & sending…' : 'Saving…') : 'Create split requests' }}
      </button>

      <template v-if="created">
        <div class="requests">
          <div v-for="p in participants" :key="p.id" class="request">
            <div class="request-header">
              <span class="person-name">{{ p.name }}</span>
              <span class="share">{{ shares[p.id] }} NIM</span>
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
.amount-label, .message-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 12px; }
.amount-label input, .message-label input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.amount-label input { font-size: 24px; text-align: center; }
.who { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.who-title { font-size: 13px; font-weight: 700; color: var(--text-2); }
.me-row, .person-row { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.person-name { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.filter-input {
  font: inherit; padding: 10px 12px; min-height: 44px; margin: 4px 0;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill); background: var(--bg); color: var(--text);
}
.share-input {
  width: 96px; font: inherit; padding: 6px 8px; text-align: right;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.primary {
  width: 100%; height: 48px; margin-bottom: 12px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; cursor: default; }
.requests { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
.request {
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); padding: 12px;
}
.request-header {
  display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px;
}
.share { font-weight: 700; color: var(--nq-gold-dark); }
.request-detail { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.request-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.secondary {
  min-height: 44px; padding: 0 20px; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.inline-link { color: var(--nq-light-blue); font-weight: 700; }
</style>
