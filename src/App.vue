<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { insideNimiqPay, walletStatus, detectHostApp } from './services/nimiq'
import { bootstrapWallet, reconcileWalletSession } from './services/wallet-bootstrap'
import { useProfilesStore } from './stores/profiles'
import { useInboxStore } from './stores/inbox'
import { useVisiblePolling } from './composables/useVisiblePolling'
import { makeNimiqPayAddLink, parsePaymentRequest, type ParsedPaymentRequest } from './services/links'
import { enableBrowserMode, hasBrowserModeOptIn, NIMPAY_OPEN_URL } from './config/host-app'
import OpenInNimiqPayLanding from './components/OpenInNimiqPayLanding.vue'
import PublicPayLanding from './components/PublicPayLanding.vue'
import PublicProfileLanding from './components/PublicProfileLanding.vue'
import { parsePublicAddRoute } from './services/profile-share'
import { isDesktopBrowser } from './utils/device'
import { isDesktopPortalPath } from './config/desktop-portal'
import DesktopShell from './components/desktop/DesktopShell.vue'
import QuickSendSheet from './components/QuickSendSheet.vue'
import ScanSheet from './components/ScanSheet.vue'
import SplitBillSheet from './components/SplitBillSheet.vue'
import RestoreBackupSheet from './components/RestoreBackupSheet.vue'
import OnboardingWizard from './components/OnboardingWizard.vue'
import { onboardingWizardShown, markOnboardingWizardShown } from './services/onboarding'
import { onboardingWizardOpen } from './services/onboarding-wizard-state'
import { afterRestore } from './services/restore'

const router = useRouter()
const scanOpen = ref(false)
const sendOpen = ref(false)
const splitOpen = ref(false)
const restoreOpen = ref(false)
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
// Address-only add links are import intents, not a second public profile page.
const publicAddAddress = computed(() => {
  if (router.currentRoute.value.path !== '/add') return null
  const raw = router.currentRoute.value.query.address
  return typeof raw === 'string' ? parsePaymentRequest(decodeURIComponent(raw))?.recipient ?? null : null
})
const handoffOpenUrl = computed(() =>
  publicAddAddress.value ? makeNimiqPayAddLink(publicAddAddress.value) : NIMPAY_OPEN_URL,
)
// Public profile pages render for everyone — no install wall.
const publicProfileRoute = computed(() => router.currentRoute.value.path.startsWith('/u/'))
const routePath = computed(() => router.currentRoute.value.path)
const desktopPortalRoute = computed(() => isDesktopPortalPath(routePath.value))
const inboxStore = useInboxStore()
const profilesStore = useProfilesStore()
inboxStore.load()
useVisiblePolling(() => inboxStore.refresh(), 45_000)

function anyFirstRunSheetOpen() {
  return restoreOpen.value || onboardingWizardOpen.value
}

function maybeShowOnboardingWizard() {
  if (onboardingWizardShown()) return
  markOnboardingWizardShown()
  onboardingWizardOpen.value = true
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
  maybeShowOnboardingWizard()
}

async function initApp() {
  await bootstrapWallet()
  await profilesStore.load()
  if (profilesStore.self) inboxStore.selfAddress = profilesStore.self.address
  tryFirstRunPrompts()
}

async function continueFirstRun() {
  await bootstrapWallet()
  await profilesStore.load()
  if (profilesStore.self) inboxStore.selfAddress = profilesStore.self.address
  await nextTick()
  maybeShowOnboardingWizard()
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

async function onWalletAccountChange() {
  const switched = await reconcileWalletSession()
  if (!switched) return
  await profilesStore.load()
  if (profilesStore.self) inboxStore.selfAddress = profilesStore.self.address
  await inboxStore.refresh(profilesStore.self?.address)
  dataVersion.value++
}

function onWalletVisibility() {
  if (document.visibilityState !== 'visible' || !insideNimiqPay.value) return
  void onWalletAccountChange()
}

onMounted(async () => {
  desktopBrowser.value = isDesktopBrowser()
  document.addEventListener('visibilitychange', onWalletVisibility)
  const inside = await detectHostApp()
  if (inside) {
    browserMode.value = true
    await initApp()
  } else if (!desktopBrowser.value && hasBrowserModeOptIn()) {
    browserMode.value = true
    await initApp()
  }
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onWalletVisibility)
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

watch(routePath, path => {
  if (
    desktopBrowser.value
    && !insideNimiqPay.value
    && !browserMode.value
    && !isDesktopPortalPath(path)
    && path !== '/pay'
    && path !== '/add'
  ) {
    void router.replace('/')
  }
}, { immediate: true })

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
  <DesktopShell
    v-else-if="desktopBrowser && !insideNimiqPay && !browserMode && desktopPortalRoute"
  />
  <OpenInNimiqPayLanding
    v-else-if="!insideNimiqPay && !browserMode"
    :allow-browser-continue="allowBrowserContinue"
    :open-url="handoffOpenUrl"
    @continue="onContinueInBrowser"
  />

  <div v-else class="app">
    <div class="app-main">
      <p v-if="!insideNimiqPay" class="host-banner" role="status">
        Limited browser mode — wallet features need
        <a :href="NIMPAY_OPEN_URL" class="banner-link">Nimiq Pay</a>.
      </p>

      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" :key="`${$route.path}-${dataVersion}`" />
        </transition>
      </router-view>
    </div>

    <nav class="bottom-nav">
      <div class="bottom-nav__row">
        <router-link to="/" class="nav-item" :class="{ active: $route.path === '/' }">
          <span class="nav-icon">🏠<span v-if="inboxStore.badgeCount" class="nav-badge">{{ inboxStore.badgeCount }}</span></span><span>Home</span>
        </router-link>
        <router-link to="/contacts" class="nav-item" :class="{ active: $route.path === '/contacts' }">
          <span class="nav-icon">👥</span><span>Contacts</span>
        </router-link>
        <router-link to="/friends" class="nav-item" :class="{ active: $route.path === '/friends' }">
          <span class="nav-icon">🤝</span><span>Friends</span>
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
      </div>
    </nav>

    <ScanSheet :open="scanOpen" @close="scanOpen = false" @pay="onScanPay" />
    <QuickSendSheet :open="sendOpen" :initial-payment="pendingPayment" @close="onSendClose" />
    <SplitBillSheet :open="splitOpen" @close="splitOpen = false" />
    <RestoreBackupSheet :open="restoreOpen" @skipped="onRestoreSkipped" @restored="onRestoreComplete" />
    <OnboardingWizard :open="onboardingWizardOpen" @close="onboardingWizardOpen = false" />
  </div>
</template>

<style scoped>
.app {
  max-width: 560px;
  margin: 0 auto;
  /*
   * Flex shell pinned to the *visible* WebView height (--app-height from
   * visualViewport/innerHeight). CSS svh/dvh is often taller than the
   * in-app browser viewport, which clips the bottom nav under the home bar.
   */
  height: var(--app-height, 100svh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /*
   * Real iPhone inset is ~34px; shave 8px so labels sit closer to the
   * home indicator without covering it. Floor 12px when WKWebView reports 0.
   */
  --nav-safe-bottom: max(12px, env(safe-area-inset-bottom, 0px) - 8px);
  --bottom-chrome-h: calc(var(--nav-h) + var(--nav-safe-bottom));
}
.app-main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: clip;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  /* Room for the raised Scan control that overhangs into the scroll area */
  padding-bottom: 12px;
}
/* Router transition wrapper — stretch so pages can pin footers above the nav */
.app-main :deep(> *) {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 100%;
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
  flex: 0 0 auto;
  position: relative;
  width: 100%;
  /* Height = icon row + safe padding (no fixed height — avoids border-box shrink) */
  padding-bottom: var(--nav-safe-bottom);
  background: var(--card);
  border-top: 1px solid var(--border);
  box-shadow: 0 -4px 28px rgba(0, 0, 0, 0.08);
  z-index: 40;
}
.bottom-nav__row {
  height: var(--nav-h);
  display: flex;
  align-items: stretch;
}
.nav-item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-2);
  text-decoration: none;
  min-height: 0;
  padding: 4px 2px 2px;
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
  width: 40px;
  height: 40px;
  margin-top: -14px;
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
