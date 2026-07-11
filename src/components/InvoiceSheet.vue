<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore, isOverdue } from '../stores/invoices'
import { makeRequestLink, makePaymentShareLink } from '../services/links'
import { receiveAddress } from '../services/nimiq'
import { sendPaymentRequest, shouldAutoDeliverInbox, inboxAvailable } from '../services/inbox'
import { shareOrCopy, canShare } from '../services/share'
import ActionSheet from './ActionSheet.vue'
import QrCode from './QrCode.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'

const props = defineProps<{ profile: Profile; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useProfilesStore()
const invoicesStore = useInvoicesStore()

const amount = ref<number | null>(null)
const fiat = ref<{ amount: number; currency: string } | null>(null)
const amountInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const description = ref('')
const dueDate = ref('')
const creating = ref(false)
const expandedId = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const sendingId = ref<string | null>(null)
const sentId = ref<string | null>(null)
const sendError = ref<string | null>(null)

onMounted(() => invoicesStore.load())

const invoices = computed(() => invoicesStore.byAddress(props.profile.address))

function linkFor(amountNim: number, desc: string): string {
  const addr = receiveAddress(store.self?.address) ?? store.self?.address ?? props.profile.address
  return makeRequestLink(addr, amountNim, desc || 'Invoice')
}

async function create() {
  if (!amount.value) return
  creating.value = true
  try {
    // Due at end of the picked day, local time
    const dueAt = dueDate.value ? new Date(`${dueDate.value}T23:59:59`).getTime() : undefined
    const inv = await invoicesStore.create({
      address: props.profile.address,
      amountNim: amount.value,
      description: description.value,
      fiatAmount: fiat.value?.amount,
      fiatCurrency: fiat.value?.currency,
      ...(dueAt && Number.isFinite(dueAt) ? { dueAt } : {}),
    })
    await store.touchInteraction(props.profile.id)
    amount.value = null
    fiat.value = null
    amountInput.value?.reset()
    description.value = ''
    dueDate.value = ''
    expandedId.value = inv.id
    // Deliver to their inbox when they're a saved contact
    if (shouldAutoDeliverInbox(props.profile.address, store.contacts)) await sendToInbox(inv)
  } finally {
    creating.value = false
  }
}

async function copyLink(id: string, amountNim: number, desc: string) {
  const addr = receiveAddress(store.self?.address) ?? store.self?.address ?? props.profile.address
  const result = await shareOrCopy(
    makePaymentShareLink(addr, amountNim, desc || 'Invoice'),
    desc || 'Invoice',
  )
  if (result === 'copied') {
    copiedId.value = id
    setTimeout(() => (copiedId.value = null), 1500)
  }
}

async function sendToInbox(inv: { id: string; amountNim: number; description: string }) {
  if (!store.self) return
  sendingId.value = inv.id
  sendError.value = null
  try {
    await sendPaymentRequest({
      recipient: props.profile.address,
      payload: makeRequestLink(store.self.address, inv.amountNim, inv.description || 'Invoice'),
      objectId: inv.id,
      sender: store.self.address,
    })
    sentId.value = inv.id
    setTimeout(() => (sentId.value = null), 2500)
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : 'Sending failed'
  } finally {
    sendingId.value = null
  }
}

function close() {
  amount.value = null
  description.value = ''
  expandedId.value = null
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" :title="`Invoices — ${profile.name}`" @close="close">
    <p v-if="!store.self" class="hint">Connect inside Nimiq Pay first — invoices are paid to your address.</p>
    <template v-else>
      <form class="new-invoice" @submit.prevent="create">
        <div class="new-fields">
          <CurrencyAmountInput
            ref="amountInput"
            placeholder="Amount"
            @update:model-value="amount = $event"
            @fiat="fiat = $event"
          />
          <input v-model="description" maxlength="64" placeholder="What for? e.g. Logo design" />
          <label class="due-label">
            Due date (optional)
            <input v-model="dueDate" type="date" />
          </label>
        </div>
        <button type="submit" class="primary" :disabled="!amount || creating">Create invoice</button>
      </form>

      <p v-if="invoices.length === 0" class="hint">No invoices for {{ profile.name }} yet.</p>
      <div v-else class="list">
        <div v-for="inv in invoices" :key="inv.id" class="invoice">
          <button type="button" class="invoice-row" @click="expandedId = expandedId === inv.id ? null : inv.id">
            <span class="status" :class="inv.status">{{ inv.status === 'paid' ? '✓ Paid' : 'Pending' }}</span>
            <span class="desc">{{ inv.description || 'Invoice' }}</span>
            <span class="amount">
              {{ inv.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
              <span v-if="inv.fiatAmount" class="fiat">({{ inv.fiatAmount }} {{ inv.fiatCurrency }})</span>
            </span>
          </button>
          <div v-if="expandedId === inv.id" class="detail">
            <p class="when">
              Created {{ new Date(inv.createdAt).toLocaleDateString() }}<template v-if="inv.dueAt"> · <span :class="{ overdue: isOverdue(inv) }">{{ isOverdue(inv) ? 'Overdue since' : 'Due' }} {{ new Date(inv.dueAt).toLocaleDateString() }}</span></template><template v-if="inv.paidAt"> · Paid {{ new Date(inv.paidAt).toLocaleDateString() }}</template>
            </p>
            <QrCode v-if="inv.status === 'pending'" :text="linkFor(inv.amountNim, inv.description)" :size="180" />
            <p v-if="inv.status === 'pending'" class="pay-hint">Payer: tap Scan in the bottom bar and scan this QR.</p>
            <div class="detail-actions">
              <button v-if="inv.status === 'pending'" type="button" class="secondary" @click="copyLink(inv.id, inv.amountNim, inv.description)">
                {{ copiedId === inv.id ? 'Copied!' : canShare() ? 'Share link' : 'Copy link' }}
              </button>
              <button
                v-if="inv.status === 'pending' && inboxAvailable() && store.self"
                type="button"
                class="secondary"
                :disabled="sendingId === inv.id"
                @click="sendToInbox(inv)"
              >
                {{ sentId === inv.id ? 'Sent!' : sendingId === inv.id ? 'Sending…' : 'Send to their NimConnect' }}
              </button>
              <button type="button" class="secondary" @click="invoicesStore.setStatus(inv.id, inv.status === 'paid' ? 'pending' : 'paid')">
                {{ inv.status === 'paid' ? 'Mark pending' : 'Mark paid' }}
              </button>
              <button type="button" class="secondary danger" @click="invoicesStore.remove(inv.id)">Delete</button>
            </div>
            <p v-if="sendError && (sendingId === inv.id || sentId === null)" class="hint send-error">{{ sendError }}</p>
          </div>
        </div>
      </div>
    </template>
  </ActionSheet>
</template>

<style scoped>
.new-invoice { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.new-fields { display: flex; flex-direction: column; gap: 8px; }
.new-fields input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.primary {
  height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
.list { display: flex; flex-direction: column; gap: 8px; }
.invoice-row {
  width: 100%; display: flex; align-items: center; gap: 10px;
  min-height: 48px; padding: 0 12px; cursor: pointer;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--text);
  font: inherit;
}
.status { font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: var(--nimiq-radius-small); }
.status.pending { background: var(--text-6); color: var(--nq-gold-dark); }
.status.paid { background: rgba(33, 188, 165, 0.15); color: var(--nq-green); }
.desc { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.amount { font-weight: 700; text-align: right; }
.fiat { display: block; font-weight: 400; font-size: 12px; color: var(--text-2); }
.detail { padding: 12px 0; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.pay-hint { margin: 0; font-size: 12px; color: var(--text-2); text-align: center; max-width: 260px; }
.when { margin: 0; font-size: 13px; color: var(--text-2); }
.when .overdue { color: var(--nq-red); font-weight: 700; }
.due-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 700; color: var(--text-2); }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.secondary {
  min-height: 44px; padding: 0 16px; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
.secondary.danger { color: var(--nq-red); }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.send-error { color: var(--nq-red); }
</style>
