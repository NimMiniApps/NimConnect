<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { useBucketsStore } from '../stores/buckets'
import { useInvoicesStore } from '../stores/invoices'
import { walletStatus, insideNimiqPay, myAddresses, receiveAddress, resolveMyAddresses } from '../services/nimiq'
import { bootstrapWallet, retryWalletBootstrap } from '../services/wallet-bootstrap'
import { cloudBackupEnabled } from '../services/backup-prefs'
import { fetchIncomingPayments, timestampMs, type IncomingPayment } from '../services/history'
import ProfileView from '../components/ProfileView.vue'
import EmptyState from '../components/EmptyState.vue'
import ClaimHandleSheet from '../components/ClaimHandleSheet.vue'
import QrCode from '../components/QrCode.vue'
import {
  handlesEnabled,
  findMyHandle,
  resolveHandleEnriched,
  fetchPublicProfile,
  claimOwnerAddress,
  saveMyHandle,
  syncPublicProfile,
  shareSelectionForProfile,
  publicProfileNeedsSync,
  type HandleClaim,
  type PublicProfile,
} from '../services/handles'
import { makePublicHandleLink, makeRequestLink, makePaymentShareLink } from '../services/links'
import { copyText } from '../services/share'

const router = useRouter()
const store = useProfilesStore()
const bucketsStore = useBucketsStore()
const invoicesStore = useInvoicesStore()
const ready = ref(false)
const retrying = ref(false)

const claimOpen = ref(false)
const myHandle = ref<HandleClaim | null>(null)
const published = ref<PublicProfile | null>(null)
const copyFeedback = ref<string | null>(null)
const publishState = ref<'idle' | 'publishing' | 'published' | 'needs-pay'>('idle')
const qrFullscreen = ref(false)
const recentIncoming = ref<IncomingPayment[]>([])

const shareUrl = computed(() =>
  myHandle.value
    ? makePublicHandleLink(
        myHandle.value.handle,
        handleConfirming.value ? myHandle.value.tx_hash : undefined,
      )
    : '',
)

const receiveQrLink = computed(() => {
  if (!store.self) return ''
  const addr = receiveAddress(store.self.address) ?? store.self.address
  return makeRequestLink(addr)
})

const qrLink = computed(() => shareUrl.value || receiveQrLink.value)

const shareLink = computed(() => {
  if (!store.self) return ''
  if (shareUrl.value) return shareUrl.value
  const addr = receiveAddress(store.self.address) ?? store.self.address
  return makePaymentShareLink(addr)
})

const handleConfirming = computed(() => !!myHandle.value && !myHandle.value.block_height)

const hasPublishedContent = computed(() => {
  const p = published.value
  if (!p) return false
  return !!(p.display_name || p.bio || p.github || p.website || p.x || p.tags?.length)
})

const publicProfileVisible = computed(() => !!myHandle.value && !handleConfirming.value)

const statusHint = computed(() => {
  if (walletStatus.value === 'connecting') {
    return 'Approve wallet access in Nimiq Pay…'
  }
  return 'Connecting…'
})

const quickStats = computed(() => [
  { label: 'Contacts', value: store.contacts.length },
  { label: 'Buckets', value: bucketsStore.buckets.length },
  { label: 'Payment pages', value: invoicesStore.invoices.length },
  // Public profile views — add when analytics exist
])

type ActivityKind = 'received' | 'bucket' | 'profile'
type ActivityItem = { id: string; kind: ActivityKind; icon: string; label: string; at: number }

const recentActivity = computed((): ActivityItem[] => {
  const items: ActivityItem[] = []

  for (const p of recentIncoming.value.slice(0, 3)) {
    const amount = p.valueNim.toLocaleString(undefined, { maximumFractionDigits: 2 })
    items.push({
      id: `rx-${p.hash}`,
      kind: 'received',
      icon: '💰',
      label: `Received ${amount} NIM`,
      at: timestampMs(p.timestamp),
    })
  }

  for (const b of [...bucketsStore.buckets]
    .sort((a, c) => c.createdAt - a.createdAt)
    .slice(0, 2)) {
    items.push({
      id: `bucket-${b.id}`,
      kind: 'bucket',
      icon: '🟡',
      label: b.name ? `Created ${b.name}` : 'Created bucket',
      at: b.createdAt,
    })
  }

  if (store.self?.updatedAt && store.self.updatedAt > store.self.createdAt + 1000) {
    items.push({
      id: `profile-${store.self.id}`,
      kind: 'profile',
      icon: '✏',
      label: 'Updated profile',
      at: store.self.updatedAt,
    })
  }

  return items.sort((a, b) => b.at - a.at).slice(0, 4)
})

onMounted(async () => {
  try {
    await Promise.all([
      bootstrapWallet(),
      bucketsStore.load(),
      invoicesStore.load(),
    ])
  } finally {
    ready.value = true
  }
  void loadHandleState()
  void loadRecentIncoming()
})

async function retry() {
  retrying.value = true
  try {
    await retryWalletBootstrap()
    void loadHandleState()
    void loadRecentIncoming()
  } finally {
    retrying.value = false
  }
}

async function loadRecentIncoming() {
  if (!store.self) return
  try {
    const mine = await resolveMyAddresses(store.self.address)
    if (!mine.length) return
    recentIncoming.value = (await fetchIncomingPayments(mine)).slice(0, 5)
  } catch {
    recentIncoming.value = []
  }
}

async function loadHandleState() {
  if (!handlesEnabled() || !store.self) return
  const wallets = myAddresses(store.self.address)
  try {
    let claim = await findMyHandle(wallets)
    if (!claim && myHandle.value?.handle) {
      const byHandle = await resolveHandleEnriched(myHandle.value.handle)
      if (byHandle) claim = byHandle
    }
    if (claim) {
      myHandle.value = claim
      saveMyHandle(wallets, claim)
    }
    const owner = myHandle.value ? claimOwnerAddress(myHandle.value) : null
    published.value = owner
      ? (await fetchPublicProfile(owner))?.profile ?? null
      : null
    await tryPublishPublicProfile()
  } catch {
    // Registry unreachable — keep optimistic @handle if we already have one.
  }
}

async function tryPublishPublicProfile() {
  if (!handlesEnabled() || !store.self || !myHandle.value || handleConfirming.value) return
  const self = store.self
  const share = self.publicShare ?? shareSelectionForProfile(self)
  if (!publicProfileNeedsSync(self, share, published.value)) {
    publishState.value = hasPublishedContent.value ? 'published' : 'idle'
    return
  }
  if (!insideNimiqPay.value) {
    publishState.value = 'needs-pay'
    return
  }
  publishState.value = 'publishing'
  try {
    await syncPublicProfile(self, share, myAddresses(self.address))
    if (!self.publicShare) await store.update(self.id, { publicShare: share })
    const owner = claimOwnerAddress(myHandle.value)
    published.value = (await fetchPublicProfile(owner))?.profile ?? null
    publishState.value = 'published'
  } catch {
    publishState.value = 'needs-pay'
  }
}

async function onClaimed(handle: string, txHash: string, claim?: HandleClaim) {
  if (store.self) {
    myHandle.value = claim ?? {
      handle,
      address: store.self.address,
      tx_hash: txHash,
      block_height: 0,
      tx_index: 0,
    }
    if (claim) saveMyHandle(myAddresses(store.self.address), claim)
  }
  await loadHandleState()
  await tryPublishPublicProfile()
  window.setTimeout(() => void loadHandleState(), 8_000)
  window.setTimeout(() => void loadHandleState(), 45_000)
}

async function copyShareLink() {
  if (!shareLink.value) return
  await copyText(shareLink.value)
  copyFeedback.value = 'Link copied ✓'
  window.setTimeout(() => { copyFeedback.value = null }, 2500)
}

function openPublicProfile() {
  if (myHandle.value) {
    router.push(`/u/${myHandle.value.handle}`)
    return
  }
  if (shareLink.value) window.open(shareLink.value, '_blank', 'noopener')
}

function previewPublicProfile() {
  if (myHandle.value) {
    router.push(`/u/${myHandle.value.handle}`)
    return
  }
  router.push(`/edit/${store.self!.id}`)
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Profile</h1>
      <router-link to="/settings" class="settings-link" aria-label="Settings">⚙</router-link>
    </header>

    <p v-if="!ready || retrying" class="hint">{{ statusHint }}</p>

    <template v-else-if="store.self">
      <div class="own-profile">
        <section class="public-section" aria-labelledby="public-profile-heading">
          <h2 id="public-profile-heading" class="section-title">
            <span aria-hidden="true">🌍</span> Public profile
          </h2>
          <p class="section-sub">This is what other people see.</p>
          <ProfileView
            :profile="store.self"
            own
            :owner-handle="handlesEnabled() ? myHandle?.handle : undefined"
            :owner-handle-confirming="handleConfirming"
            :show-claim-handle="handlesEnabled() && !myHandle"
            @edit="router.push(`/edit/${store.self!.id}`)"
            @claim-handle="claimOpen = true"
          />
        </section>

        <section class="card stats" aria-label="Quick stats">
          <div v-for="stat in quickStats" :key="stat.label" class="stat">
            <span class="stat-value">{{ stat.value }}</span>
            <span class="stat-label">{{ stat.label }}</span>
          </div>
        </section>

        <section class="card identity" aria-labelledby="identity-heading">
          <h2 id="identity-heading" class="card-title">My identity</h2>
          <ul class="identity-list">
            <li>
              <span class="identity-label">Verified</span>
              <span
                class="status-chip"
                :class="myHandle && !handleConfirming ? 'chip-green' : 'chip-muted'"
              >
                {{ myHandle && !handleConfirming ? '✓' : '—' }}
              </span>
            </li>
            <li>
              <span class="identity-label">Public profile</span>
              <span
                class="status-chip"
                :class="publicProfileVisible ? 'chip-blue' : 'chip-muted'"
              >
                <span aria-hidden="true">🌍</span>
                {{ publicProfileVisible ? 'Visible' : 'Hidden' }}
              </span>
            </li>
            <li>
              <span class="identity-label">Cloud backup</span>
              <span
                class="status-chip"
                :class="cloudBackupEnabled ? 'chip-green' : 'chip-amber'"
              >
                <span aria-hidden="true">☁</span>
                {{ cloudBackupEnabled ? 'Enabled' : 'Off' }}
              </span>
            </li>
          </ul>
        </section>

        <section v-if="qrLink" class="card share-card">
          <h2 class="card-title">Share your public profile</h2>
          <button
            type="button"
            class="qr-button"
            aria-label="Enlarge QR code"
            @click="qrFullscreen = true"
          >
            <QrCode :text="qrLink" :size="160" />
          </button>
          <p v-if="shareUrl && publishState === 'publishing'" class="share-hint">
            Publishing Website, GitHub, and bio to your public page…
          </p>
          <p v-else-if="shareUrl && publishState === 'needs-pay'" class="share-hint">
            Open in Nimiq Pay to publish Website, GitHub, and bio.
          </p>
          <p v-else-if="shareUrl && !hasPublishedContent" class="share-hint">
            Your public page only shows pay until you publish. Edit public profile → save in Nimiq Pay.
          </p>
          <div class="share-actions">
            <button type="button" class="share-action" @click="copyShareLink">
              {{ copyFeedback ?? 'Copy link' }}
            </button>
            <button
              type="button"
              class="share-action"
              :disabled="!myHandle && !shareLink"
              @click="openPublicProfile"
            >
              Open profile
            </button>
          </div>
          <button
            type="button"
            class="preview-btn"
            :disabled="!myHandle"
            @click="previewPublicProfile"
          >
            View public profile
          </button>
        </section>

        <section v-if="recentActivity.length" class="card recently" aria-labelledby="recently-heading">
          <h2 id="recently-heading" class="card-title">Recently</h2>
          <ul class="recent-list">
            <li v-for="item in recentActivity" :key="item.id">
              <span class="recent-icon" aria-hidden="true">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </li>
          </ul>
        </section>
      </div>
    </template>

    <template v-else>
      <EmptyState
        v-if="insideNimiqPay"
        icon="🪪"
        title="No wallet connected"
        hint="Tap Connect below when Nimiq Pay asks for wallet access."
      />
      <EmptyState
        v-else
        icon="📱"
        title="Open in Nimiq Pay"
        hint="Wallet features need the Nimiq Pay app. You can still manage contacts and backups here in the browser."
      />
      <button
        v-if="insideNimiqPay"
        type="button"
        class="retry"
        :disabled="retrying"
        @click="retry"
      >
        Connect wallet
      </button>
    </template>

    <ClaimHandleSheet
      :open="claimOpen"
      @close="claimOpen = false"
      @claimed="(handle, txHash, claim) => onClaimed(handle, txHash, claim)"
    />

    <div
      v-if="qrFullscreen && qrLink"
      class="qr-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="QR code fullscreen"
      @click="qrFullscreen = false"
    >
      <button type="button" class="qr-close" aria-label="Close">✕</button>
      <div class="qr-overlay-card" @click.stop>
        <QrCode :text="qrLink" :size="280" />
        <p class="qr-overlay-hint">Tap anywhere to close</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.header { display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 12px; }
.settings-link {
  font-size: 22px; text-decoration: none; color: var(--text-2);
  min-width: 44px; min-height: 44px;
  display: flex; align-items: center; justify-content: center;
}
.hint { color: var(--text-2); }
.retry {
  display: block; width: 100%; height: 48px; margin-top: 16px;
  border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.retry:disabled { opacity: 0.5; }
.own-profile { display: flex; flex-direction: column; gap: 16px; }

.public-section { display: flex; flex-direction: column; gap: 8px; }
.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.section-sub {
  margin: 0 0 4px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.4;
}

.card-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 800;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 8px;
  padding: 16px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.stat-value {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.stat-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  line-height: 1.3;
}

.identity { padding: 16px 18px; }
.identity-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.identity-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
}
.identity-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
}
.chip-green {
  color: var(--nq-green);
  background: color-mix(in srgb, var(--nq-green) 20%, transparent);
}
.chip-blue {
  color: var(--nq-light-blue);
  background: color-mix(in srgb, var(--nq-light-blue) 18%, transparent);
}
.chip-amber {
  color: var(--nq-gold-dark);
  background: color-mix(in srgb, var(--nq-gold) 26%, transparent);
}
.chip-muted {
  color: var(--text-2);
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

.share-card {
  padding: 16px;
  text-align: center;
}
.qr-button {
  display: block;
  margin: 0 auto 12px;
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
  border-radius: 12px;
}
.qr-button:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }
.share-hint {
  margin: 0 0 12px;
  color: var(--text-2);
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
}
.share-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}
.share-action {
  min-height: 48px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--card);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.share-action:disabled { opacity: 0.5; cursor: default; }
.share-action:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }
.preview-btn {
  width: 100%;
  min-height: 48px;
  padding: 0 16px;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-light-blue-bg);
  color: var(--nimiq-white);
  box-shadow: var(--nimiq-shadow);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}
.preview-btn:disabled { opacity: 0.45; cursor: default; box-shadow: none; }
.preview-btn:not(:disabled):active { transform: scale(0.98); }
.preview-btn:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }

.recently { padding: 16px 18px; }
.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.recent-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
}
.recent-icon {
  flex-shrink: 0;
  width: 1.4em;
  text-align: center;
  font-size: 15px;
  line-height: 1;
}

.qr-overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 18, 40, 0.72);
  backdrop-filter: blur(4px);
}
.qr-close {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top));
  right: 16px;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: var(--nimiq-white);
  font-size: 18px;
  cursor: pointer;
}
.qr-overlay-card {
  padding: 20px;
  border-radius: 16px;
  background: var(--nimiq-white);
  box-shadow: var(--nimiq-shadow);
}
.qr-overlay-hint {
  margin: 12px 0 0;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-60);
}
</style>
