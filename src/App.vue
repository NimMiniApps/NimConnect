<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { insideNimiqPay, hostAppReady, detectHostApp } from './services/nimiq'
import { bootstrapWallet } from './services/wallet-bootstrap'
import { useProfilesStore } from './stores/profiles'
import { useInboxStore } from './stores/inbox'
import type { ParsedPaymentRequest } from './services/links'
import { enableBrowserMode, hasBrowserModeOptIn, NIMPAY_OPEN_URL } from './config/host-app'
import OpenInNimiqPayLanding from './components/OpenInNimiqPayLanding.vue'
import QuickSendSheet from './components/QuickSendSheet.vue'
import ScanSheet from './components/ScanSheet.vue'
import SplitBillSheet from './components/SplitBillSheet.vue'
import RestoreBackupSheet from './components/RestoreBackupSheet.vue'

const scanOpen = ref(false)
const sendOpen = ref(false)
const splitOpen = ref(false)
const restoreOpen = ref(false)
const pendingPayment = ref<ParsedPaymentRequest | null>(null)
const browserMode = ref(hasBrowserModeOptIn())
const inboxStore = useInboxStore()
inboxStore.load()

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') inboxStore.refresh()
  })
}

async function initApp() {
  await bootstrapWallet()
  const store = useProfilesStore()
  await store.load()
  if (store.self) inboxStore.selfAddress = store.self.address
  if (
    store.profiles.length === 0
    && !globalThis.localStorage?.getItem('nimconnect:skipped-restore')
  ) {
    restoreOpen.value = true
  }
}

onMounted(async () => {
  const inside = await detectHostApp()
  if (inside || browserMode.value) {
    browserMode.value = true
    await initApp()
  }
})

watch(browserMode, enabled => {
  if (enabled) void initApp()
})

function onContinueInBrowser() {
  enableBrowserMode()
  browserMode.value = true
}

function onScanPay(request: ParsedPaymentRequest) {
  pendingPayment.value = request
  scanOpen.value = false
  sendOpen.value = true
}

function onSendClose() {
  sendOpen.value = false
  pendingPayment.value = null
}
</script>

<template>
  <div v-if="!hostAppReady" class="boot" aria-busy="true" aria-label="Loading NimConnect" />

  <OpenInNimiqPayLanding
    v-else-if="!insideNimiqPay && !browserMode"
    @continue="onContinueInBrowser"
  />

  <div v-else class="app">
    <p v-if="!insideNimiqPay" class="host-banner" role="status">
      Limited browser mode — wallet features need
      <a :href="NIMPAY_OPEN_URL" class="banner-link">Nimiq Pay</a>.
    </p>

    <router-view v-slot="{ Component }">
      <transition name="page" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>

    <nav class="bottom-nav">
      <router-link to="/" class="nav-item" :class="{ active: $route.path === '/' }">
        <span class="nav-icon">👥</span><span>Contacts</span>
      </router-link>
      <router-link to="/activity" class="nav-item" :class="{ active: $route.path === '/activity' }">
        <span class="nav-icon">🧾<span v-if="inboxStore.badgeCount" class="nav-badge">{{ inboxStore.badgeCount }}</span></span><span>Activity</span>
      </router-link>
      <button type="button" class="nav-item nav-scan" aria-label="Scan QR code" @click="scanOpen = true">
        <span class="scan-icon">▣</span><span>Scan</span>
      </button>
      <button type="button" class="nav-item nav-button" @click="splitOpen = true">
        <span class="nav-icon">🍕</span><span>Split</span>
      </button>
      <router-link to="/me" class="nav-item" :class="{ active: $route.path === '/me' || $route.path === '/settings' }">
        <span class="nav-icon">🪪</span><span>Profile</span>
      </router-link>
    </nav>

    <ScanSheet :open="scanOpen" @close="scanOpen = false" @pay="onScanPay" />
    <QuickSendSheet :open="sendOpen" :initial-payment="pendingPayment" @close="onSendClose" />
    <SplitBillSheet :open="splitOpen" @close="splitOpen = false" />
    <RestoreBackupSheet :open="restoreOpen" @close="restoreOpen = false" />
  </div>
</template>

<style scoped>
.boot {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  background: var(--bg);
}
.app {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding-bottom: calc(var(--nav-h) + env(safe-area-inset-bottom));
  overflow-x: hidden;
}
.host-banner {
  margin: 0;
  padding: 10px 16px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--nimiq-blue);
  background: #fff3cd;
  border-bottom: 1px solid #e9b21355;
}
.banner-link {
  color: inherit;
  font-weight: 800;
}
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: min(100dvw, 560px);
  max-width: 560px;
  height: calc(var(--nav-h) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  display: flex;
  align-items: stretch;
  background: var(--card);
  border-top: 1px solid var(--border);
  box-shadow: 0 -4px 28px rgba(0, 0, 0, 0.08);
}
.nav-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  text-decoration: none;
  min-height: 44px;
  padding: 0 2px;
}
.nav-item.active { color: var(--nq-gold-dark); }
.nav-icon { position: relative; font-size: 20px; line-height: 1; }
.nav-badge {
  position: absolute; top: -4px; right: -10px;
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--nq-red); color: var(--nimiq-white);
  font-size: 10px; font-weight: 800; line-height: 16px; text-align: center;
}
.nav-button {
  background: none;
  border: none;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.nav-scan {
  flex: 1.1;
  background: none;
  border: none;
  font: inherit;
  cursor: pointer;
  color: var(--nq-gold-dark);
}
.scan-icon {
  width: 44px;
  height: 44px;
  margin-top: -18px;
  border-radius: var(--nimiq-radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
  box-shadow: var(--nimiq-shadow);
}
.page-enter-active, .page-leave-active { transition: opacity var(--attr-duration) var(--nimiq-ease); }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
