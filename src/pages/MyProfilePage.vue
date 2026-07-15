<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { walletStatus, insideNimiqPay, myAddresses, receiveAddress } from '../services/nimiq'
import { bootstrapWallet, retryWalletBootstrap } from '../services/wallet-bootstrap'
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
import { shareOrCopy, canShare } from '../services/share'

const router = useRouter()
const store = useProfilesStore()
const ready = ref(false)
const retrying = ref(false)

const claimOpen = ref(false)
const myHandle = ref<HandleClaim | null>(null)
const published = ref<PublicProfile | null>(null)
const shareFeedback = ref<string | null>(null)
const publishState = ref<'idle' | 'publishing' | 'published' | 'needs-pay'>('idle')

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

const shareButtonLabel = computed(() => {
  if (shareFeedback.value) return shareFeedback.value
  if (shareUrl.value) return canShare() ? 'Share public page' : 'Copy public page'
  return canShare() ? 'Share pay link' : 'Copy pay link'
})
const handleConfirming = computed(() => !!myHandle.value && !myHandle.value.block_height)

const hasPublishedContent = computed(() => {
  const p = published.value
  if (!p) return false
  return !!(p.display_name || p.bio || p.github || p.website || p.x || p.tags?.length)
})

const statusHint = computed(() => {
  if (walletStatus.value === 'connecting') {
    return 'Approve wallet access in Nimiq Pay…'
  }
  return 'Connecting…'
})

onMounted(async () => {
  try {
    await bootstrapWallet()
  } finally {
    ready.value = true
  }
  void loadHandleState()
})

async function retry() {
  retrying.value = true
  try {
    await retryWalletBootstrap()
    void loadHandleState()
  } finally {
    retrying.value = false
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

async function sharePublicPage() {
  if (!shareLink.value) return
  const title = myHandle.value
    ? `@${myHandle.value.handle} on NimConnect`
    : 'Pay me on NimConnect'
  const result = await shareOrCopy(shareLink.value, title)
  shareFeedback.value = result === 'shared' ? 'Shared ✓' : 'Link copied ✓'
  window.setTimeout(() => { shareFeedback.value = null }, 2500)
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
        <ProfileView
          :profile="store.self"
          own
          :owner-handle="handlesEnabled() ? myHandle?.handle : undefined"
          :owner-handle-confirming="handleConfirming"
          :show-claim-handle="handlesEnabled() && !myHandle"
          @edit="router.push(`/edit/${store.self!.id}`)"
          @claim-handle="claimOpen = true"
        />

        <section v-if="qrLink" class="profile-qr card">
          <QrCode :text="qrLink" :size="160" />
          <p class="qr-hint">
            <template v-if="shareUrl && publishState === 'publishing'">
              Publishing Website, GitHub, and bio to your public page…
            </template>
            <template v-else-if="shareUrl && hasPublishedContent">
              Anyone can scan or open your public page to pay you.
            </template>
            <template v-else-if="shareUrl && publishState === 'needs-pay'">
              Website, GitHub, and bio are on your profile but not on your public page yet.
              Open in Nimiq Pay to publish them.
            </template>
            <template v-else-if="shareUrl">
              Your public page only shows pay until you publish.
              Edit profile → save in Nimiq Pay.
            </template>
            <template v-else>
              Scan to pay your wallet.
            </template>
          </p>
          <button type="button" class="share-btn" @click="sharePublicPage">
            {{ shareButtonLabel }}
          </button>
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
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.header { display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 12px; }
.settings-link { font-size: 22px; text-decoration: none; color: var(--text-2); min-width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center; }
.hint { color: var(--text-2); }
.retry {
  display: block; width: 100%; height: 48px; margin-top: 16px;
  border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.retry:disabled { opacity: 0.5; }
.own-profile { display: flex; flex-direction: column; gap: 16px; }
.profile-qr {
  padding: 16px; text-align: center;
}
.qr-hint { margin: 8px 0 12px; color: var(--text-2); font-size: 13px; line-height: 1.45; }
.share-btn {
  width: 100%; min-height: 48px; padding: 0 24px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill);
  background: var(--card); color: var(--text);
  font: inherit; font-size: 15px; font-weight: 700; cursor: pointer;
}
.share-btn:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }
</style>
