<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore } from '../stores/invoices'
import { makeRequestLink } from '../services/links'
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
const creating = ref(false)
const expandedId = ref<string | null>(null)
const copiedId = ref<string | null>(null)

onMounted(() => invoicesStore.load())

const invoices = computed(() => invoicesStore.byAddress(props.profile.address))

function linkFor(amountNim: number, desc: string): string {
  return makeRequestLink(store.self?.address ?? props.profile.address, amountNim, desc || 'Invoice')
}

async function create() {
  if (!amount.value) return
  creating.value = true
  try {
    const inv = await invoicesStore.create({
      address: props.profile.address,
      amountNim: amount.value,
      description: description.value,
      fiatAmount: fiat.value?.amount,
      fiatCurrency: fiat.value?.currency,
    })
    await store.touchInteraction(props.profile.id)
    amount.value = null
    fiat.value = null
    amountInput.value?.reset()
    description.value = ''
    expandedId.value = inv.id
  } finally {
    creating.value = false
  }
}

async function copyLink(id: string, amountNim: number, desc: string) {
  await navigator.clipboard.writeText(linkFor(amountNim, desc))
  copiedId.value = id
  setTimeout(() => (copiedId.value = null), 1500)
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
            <p class="when">Created {{ new Date(inv.createdAt).toLocaleDateString() }}<template v-if="inv.paidAt"> · Paid {{ new Date(inv.paidAt).toLocaleDateString() }}</template></p>
            <QrCode v-if="inv.status === 'pending'" :text="linkFor(inv.amountNim, inv.description)" :size="180" />
            <p v-if="inv.status === 'pending'" class="pay-hint">Payer: tap Scan in the bottom bar and scan this QR.</p>
            <div class="detail-actions">
              <button v-if="inv.status === 'pending'" type="button" class="secondary" @click="copyLink(inv.id, inv.amountNim, inv.description)">
                {{ copiedId === inv.id ? 'Copied!' : 'Copy link' }}
              </button>
              <button type="button" class="secondary" @click="invoicesStore.setStatus(inv.id, inv.status === 'paid' ? 'pending' : 'paid')">
                {{ inv.status === 'paid' ? 'Mark pending' : 'Mark paid' }}
              </button>
              <button type="button" class="secondary danger" @click="invoicesStore.remove(inv.id)">Delete</button>
            </div>
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
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text);
}
.primary {
  height: 48px; border: none; border-radius: 24px; cursor: pointer;
  font-weight: 700; font-size: 16px; color: #fff;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
}
.primary:disabled { opacity: 0.5; }
.list { display: flex; flex-direction: column; gap: 8px; }
.invoice-row {
  width: 100%; display: flex; align-items: center; gap: 10px;
  min-height: 48px; padding: 0 12px; cursor: pointer;
  border: 1px solid var(--border); border-radius: 12px; background: var(--bg); color: var(--text);
  font: inherit;
}
.status { font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 10px; }
.status.pending { background: rgba(233, 178, 19, 0.15); color: var(--nq-gold-dark); }
.status.paid { background: rgba(33, 188, 165, 0.15); color: var(--nq-green); }
.desc { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.amount { font-weight: 700; text-align: right; }
.fiat { display: block; font-weight: 400; font-size: 12px; color: var(--text-2); }
.detail { padding: 12px 0; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.pay-hint { margin: 0; font-size: 12px; color: var(--text-2); text-align: center; max-width: 260px; }
.when { margin: 0; font-size: 13px; color: var(--text-2); }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.secondary {
  min-height: 44px; padding: 0 16px; border-radius: 22px; cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
.secondary.danger { color: var(--nq-red); }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
</style>
