<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { bootstrapWallet } from './services/wallet-bootstrap'
import { useProfilesStore } from './stores/profiles'
import QuickSendSheet from './components/QuickSendSheet.vue'
import SplitBillSheet from './components/SplitBillSheet.vue'
import RestoreBackupSheet from './components/RestoreBackupSheet.vue'

const sendOpen = ref(false)
const splitOpen = ref(false)
const restoreOpen = ref(false)

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
      <button type="button" class="nav-item nav-button" @click="sendOpen = true">
        <span class="nav-icon">💸</span><span>Send</span>
      </button>
      <button type="button" class="nav-item nav-button" @click="splitOpen = true">
        <span class="nav-icon">🍕</span><span>Split</span>
      </button>
      <router-link to="/activity" class="nav-item nav-activity" :class="{ active: $route.path === '/activity' }">
        <span class="nav-icon">🧾</span><span>Activity</span>
      </router-link>
      <router-link to="/me" class="nav-item" :class="{ active: $route.path === '/me' }">
        <span class="nav-icon">🪪</span><span>Profile</span>
      </router-link>
    </nav>

    <QuickSendSheet :open="sendOpen" @close="sendOpen = false" />
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
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.page-enter-active, .page-leave-active { transition: opacity 0.15s ease; }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
