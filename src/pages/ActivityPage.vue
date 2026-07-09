<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore } from '../stores/invoices'
import { makeRequestLink, shortAddress, transactionExplorerUrl } from '../services/links'
import { fetchIncomingPayments, newestFirst, type IncomingPayment } from '../services/history'
import { walletAddresses } from '../services/nimiq'
import { incomingAddress } from '../services/prefs'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import EmptyState from '../components/EmptyState.vue'
import Identicon from '../components/Identicon.vue'

const profilesStore = useProfilesStore()
const invoicesStore = useInvoicesStore()
const copiedId = ref<string | null>(null)
const incoming = ref<IncomingPayment[]>([])
const incomingLoading = ref(false)
const incomingError = ref(false)

onMounted(async () => {
  await Promise.all([profilesStore.load(), invoicesStore.load()])
  await loadIncoming()
})

watch(() => profilesStore.self?.address, async (address, prev) => {
  if (address && address !== prev) await loadIncoming()
})

const pendingTotal = computed(() =>
  invoicesStore.pendingTotalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }),
)
const incomingNewest = computed(() => newestFirst(incoming.value))

function profileFor(address: string) {
  const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
  return profilesStore.getByAddress(address)
    ?? profilesStore.contacts.find(p => compact(p.address) === compact(address))
}

function contactName(address: string): string {
  return profileFor(address)?.name ?? shortAddress(address)
}

function requestLink(amountNim: number, description: string): string | null {
  if (!profilesStore.self) return null
  return makeRequestLink(profilesStore.self.address, amountNim, description || 'Invoice')
}

async function copyLink(id: string, amountNim: number, description: string) {
  const link = requestLink(amountNim, description)
  if (!link) return
  await navigator.clipboard.writeText(link)
  copiedId.value = id
  setTimeout(() => (copiedId.value = null), 1500)
}

async function loadIncoming() {
  if (!profilesStore.self) return
  incomingLoading.value = true
  incomingError.value = false
  try {
    const addresses = new Set(walletAddresses.value.length ? walletAddresses.value : [profilesStore.self.address])
    const manual = incomingAddress.value.trim()
    if (manual && ValidationUtils.isValidAddress(manual)) addresses.add(manual)
    incoming.value = await fetchIncomingPayments([...addresses])
  } catch {
    incomingError.value = true
  } finally {
    incomingLoading.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="header">
      <div>
        <h1>Activity</h1>
        <p>Open payment follow-ups across your contacts.</p>
      </div>
      <router-link to="/add" class="add-link" aria-label="Add contact">＋</router-link>
    </header>

    <section v-if="invoicesStore.pending.length" class="summary">
      <div class="summary-main">
        <span class="summary-value">{{ pendingTotal }}</span>
        <span class="summary-label">NIM pending</span>
      </div>
      <div class="summary-side">
        <span class="summary-value">{{ invoicesStore.pending.length }}</span>
        <span class="summary-label">open invoices</span>
      </div>
    </section>

    <p v-if="!profilesStore.self && invoicesStore.pending.length" class="notice">
      Connect inside Nimiq Pay to copy payment links to your wallet address.
    </p>

    <section class="activity-section invoice-section">
      <div class="section-head">
        <h2>Open invoices</h2>
      </div>

    <template v-if="invoicesStore.pending.length">
      <div class="invoice-list">
        <article v-for="invoice in invoicesStore.pending" :key="invoice.id" class="card invoice-card">
          <div class="invoice-head">
            <Identicon :address="invoice.address" :size="44" />
            <div class="invoice-title">
              <router-link
                v-if="profileFor(invoice.address)"
                :to="`/profile/${profileFor(invoice.address)!.id}`"
                class="contact-link"
              >
                {{ contactName(invoice.address) }}
              </router-link>
              <span v-else class="contact-link missing">{{ contactName(invoice.address) }}</span>
              <span class="invoice-date">Created {{ new Date(invoice.createdAt).toLocaleDateString() }}</span>
            </div>
            <div class="invoice-amount">
              {{ invoice.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
              <span v-if="invoice.fiatAmount" class="fiat">{{ invoice.fiatAmount }} {{ invoice.fiatCurrency }}</span>
            </div>
          </div>

          <p class="description">{{ invoice.description || 'Invoice' }}</p>

          <div class="actions">
            <button
              type="button"
              class="action primary"
              :disabled="!profilesStore.self"
              @click="copyLink(invoice.id, invoice.amountNim, invoice.description)"
            >
              {{ copiedId === invoice.id ? 'Copied' : 'Copy link' }}
            </button>
            <button type="button" class="action" @click="invoicesStore.setStatus(invoice.id, 'paid')">
              Mark paid
            </button>
            <button type="button" class="action danger" @click="invoicesStore.remove(invoice.id)">
              Delete
            </button>
          </div>
        </article>
      </div>
    </template>

      <EmptyState
        v-else
        icon="🧾"
        title="No open invoices"
        hint="Create invoices from a contact profile, then track what is still pending here."
      >
        <router-link to="/" class="empty-action primary-action">Choose contact</router-link>
        <router-link to="/add" class="empty-action">Add contact</router-link>
      </EmptyState>
    </section>

    <section class="activity-section incoming-section">
      <div class="section-head">
        <h2>Incoming payments</h2>
        <button v-if="profilesStore.self" type="button" class="refresh" :disabled="incomingLoading" @click="loadIncoming">
          {{ incomingLoading ? 'Checking…' : 'Refresh' }}
        </button>
      </div>

      <p v-if="!profilesStore.self" class="notice">
        Connect inside Nimiq Pay to see payments sent to your wallet, including unknown senders.
      </p>
      <p v-else-if="incomingError" class="notice">Incoming payments are unavailable right now.</p>
      <p v-else-if="incomingLoading && incoming.length === 0" class="subtle">Checking your wallet…</p>
      <div v-else-if="incomingNewest.length" class="incoming-list">
        <article v-for="payment in incomingNewest.slice(0, 8)" :key="payment.hash" class="card incoming-card">
          <div class="invoice-head">
            <Identicon :address="payment.sender" :size="44" />
            <div class="invoice-title">
              <router-link
                v-if="profileFor(payment.sender)"
                :to="`/profile/${profileFor(payment.sender)!.id}`"
                class="contact-link"
              >
                {{ contactName(payment.sender) }}
              </router-link>
              <span v-else class="contact-link missing">Unknown sender</span>
              <span class="invoice-date">
                {{ shortAddress(payment.sender) }} · {{ new Date(payment.timestamp * (payment.timestamp < 1e12 ? 1000 : 1)).toLocaleDateString() }}
              </span>
            </div>
            <div class="invoice-amount positive">+{{ payment.valueNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM</div>
          </div>
          <p v-if="payment.message" class="description">“{{ payment.message }}”</p>
          <div class="actions tx-actions">
            <a
              class="action"
              :href="transactionExplorerUrl(payment.hash)"
              target="_blank"
              rel="noopener"
            >
              Explorer
            </a>
            <router-link v-if="!profileFor(payment.sender)" to="/add" class="action primary">Add contact</router-link>
          </div>
        </article>
      </div>
      <p v-else class="subtle">No incoming payments found yet.</p>
    </section>
  </div>
</template>

<style scoped>
.page {
  padding: 16px 16px 88px;
  display: flex;
  flex-direction: column;
  max-width: 100%;
  overflow-x: hidden;
}
.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 4px; }
.header p { margin: 0; color: var(--text-2); font-size: 14px; line-height: 1.4; }
.add-link {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  margin-top: 4px;
  border-radius: var(--nimiq-radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--nimiq-white);
  text-decoration: none;
  font-size: 26px;
  background: var(--nimiq-gold-bg);
}
.summary {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.summary-main,
.summary-side {
  min-height: 82px;
  padding: 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--card);
  box-shadow: var(--shadow);
}
.summary-main {
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-white);
}
.summary-main .summary-label { color: rgba(255, 255, 255, 0.72); }
.summary-value {
  display: block;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}
.summary-label {
  display: block;
  margin-top: 6px;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}
.notice {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--text-6);
  color: var(--text);
  font-size: 13px;
}
.activity-section { margin-top: 18px; }
.section-head {
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.section-head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-2);
  text-transform: uppercase;
}
.refresh {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 17px;
  background: var(--card);
  color: var(--nq-light-blue);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.refresh:disabled { opacity: 0.55; cursor: default; }
.invoice-list { display: flex; flex-direction: column; gap: 12px; }
.incoming-list { display: flex; flex-direction: column; gap: 10px; }
.invoice-card { padding: 14px; }
.incoming-card { padding: 14px; overflow: hidden; }
.invoice-head {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.invoice-title { flex: 1; min-width: 0; }
.contact-link {
  display: block;
  color: var(--text);
  text-decoration: none;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contact-link.missing { color: var(--text-2); }
.invoice-date { display: block; margin-top: 2px; color: var(--text-2); font-size: 12px; }
.invoice-amount {
  text-align: right;
  font-weight: 700;
  color: var(--nq-gold-dark);
  flex: 0 0 auto;
  max-width: 38%;
}
.invoice-amount.positive { color: var(--nq-green); }
.fiat { display: block; margin-top: 2px; color: var(--text-2); font-size: 12px; font-weight: 600; }
.description {
  margin: 12px 0 0;
  color: var(--text);
  font-weight: 700;
  line-height: 1.35;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.actions {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  margin-top: 14px;
}
.single-action,
.tx-actions {
  display: flex;
  justify-content: flex-end;
}
.action {
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 21px;
  background: var(--bg);
  color: var(--nq-light-blue);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.action.primary {
  border: none;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.action.danger { color: var(--nq-red); }
.action:disabled {
  cursor: default;
  opacity: 0.5;
}
.subtle {
  margin: 0;
  color: var(--text-2);
  font-size: 14px;
  text-align: center;
}
.empty-action {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--nq-light-blue);
  background: var(--card);
  text-decoration: none;
  font-weight: 800;
  font-size: 13px;
}
.primary-action {
  border: none;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
</style>
