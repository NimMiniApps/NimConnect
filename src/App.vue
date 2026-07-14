<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { insideNimiqPay, walletStatus, detectHostApp } from './services/nimiq'
import { bootstrapWallet } from './services/wallet-bootstrap'
import { useProfilesStore } from './stores/profiles'
import { useInboxStore } from './stores/inbox'
import { useVisiblePolling } from './composables/useVisiblePolling'
import { parsePaymentRequest, type ParsedPaymentRequest } from './services/links'
import { enableBrowserMode, hasBrowserModeOptIn, NIMPAY_OPEN_URL } from './config/host-app'
import OpenInNimiqPayLanding from './components/OpenInNimiqPayLanding.vue'
import PublicPayLanding from './components/PublicPayLanding.vue'
import PublicProfileLanding from './components/PublicProfileLanding.vue'
import { parsePublicAddRoute } from './services/profile-share'
import { isDesktopBrowser } from './utils/device'
import QuickSendSheet from './components/QuickSendSheet.vue'
import ScanSheet from './components/ScanSheet.vue'
import SplitBillSheet from './components/SplitBillSheet.vue'
import RestoreBackupSheet from './components/RestoreBackupSheet.vue'
import OnboardingSheet from './components/OnboardingSheet.vue'
import BackupOnboardingSheet from './components/BackupOnboardingSheet.vue'
import { needsOnboarding, needsBackupOnboarding } from './services/onboarding'
import { afterRestore } from './services/restore'

const router = useRouter()
const scanOpen = ref(false)
const sendOpen = ref(false)
const splitOpen = ref(false)
const restoreOpen = ref(false)
const onboardingOpen = ref(false)
const backupOnboardingOpen = ref(false)
const restoreOffered = ref(false)
const dataVersion = ref(0)
const pendingPayment = ref<ParsedPaymentRequest | null>(null)
const desktopBrowser = ref(typeof window !== 'undefined' && isDesktopBrowser())
const browserMode = ref(false)
const allowBrowserContinue = computed(() => !desktopBrowser.value)
// Parseable /pay payload while outside Nimiq Pay → public request page.
const publicPayRequest = computed<ParsedPaymentRequest | null>(() => {
  if (router.currentRoute.value.path !== '/pay') return null
  const raw = router.currentRoute.value.query.r
  return typeof raw === 'string'
    ? parsePaymentRequest(decodeURIComponent(raw))
    : parsePaymentRequest(window.location.href)
})
// Shared profile on /add while outside Nimiq Pay → public profile page.
const publicSharedProfile = computed(() => {
  if (router.currentRoute.value.path !== '/add') return null
  return parsePublicAddRoute(router.currentRoute.value.query as Record<string, unknown>)
})
// Public profile pages render for everyone — no install wall.
const publicProfileRoute = computed(() => router.currentRoute.value.path.startsWith('/u/'))
const inboxStore = useInboxStore()
const profilesStore = useProfilesStore()
inboxStore.load()
useVisiblePolling(() => inboxStore.refresh(), 45_000)

function anyFirstRunSheetOpen() {
  return restoreOpen.value || onboardingOpen.value || backupOnboardingOpen.value
}

function maybeShowOnboarding() {
  if (needsOnboarding(profilesStore.self)) {
    onboardingOpen.value = true
  } else {
    maybeShowBackupOnboarding()
  }
}

function maybeShowBackupOnboarding() {
  if (needsBackupOnboarding()) backupOnboardingOpen.value = true
}

function tryFirstRunPrompts() {
  if (anyFirstRunSheetOpen()) return
  if (
    !restoreOffered.value
    && profilesStore.contacts.length === 0
    && !globalThis.localStorage?.getItem('nimconnect:skipped-restore')
  ) {
    restoreOpen.value = true
    restoreOffered.value = true
    return
  }
  maybeShowOnboarding()
}

async function initApp() {
  await bootstrapWallet()
  await profilesStore.load()
  if (profilesStore.self) inboxStore.selfAddress = profilesStore.self.address
  tryFirstRunPrompts()
}

function onOnboardingFinished() {
  onboardingOpen.value = false
  maybeShowBackupOnboarding()
}

function onBackupOnboardingComplete() {
  backupOnboardingOpen.value = false
}

async function onBackupRestored() {
  backupOnboardingOpen.value = false
  await afterRestore()
  if (router.currentRoute.value.path === '/') {
    dataVersion.value++
  }
}

async function continueFirstRun() {
  await bootstrapWallet()
  await profilesStore.load()
  if (profilesStore.self) inboxStore.selfAddress = profilesStore.self.address
  await nextTick()
  maybeShowOnboarding()
}

function onRestoreSkipped() {
  restoreOpen.value = false
  void continueFirstRun()
}

async function onRestoreComplete() {
  restoreOpen.value = false
  await afterRestore()
  if (router.currentRoute.value.path === '/') {
    dataVersion.value++
  }
}

onMounted(async () => {
  desktopBrowser.value = isDesktopBrowser()
  const inside = await detectHostApp()
  if (inside) {
    browserMode.value = true
    await initApp()
  } else if (!desktopBrowser.value && hasBrowserModeOptIn()) {
    browserMode.value = true
    await initApp()
  }
})

watch(browserMode, enabled => {
  if (enabled) void initApp()
})

watch(() => profilesStore.self, () => {
  if (profilesStore.self) inboxStore.selfAddress = profilesStore.self.address
  tryFirstRunPrompts()
})

watch(insideNimiqPay, (inside, wasInside) => {
  if (inside && !wasInside && browserMode.value) void initApp()
})

watch(walletStatus, status => {
  if (status === 'ready') tryFirstRunPrompts()
})

watch(
  () => router.currentRoute.value.fullPath,
  () => { void handleIncomingPaymentLink() },
)

watch([browserMode, insideNimiqPay], () => {
  void handleIncomingPaymentLink()
})

function onContinueInBrowser() {
  if (desktopBrowser.value) return
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

async function handleIncomingPaymentLink() {
  if (router.currentRoute.value.path !== '/pay') return
  if (!browserMode.value && !insideNimiqPay.value) return

  const raw = router.currentRoute.value.query.r
  const parsed = typeof raw === 'string'
    ? parsePaymentRequest(decodeURIComponent(raw))
    : parsePaymentRequest(window.location.href)

  await router.replace('/')
  if (!parsed) return

  pendingPayment.value = parsed
  sendOpen.value = true
}
</script>

<template>
  <PublicPayLanding
    v-if="!insideNimiqPay && !browserMode && publicPayRequest"
    :payment="publicPayRequest"
    :allow-browser-continue="allowBrowserContinue"
    @continue="onContinueInBrowser"
  />
  <PublicProfileLanding
    v-else-if="!insideNimiqPay && !browserMode && publicSharedProfile"
    :profile="publicSharedProfile"
    :allow-browser-continue="allowBrowserContinue"
    @continue="onContinueInBrowser"
  />
  <router-view v-else-if="!insideNimiqPay && !browserMode && publicProfileRoute" />
  <OpenInNimiqPayLanding
    v-else-if="!insideNimiqPay && !browserMode"
    :allow-browser-continue="allowBrowserContinue"
    @continue="onContinueInBrowser"
  />

  <div v-else class="app">
    <p v-if="!insideNimiqPay" class="host-banner" role="status">
      Limited browser mode — wallet features need
      <a :href="NIMPAY_OPEN_URL" class="banner-link">Nimiq Pay</a>.
    </p>

    <router-view v-slot="{ Component }">
      <transition name="page" mode="out-in">
        <component :is="Component" :key="`${$route.path}-${dataVersion}`" />
      </transition>
    </router-view>

    <nav class="bottom-nav">
      <router-link to="/" class="nav-item" :class="{ active: $route.path === '/' }">
        <span class="nav-icon">🏠<span v-if="inboxStore.badgeCount" class="nav-badge">{{ inboxStore.badgeCount }}</span></span><span>Home</span>
      </router-link>
      <router-link to="/contacts" class="nav-item" :class="{ active: $route.path === '/contacts' }">
        <span class="nav-icon">👥</span><span>Contacts</span>
      </router-link>
      <button type="button" class="nav-item nav-scan" aria-label="Scan QR code" @click="scanOpen = true">
        <span class="scan-icon">▣</span><span>Scan</span>
      </button>
      <button type="button" class="nav-item nav-button" @click="splitOpen = true">
        <span class="nav-icon">🍕</span><span>Split</span>
      </button>
      <router-link to="/insights" class="nav-item" :class="{ active: $route.path === '/insights' }">
        <span class="nav-icon">📊</span><span>Insights</span>
      </router-link>
      <router-link to="/me" class="nav-item" :class="{ active: $route.path === '/me' || $route.path === '/settings' }">
        <span class="nav-icon">🪪</span><span>Profile</span>
      </router-link>
    </nav>

    <ScanSheet :open="scanOpen" @close="scanOpen = false" @pay="onScanPay" />
    <QuickSendSheet :open="sendOpen" :initial-payment="pendingPayment" @close="onSendClose" />
    <SplitBillSheet :open="splitOpen" @close="splitOpen = false" />
    <RestoreBackupSheet :open="restoreOpen" @skipped="onRestoreSkipped" @restored="onRestoreComplete" />
    <OnboardingSheet :open="onboardingOpen" @close="onOnboardingFinished" @complete="onOnboardingFinished" />
    <BackupOnboardingSheet
      :open="backupOnboardingOpen"
      @close="backupOnboardingOpen = false"
      @complete="onBackupOnboardingComplete"
      @restored="onBackupRestored"
    />
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
