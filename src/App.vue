<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { bootstrapWallet } from './services/wallet-bootstrap'
import { useProfilesStore } from './stores/profiles'
import type { ParsedPaymentRequest } from './services/links'
import QuickSendSheet from './components/QuickSendSheet.vue'
import ScanSheet from './components/ScanSheet.vue'
import SplitBillSheet from './components/SplitBillSheet.vue'
import RestoreBackupSheet from './components/RestoreBackupSheet.vue'

const scanOpen = ref(false)
const sendOpen = ref(false)
const splitOpen = ref(false)
const restoreOpen = ref(false)
const pendingPayment = ref<ParsedPaymentRequest | null>(null)

onMounted(async () => {
  await bootstrapWallet()
  const store = useProfilesStore()
  await store.load()
  if (
    store.profiles.length === 0
    && !globalThis.localStorage?.getItem('nimconnect:skipped-restore')
  ) {
    restoreOpen.value = true
  }
})

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
  <div class="app">
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
        <span class="nav-icon">🧾</span><span>Activity</span>
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
.app {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding-bottom: calc(var(--nav-h) + env(safe-area-inset-bottom));
  overflow-x: hidden;
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
.nav-icon { font-size: 20px; line-height: 1; }
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
  border-radius: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: #fff;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
  box-shadow: 0 4px 14px rgba(233, 178, 19, 0.45);
}
.page-enter-active, .page-leave-active { transition: opacity 0.15s ease; }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
