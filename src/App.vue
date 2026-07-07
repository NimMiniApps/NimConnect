<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { bootstrapWallet } from './services/wallet-bootstrap'
import SplitBillSheet from './components/SplitBillSheet.vue'

const splitOpen = ref(false)

onMounted(async () => {
  await bootstrapWallet()
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
      <button type="button" class="nav-item nav-split" @click="splitOpen = true">
        <span class="nav-split-icon">🍕</span><span>Split</span>
      </button>
      <router-link to="/me" class="nav-item" :class="{ active: $route.path === '/me' }">
        <span class="nav-icon">🪪</span><span>Profile</span>
      </router-link>
    </nav>

    <SplitBillSheet :open="splitOpen" @close="splitOpen = false" />
  </div>
</template>

<style scoped>
.app {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding-bottom: calc(var(--nav-h) + env(safe-area-inset-bottom));
}
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 560px;
  height: calc(var(--nav-h) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  display: flex;
  background: var(--card);
  border-top: 1px solid var(--border);
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  text-decoration: none;
  min-height: 44px;
}
.nav-item.active { color: var(--nq-gold-dark); }
.nav-icon { font-size: 20px; line-height: 1; }
.nav-split { background: none; border: none; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.nav-split-icon {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; margin-top: -14px; border-radius: 18px;
  font-size: 18px; line-height: 1;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
  box-shadow: 0 3px 10px rgba(233, 178, 19, 0.4);
}
.page-enter-active, .page-leave-active { transition: opacity 0.15s ease; }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
