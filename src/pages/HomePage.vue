<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useVisiblePolling } from '../composables/useVisiblePolling'
import { useAfterRestoreRefresh } from '../composables/useAfterRestoreRefresh'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore, matchPayments, isOverdue } from '../stores/invoices'
import { useBucketsStore, bucketTotalNim } from '../stores/buckets'
import { useInboxStore } from '../stores/inbox'
import InboxRequestCard from '../components/InboxRequestCard.vue'
import BucketSheet from '../components/BucketSheet.vue'
import IdentitySetupCard from '../components/IdentitySetupCard.vue'
import { makeRequestLink, makePaymentShareLink, makePublicHandleLink, shortAddress, transactionExplorerUrl } from '../services/links'
import { sendPaymentRequest, inboxAvailable } from '../services/inbox'
import { shareOrCopy, canShare } from '../services/share'
import { fetchIncomingPayments, fetchForwardAddresses, newestFirst, type IncomingPayment } from '../services/history'
import { newActivity, getLastSeen, setLastSeen } from '../services/activity'
import { getRates, nimToFiat, type NimRates } from '../services/rates'
import { resolveMyAddresses, receiveAddress, myAddresses as walletAddressVariants } from '../services/nimiq'
import { preferredCurrency } from '../services/prefs'
import { handlesEnabled, loadMyHandle, handleForAddress, saveMyHandle } from '../services/handles'
import {
  resolveIdentitySetup,
  identitySetupVisible,
  markPublicProfileShared,
  snoozeIdentitySetup,
  noteIdentitySetupProgress,
  type IdentitySetupResult,
} from '../services/identity-setup'
import EmptyState from '../components/EmptyState.vue'
import Identicon from '../components/Identicon.vue'
import type { Bucket } from '../types/profile'

const router = useRouter()
const profilesStore = useProfilesStore()
const invoicesStore = useInvoicesStore()
const bucketsStore = useBucketsStore()
const inboxStore = useInboxStore()
const bucketSheetOpen = ref(false)
const selectedBucketId = ref<string | null>(null)
const inviteBucketId = ref<string | null>(null)
const selectedBucket = computed<Bucket | null>(() =>
  bucketsStore.buckets.find(b => b.id === selectedBucketId.value) ?? null,
)

function openBucket(id: string | null, startInviting = false) {
  selectedBucketId.value = id
  inviteBucketId.value = startInviting ? id : null
  bucketSheetOpen.value = true
}

function bucketProgress(b: Bucket): number {
  return Math.min(100, (bucketTotalNim(b) / b.goalNim) * 100)
}
const copiedId = ref<string | null>(null)
const payingId = ref<string | null>(null)
const remindingId = ref<string | null>(null)
const remindedId = ref<string | null>(null)
const remindError = ref<string | null>(null)
const paidExpanded = ref(false)
const unknownExpanded = ref(false)
const incoming = ref<IncomingPayment[]>([])
const myAddresses = ref<string[]>([])
const lastSeenAt = ref<number | null>(null)
const dueDismissed = ref(false)
const incomingLoading = ref(false)
const incomingError = ref(false)
const rates = ref<NimRates | null>(null)
const selfHandle = ref<string | null>(null)
const showLearnMore = ref(false)
const justShared = ref(false)

async function refreshPageData() {
  await Promise.all([
    profilesStore.reload(),
    invoicesStore.reload(),
    inboxStore.reload(),
    bucketsStore.reload(),
  ])
  senderAliases.value = new Map()
  await loadIncoming()
  if (profilesStore.self) await inboxStore.refresh(profilesStore.self.address)
}

useAfterRestoreRefresh(refreshPageData)

onMounted(() => {
  bucketsStore.load()
  getRates().then(r => (rates.value = r))
  void loadSelfHandle()
})

watch(() => profilesStore.self?.address, async (address, prev) => {
  if (address && address !== prev) {
    await loadIncoming()
    await loadSelfHandle()
  }
})

/** Local @handle: optimistic from cache/profile, then confirmed via the registry. */
async function loadSelfHandle() {
  const self = profilesStore.self
  selfHandle.value = self?.handle ?? null
  if (!handlesEnabled() || !self) return
  const wallets = walletAddressVariants(self.address)
  const cached = loadMyHandle(wallets)
  if (cached?.handle) selfHandle.value = cached.handle
  try {
    const claim = await handleForAddress(self.address)
    if (claim) {
      selfHandle.value = claim.handle
      saveMyHandle(wallets, claim)
    }
  } catch {
    // registry unreachable — keep the cached/optimistic handle
  }
}

/** Identity setup guidance: next step to claim a handle, add a contact, or share the profile. */
const identitySetup = computed<IdentitySetupResult>(() =>
  resolveIdentitySetup({
    handlesEnabled: handlesEnabled(),
    handle: selfHandle.value,
    contactCount: profilesStore.contacts.length,
  }),
)

const identityCardVisible = computed(() => identitySetupVisible(identitySetup.value))

const identityPublicUrl = computed(() =>
  selfHandle.value ? makePublicHandleLink(selfHandle.value) : undefined,
)

watch(() => profilesStore.contacts.length, (count, prev) => {
  if ((prev ?? 0) === 0 && count > 0) noteIdentitySetupProgress()
})

watch(selfHandle, (handle, prev) => {
  if (!prev && handle) noteIdentitySetupProgress()
})

function claimIdentity() {
  router.push({ path: '/me', query: { sheet: 'claim' } })
}

function addContactFromIdentity() {
  router.push('/add')
}

async function shareIdentityProfile() {
  if (!identityPublicUrl.value) return
  await shareOrCopy(identityPublicUrl.value)
  markPublicProfileShared()
  justShared.value = true
  setTimeout(() => (justShared.value = false), 2000)
}

function toggleLearnMore() {
  showLearnMore.value = !showLearnMore.value
}

function dismissIdentitySetup() {
  snoozeIdentitySetup(Date.now())
}

useVisiblePolling(() => loadIncoming(), 60_000)

const pendingTotal = computed(() =>
  invoicesStore.pendingTotalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }),
)
const incomingNewest = computed(() => newestFirst(incoming.value))

/** People row: favorites first, then recent, deduped, capped. */
const quickContacts = computed(() => {
  const merged = [...profilesStore.favorites, ...profilesStore.recent]
  return [...new Map(merged.map(p => [p.id, p])).values()].slice(0, 8)
})

/** Brand-new user: nothing to show yet — welcome them instead of empty sections. */
const freshUser = computed(() =>
  profilesStore.contacts.length === 0
  && invoicesStore.pending.length === 0
  && inboxStore.actionable.length === 0,
)

const overdueInvoices = computed(() => invoicesStore.pending.filter(i => isOverdue(i)))

function hasRequestFrom(profile: { address: string }): boolean {
  const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
  const addr = compact(profile.address)
  return inboxStore.actionable.some(i => compact(i.sender) === addr)
}

/** Compact invoice address → paired addresses it forwards to (Nimiq Pay pays from the paired account). */
const senderAliases = ref<Map<string, Set<string>>>(new Map())

/** Pending invoices that look settled by an incoming payment — confirmed with one tap. */
const detectedPaid = computed(() => matchPayments(invoicesStore.pending, incoming.value, senderAliases.value))

/** Banner data: what changed since the last dismiss. Null until first load resolves. */
const activity = computed(() => {
  if (lastSeenAt.value == null) return null
  const a = newActivity({
    payments: incoming.value,
    inboxItems: inboxStore.actionable,
    invoices: invoicesStore.pending,
    lastSeenAt: lastSeenAt.value,
  })
  return { ...a, dueInvoices: dueDismissed.value ? [] : a.dueInvoices }
})

const bannerSummary = computed(() => {
  if (!activity.value) return null
  const parts: string[] = []
  const p = activity.value.payments.length
  if (p) parts.push(`${p} payment${p === 1 ? '' : 's'} received`)
  const r = activity.value.requests.length
  if (r) parts.push(`${r} new request${r === 1 ? '' : 's'}`)
  const d = activity.value.dueInvoices.length
  if (d) parts.push(`${d} invoice${d === 1 ? '' : 's'} due`)
  return parts.length ? parts.join(' · ') : null
})

const BANNER_AUTO_DISMISS_MS = 4500
let bannerDismissTimer: ReturnType<typeof setTimeout> | null = null

function clearBannerTimer() {
  if (bannerDismissTimer != null) {
    clearTimeout(bannerDismissTimer)
    bannerDismissTimer = null
  }
}

function dismissBanner() {
  clearBannerTimer()
  const now = Date.now()
  setLastSeen(myAddresses.value, now)
  lastSeenAt.value = now
  dueDismissed.value = true // due invoices are not timestamp-gated; hide for this session
}

watch(bannerSummary, (summary) => {
  clearBannerTimer()
  if (!summary) return
  bannerDismissTimer = setTimeout(() => dismissBanner(), BANNER_AUTO_DISMISS_MS)
})

onUnmounted(clearBannerTimer)

/** One-line summary under the page title — names what actually needs action. */
const attentionSubtitle = computed(() => {
  const parts: string[] = []
  const requests = inboxStore.actionable.length
  if (requests) parts.push(`${requests} payment request${requests === 1 ? '' : 's'}`)
  const toConfirm = detectedPaid.value.size
  if (toConfirm) parts.push(`${toConfirm} payment${toConfirm === 1 ? '' : 's'} to confirm`)
  const overdue = overdueInvoices.value.length
  if (overdue) parts.push(`${overdue} overdue invoice${overdue === 1 ? '' : 's'}`)
  if (parts.length) return `${parts.join(' · ')} — review below.`
  if (invoicesStore.pending.length) {
    const n = invoicesStore.pending.length
    return `${n} open invoice${n === 1 ? '' : 's'} you're waiting on.`
  }
  if (freshUser.value) return 'Add people you pay — activity shows up here.'
  return 'Send, request, and track payments with your people.'
})

/** "≈ 1.23 €" in the user's preferred fiat currency, or null when NIM-only / rates missing. */
function fiatApprox(nim: number): string | null {
  if (preferredCurrency.value === 'NIM' || !rates.value) return null
  const amount = nimToFiat(nim, preferredCurrency.value, rates.value)
  if (amount == null) return null
  return `≈ ${amount.toLocaleString(undefined, { style: 'currency', currency: preferredCurrency.value })}`
}

function profileFor(address: string) {
  const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
  return profilesStore.getByAddress(address)
    ?? profilesStore.contacts.find(p => compact(p.address) === compact(address))
}

function contactName(address: string): string {
  return profileFor(address)?.name ?? shortAddress(address)
}

const knownRequests = computed(() => inboxStore.actionable.filter(i => profileFor(i.sender)))
const unknownRequests = computed(() => inboxStore.actionable.filter(i => !profileFor(i.sender)))
const visibleUnknown = computed(() =>
  unknownExpanded.value ? unknownRequests.value : unknownRequests.value.slice(0, 2),
)

async function payRequest(item: (typeof inboxStore.actionable)[number], amountNim?: number) {
  payingId.value = item.id
  try {
    await inboxStore.pay(item, amountNim)
  } catch {
    // wallet popup dismissed or send failed — no state change (spec)
  } finally {
    payingId.value = null
  }
}

function paymentShareLink(amountNim: number, description: string): string | null {
  if (!profilesStore.self) return null
  const addr = receiveAddress(profilesStore.self.address) ?? profilesStore.self.address
  return makePaymentShareLink(addr, amountNim, description || 'Invoice')
}

async function copyLink(id: string, amountNim: number, description: string) {
  const link = paymentShareLink(amountNim, description)
  if (!link) return
  const result = await shareOrCopy(link, description || 'Payment request')
  if (result === 'copied') {
    copiedId.value = id
    setTimeout(() => (copiedId.value = null), 1500)
  }
}

/** Re-send the payment request to the payer's NimConnect inbox. Reusing the
 * invoice id as objectId makes repeat sends deliver as reminders, not duplicates. */
async function remind(invoice: { id: string; address: string; amountNim: number; description: string }) {
  const self = profilesStore.self
  if (!self || remindingId.value) return
  remindingId.value = invoice.id
  remindError.value = null
  try {
    await sendPaymentRequest({
      recipient: invoice.address,
      // Payload must pay the wallet-signed sender, so use the raw self address
      payload: makeRequestLink(self.address, invoice.amountNim, invoice.description || 'Invoice'),
      objectId: invoice.id,
      sender: self.address,
    })
    remindedId.value = invoice.id
    setTimeout(() => (remindedId.value = null), 2500)
  } catch (e) {
    remindError.value = e instanceof Error ? e.message : 'Sending failed'
  } finally {
    remindingId.value = null
  }
}

async function loadIncoming() {
  if (!profilesStore.self || incomingLoading.value) return
  incomingLoading.value = true
  incomingError.value = false
  try {
    myAddresses.value = await resolveMyAddresses(profilesStore.self.address)
    incoming.value = await fetchIncomingPayments(myAddresses.value)
    // First run for this wallet: nothing pre-existing is "new"
    if (lastSeenAt.value == null) {
      const seen = getLastSeen(myAddresses.value)
      if (seen == null) setLastSeen(myAddresses.value)
      lastSeenAt.value = seen ?? Date.now()
    }
    await loadSenderAliases()
    await bucketsStore.recordChainContributions(incoming.value)
  } catch {
    incomingError.value = true
  } finally {
    incomingLoading.value = false
  }
}

/** Resolve paired outgoing addresses for pending-invoice contacts, once per address. */
async function loadSenderAliases() {
  const compact = (a: string) => a.replace(/\s+/g, '').toUpperCase()
  const addresses = [...new Set(invoicesStore.pending.map(i => compact(i.address)))]
    .filter(a => !senderAliases.value.has(a))
  if (!addresses.length) return
  const next = new Map(senderAliases.value)
  await Promise.all(addresses.map(async (addr) => {
    try {
      next.set(addr, new Set((await fetchForwardAddresses(addr)).map(compact)))
    } catch {
      // best-effort — exact-address matching still works
    }
  }))
  senderAliases.value = next
}
</script>

<template>
  <div class="page">
    <header class="header">
      <div>
        <h1>Home</h1>
        <p>{{ attentionSubtitle }}</p>
      </div>
      <router-link
        :to="{ path: '/me', query: { sheet: 'request' } }"
        class="add-link"
        aria-label="Request payment"
      >📥</router-link>
      <router-link to="/add" class="add-link" aria-label="Add contact">＋</router-link>
    </header>

    <IdentitySetupCard
      v-if="identityCardVisible"
      :result="identitySetup"
      :public-url="identityPublicUrl"
      @claim="claimIdentity"
      @add-contact="addContactFromIdentity"
      @share="shareIdentityProfile"
      @learn-more="toggleLearnMore"
      @dismiss="dismissIdentitySetup"
    />
    <p v-if="showLearnMore" class="identity-learn-more">
      An @handle is a memorable link people can pay or message you at — no address to copy, and you decide what shows on your public page.
    </p>

    <EmptyState
      v-if="freshUser && !identityCardVisible"
      icon="👋"
      title="Welcome to NimConnect"
      hint="Add the people you pay — splits, requests and invoices show up here."
    >
      <template v-if="!selfHandle">
        <button type="button" class="empty-action primary-action" @click="claimIdentity">Claim @handle</button>
        <router-link to="/add" class="empty-action">Add contact</router-link>
      </template>
      <template v-else>
        <router-link to="/add" class="empty-action primary-action">Add contact</router-link>
        <button type="button" class="empty-action" @click="shareIdentityProfile">
          {{ justShared ? 'Shared ✓' : 'Share public profile' }}
        </button>
      </template>
    </EmptyState>

    <section v-if="quickContacts.length && !freshUser" class="home-panel people-panel">
      <div class="section-head">
        <h2>People</h2>
      </div>
      <div class="people-row">
        <router-link
          v-for="p in quickContacts"
          :key="p.id"
          :to="`/profile/${p.id}`"
          class="people-contact"
        >
          <span class="people-avatar">
            <Identicon :address="p.address" :size="66" />
            <span v-if="hasRequestFrom(p)" class="people-badge" aria-label="Payment request waiting">!</span>
          </span>
          <span class="people-name">{{ p.name }}</span>
        </router-link>
      </div>
    </section>

    <section v-if="bannerSummary && activity" class="activity-banner" role="status">
      <span class="banner-summary">{{ bannerSummary }}</span>
      <button type="button" class="banner-dismiss" aria-label="Dismiss" @click="dismissBanner">✕</button>
    </section>

    <section v-if="inboxStore.actionable.length" class="home-panel">
      <div class="section-head">
        <h2>Requests waiting</h2>
        <button
          type="button"
          class="section-action icon-action"
          :disabled="inboxStore.refreshing"
          aria-label="Refresh"
          @click="inboxStore.refresh()"
        >
          {{ inboxStore.refreshing ? '…' : '↻' }}
        </button>
      </div>

      <div class="invoice-list">
        <InboxRequestCard
          v-for="item in knownRequests"
          :key="item.id"
          :item="item"
          :contact-name="contactName(item.sender)"
          :paying="payingId === item.id"
          @pay="payRequest(item, $event)"
          @dismiss="inboxStore.dismiss(item)"
        />
      </div>

      <template v-if="unknownRequests.length">
        <div class="section-head unknown-head">
          <h3>Unknown senders ({{ unknownRequests.length }})</h3>
        </div>
        <div class="invoice-list">
          <InboxRequestCard
            v-for="item in visibleUnknown"
            :key="item.id"
            :item="item"
            :paying="payingId === item.id"
            @pay="payRequest(item, $event)"
            @dismiss="inboxStore.dismiss(item)"
          />
        </div>
        <button
          v-if="unknownRequests.length > 2 && !unknownExpanded"
          type="button" class="section-action show-more" @click="unknownExpanded = true"
        >
          Show all {{ unknownRequests.length }}
        </button>
      </template>
    </section>

    <section v-if="!freshUser" class="home-panel">
      <div class="section-head">
        <h2>Recent payments</h2>
        <button
          v-if="profilesStore.self"
          type="button"
          class="section-action icon-action"
          :disabled="incomingLoading"
          aria-label="Refresh"
          @click="loadIncoming"
        >
          {{ incomingLoading ? '…' : '↻' }}
        </button>
      </div>

      <p v-if="!profilesStore.self" class="notice inset">
        Connect inside Nimiq Pay to see payments sent to your wallet, including unknown senders.
      </p>
      <p v-else-if="incomingError" class="notice inset">Recent payments are unavailable right now.</p>
      <div
        v-else-if="incomingLoading && incoming.length === 0"
        class="incoming-skeleton"
        aria-busy="true"
        aria-label="Checking your wallet"
      >
        <div v-for="n in 3" :key="n" class="skeleton-row">
          <div class="skeleton skeleton-avatar" />
          <div class="skeleton-stack">
            <div class="skeleton skeleton-line medium" />
            <div class="skeleton skeleton-line short" />
          </div>
        </div>
      </div>
      <div v-else-if="incomingNewest.length" class="incoming-list">
        <article v-for="payment in incomingNewest.slice(0, 8)" :key="payment.hash" class="panel-item incoming-card">
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
              <span v-else-if="payment.viaSwap" class="contact-link swap">Wallet top-up</span>
              <span v-else class="contact-link missing">Unknown sender</span>
              <span class="invoice-date">
                {{ shortAddress(payment.sender) }} · {{ new Date(payment.timestamp * (payment.timestamp < 1e12 ? 1000 : 1)).toLocaleDateString() }}
                <span v-if="payment.viaSwap" class="swap-badge">via swap</span>
              </span>
            </div>
            <div class="invoice-amount positive">
              +{{ payment.valueNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
              <span v-if="fiatApprox(payment.valueNim)" class="fiat">{{ fiatApprox(payment.valueNim) }}</span>
            </div>
          </div>
          <p v-if="payment.message" class="description">“{{ payment.message }}”</p>
          <div class="actions tx-actions">
            <a
              class="action external-action"
              :href="transactionExplorerUrl(payment.hash)"
              target="_blank"
              rel="noopener"
            >
              View ↗
            </a>
            <router-link
              v-if="!profileFor(payment.sender) && !payment.viaSwap"
              :to="{ path: '/add', query: { address: payment.sender } }"
              class="action primary"
            >
              Add contact
            </router-link>
          </div>
        </article>
      </div>
      <p v-else class="subtle">No recent payments found yet.</p>
    </section>

    <section v-if="invoicesStore.pending.length" class="summary">
      <div class="summary-main">
        <span class="summary-value">{{ pendingTotal }}</span>
        <span class="summary-label">NIM pending</span>
        <span v-if="fiatApprox(invoicesStore.pendingTotalNim)" class="summary-fiat">{{ fiatApprox(invoicesStore.pendingTotalNim) }}</span>
      </div>
      <div class="summary-side">
        <span class="summary-value">{{ invoicesStore.pending.length }}</span>
        <span class="summary-label">open invoices</span>
      </div>
    </section>

    <p v-if="!profilesStore.self && invoicesStore.pending.length" class="notice">
      Connect inside Nimiq Pay to copy payment links to your wallet address.
    </p>

    <section v-if="!freshUser" class="home-panel secondary-panel">
      <div class="section-head">
        <h2>Open invoices</h2>
      </div>

      <template v-if="invoicesStore.pending.length">
        <div class="invoice-list">
          <article v-for="invoice in invoicesStore.pending" :key="invoice.id" class="panel-item invoice-card">
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
                <span class="invoice-date">
                  Created {{ new Date(invoice.createdAt).toLocaleDateString() }}
                  <template v-if="invoice.dueAt">
                    · <span :class="{ overdue: isOverdue(invoice) }">{{ isOverdue(invoice) ? 'Overdue since' : 'Due' }} {{ new Date(invoice.dueAt).toLocaleDateString() }}</span>
                  </template>
                </span>
              </div>
              <div class="invoice-amount">
                {{ invoice.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
                <span v-if="invoice.fiatAmount" class="fiat">{{ invoice.fiatAmount }} {{ invoice.fiatCurrency }}</span>
                <span v-else-if="fiatApprox(invoice.amountNim)" class="fiat">{{ fiatApprox(invoice.amountNim) }}</span>
              </div>
            </div>

            <p class="description">{{ invoice.description || 'Invoice' }}</p>

            <p v-if="detectedPaid.has(invoice.id)" class="detected">
              ✓ Payment detected — {{ detectedPaid.get(invoice.id)!.valueNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
              received {{ new Date(detectedPaid.get(invoice.id)!.timestamp * (detectedPaid.get(invoice.id)!.timestamp < 1e12 ? 1000 : 1)).toLocaleDateString() }}.
              <button type="button" class="detected-confirm" @click="invoicesStore.markPaid(invoice.id)">Mark paid</button>
            </p>

            <div class="actions">
              <button
                type="button"
                class="action primary"
                :disabled="!profilesStore.self"
                @click="copyLink(invoice.id, invoice.amountNim, invoice.description)"
              >
                {{ copiedId === invoice.id ? 'Copied' : canShare() ? 'Share link' : 'Copy link' }}
              </button>
              <button
                v-if="inboxAvailable() && profilesStore.self && profileFor(invoice.address)"
                type="button"
                class="action"
                :disabled="remindingId === invoice.id"
                @click="remind(invoice)"
              >
                {{ remindedId === invoice.id ? 'Reminded ✓' : remindingId === invoice.id ? 'Sending…' : 'Remind' }}
              </button>
              <button type="button" class="action" @click="invoicesStore.markPaid(invoice.id)">
                Mark paid
              </button>
              <button type="button" class="action danger" @click="invoicesStore.remove(invoice.id)">
                Delete
              </button>
            </div>
          </article>
        </div>
        <p v-if="remindError" class="notice inset">{{ remindError }}</p>
      </template>

      <EmptyState
        v-else
        icon="🧾"
        title="No open invoices"
        hint="Create invoices from a contact profile, then track what is still pending here."
      >
        <router-link to="/contacts" class="empty-action primary-action">Choose contact</router-link>
        <router-link to="/add" class="empty-action">Add contact</router-link>
      </EmptyState>
    </section>

    <section v-if="!freshUser || bucketsStore.buckets.length" class="home-panel secondary-panel">
      <div class="section-head">
        <h2>Shared trips</h2>
        <button type="button" class="section-action" @click="openBucket(null)">＋ New</button>
      </div>
      <p v-if="!bucketsStore.buckets.length" class="subtle left">
        Save up together — create a trip and share the link with friends.
      </p>
      <div v-else class="invoice-list">
        <button
          v-for="b in [...bucketsStore.active, ...bucketsStore.completed]"
          :key="b.id"
          type="button"
          class="panel-item bucket-card"
          :class="{ 'bucket-done': b.status === 'completed' }"
          @click="openBucket(b.id)"
        >
          <div class="bucket-head">
            <span class="bucket-name">🪣 {{ b.name }}</span>
            <span class="bucket-amount">
              {{ bucketTotalNim(b).toLocaleString(undefined, { maximumFractionDigits: 2 }) }}
              / {{ b.goalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
              <template v-if="b.status === 'completed'"> ✓</template>
            </span>
          </div>
          <div class="bucket-bar">
            <div class="bucket-fill" :style="{ width: `${bucketProgress(b)}%` }" />
          </div>
        </button>
      </div>
    </section>

    <section v-if="invoicesStore.paid.length" class="home-panel secondary-panel">
      <div class="section-head">
        <h2>Recently paid</h2>
        <button type="button" class="section-action" @click="paidExpanded = !paidExpanded">
          {{ paidExpanded ? 'Hide' : `Show (${invoicesStore.paid.length})` }}
        </button>
      </div>
      <div v-if="paidExpanded" class="invoice-list">
        <article v-for="invoice in invoicesStore.paid.slice(0, 10)" :key="invoice.id" class="panel-item invoice-card paid-card">
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
              <span class="invoice-date">
                Paid {{ new Date(invoice.paidAt ?? invoice.createdAt).toLocaleDateString() }}
              </span>
            </div>
            <div class="invoice-amount">
              {{ invoice.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
              <span v-if="invoice.fiatAmount" class="fiat">{{ invoice.fiatAmount }} {{ invoice.fiatCurrency }}</span>
            </div>
          </div>
          <p class="description">{{ invoice.description || 'Invoice' }}</p>
          <div class="actions">
            <button type="button" class="action" @click="invoicesStore.duplicate(invoice.id)">
              Duplicate
            </button>
            <button type="button" class="action danger" @click="invoicesStore.remove(invoice.id)">
              Delete
            </button>
          </div>
        </article>
      </div>
    </section>

    <BucketSheet
      :open="bucketSheetOpen"
      :bucket="selectedBucket"
      :start-inviting="inviteBucketId != null && inviteBucketId === selectedBucketId"
      @close="bucketSheetOpen = false"
      @open-bucket="id => openBucket(id, true)"
    />
  </div>
</template>

<style scoped>
.page {
  padding: 16px 16px 88px;
  display: flex;
  flex-direction: column;
  gap: 0;
  max-width: 100%;
  overflow-x: hidden;
}
.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.header h1 {
  font-size: 32px;
  font-weight: 800;
  line-height: 1.15;
  margin: 4px 0 6px;
  letter-spacing: -0.02em;
}
.header p {
  margin: 0;
  color: var(--text-2);
  font-size: 15px;
  line-height: 1.4;
}
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
.home-panel {
  margin-bottom: 16px;
  padding: 16px;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow);
  border: 1px solid var(--border);
}
.people-panel {
  padding: 18px 14px 16px;
  margin-bottom: 12px;
}
.secondary-panel {
  opacity: 1;
}
.section-head {
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.section-head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
}
.section-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-2);
}
.section-action {
  min-height: 32px;
  padding: 0 4px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--nq-light-blue);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}
.section-action:disabled { opacity: 0.55; cursor: default; }
.section-action.icon-action {
  min-width: 32px;
  min-height: 32px;
  padding: 0;
  color: var(--text-2);
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
}
.people-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 2px 0 4px;
  scrollbar-width: none;
}
.people-row::-webkit-scrollbar { display: none; }
.people-contact {
  flex: 0 0 auto;
  width: 66px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-decoration: none;
}
.people-avatar { position: relative; display: inline-flex; }
.people-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--nq-red);
  color: var(--nimiq-white);
  font-size: 11px;
  font-weight: 800;
  border: 2px solid var(--card);
}
.people-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}
.summary {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 10px;
  margin: 8px 0 16px;
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
.summary-fiat {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}
.notice {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--text-6);
  color: var(--text);
  font-size: 13px;
}
.notice.inset { margin: 0; }
.identity-learn-more {
  margin: -4px 0 16px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--text-6);
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.45;
}
.unknown-head { margin-top: 16px; margin-bottom: 10px; }
.show-more { margin-top: 10px; align-self: flex-start; }
.invoice-list { display: flex; flex-direction: column; gap: 10px; }
.incoming-list { display: flex; flex-direction: column; gap: 10px; }
.panel-item {
  padding: 14px;
  border-radius: var(--radius);
  background: var(--bg);
  border: 1px solid var(--border);
}
.paid-card { opacity: 0.75; }
.incoming-card { overflow: hidden; }
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
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contact-link.missing { color: var(--text-2); }
.contact-link.swap { color: var(--nq-light-blue); }
.invoice-date { display: block; margin-top: 2px; color: var(--text-2); font-size: 13px; }
.invoice-date .overdue { color: var(--nq-red); font-weight: 700; }
.swap-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: var(--nimiq-radius-small);
  background: var(--text-6);
  font-size: 11px;
  font-weight: 700;
  color: var(--nq-light-blue);
}
.detected {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0 0;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: rgba(33, 188, 165, 0.12);
  color: var(--nq-green);
  font-size: 13px;
  font-weight: 700;
}
.detected-confirm {
  min-height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 16px;
  background: var(--nq-green);
  color: var(--nimiq-white);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
}
.invoice-amount {
  text-align: right;
  font-weight: 700;
  color: var(--nq-gold-dark);
  flex: 0 0 auto;
  max-width: 38%;
  font-size: 15px;
}
.invoice-amount.positive { color: var(--nq-green); }
.fiat { display: block; margin-top: 2px; color: var(--text-2); font-size: 12px; font-weight: 600; }
.description {
  margin: 12px 0 0;
  color: var(--text);
  font-weight: 600;
  font-size: 15px;
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
  background: var(--card);
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
  color: var(--nimiq-blue);
  background: var(--nimiq-gold-bg);
}
.action.external-action {
  font-weight: 700;
  color: var(--text-2);
}
.action.danger { color: var(--nq-red); }
.action:disabled {
  cursor: default;
  opacity: 0.5;
}
.subtle {
  margin: 0;
  color: var(--text-2);
  font-size: 15px;
  text-align: center;
}
.subtle.left { text-align: left; }
.empty-action {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--nq-light-blue);
  background: var(--bg);
  text-decoration: none;
  font-weight: 800;
  font-size: 13px;
}
.primary-action {
  border: none;
  color: var(--nimiq-blue);
  background: var(--nimiq-gold-bg);
}
.bucket-card {
  width: 100%;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bucket-done { opacity: 0.7; }
.bucket-head { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.bucket-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bucket-amount { flex: 0 0 auto; font-weight: 700; font-size: 13px; color: var(--nq-gold-dark); }
.bucket-bar { height: 8px; border-radius: 4px; background: var(--text-6); overflow: hidden; }
.bucket-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--nimiq-gold-bg);
  transition: width var(--movement-duration) var(--nimiq-ease);
}
.bucket-done .bucket-fill {
  background: var(--nimiq-green-bg);
}
.incoming-skeleton { padding: 4px 0 8px; }
.incoming-skeleton .skeleton-row { padding: 10px 0; }
.activity-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--nq-gold) 28%, var(--border));
  background: color-mix(in srgb, var(--nq-gold) 10%, var(--card));
  box-shadow: none;
}
.banner-summary {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  line-height: 1.3;
}
.banner-dismiss {
  flex: 0 0 auto;
  min-width: 28px;
  min-height: 28px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-2);
  font-size: 13px;
  opacity: 0.7;
}
</style>
