<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { walletStatus } from '../services/nimiq'
import { bootstrapWallet, retryWalletBootstrap } from '../services/wallet-bootstrap'
import ProfileView from '../components/ProfileView.vue'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()
const store = useProfilesStore()
const ready = ref(false)
const retrying = ref(false)

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
})

async function retry() {
  retrying.value = true
  try {
    await retryWalletBootstrap()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Profile</h1>
      <router-link to="/settings" class="settings-link" aria-label="Settings">⚙</router-link>
    </header>

    <p v-if="!ready || retrying" class="hint">{{ statusHint }}</p>

    <ProfileView
      v-else-if="store.self"
      :profile="store.self"
      own
      @edit="router.push(`/edit/${store.self!.id}`)"
    />

    <template v-else>
      <EmptyState
        icon="🪪"
        title="No wallet connected"
        hint="Tap Connect below when Nimiq Pay asks for wallet access."
      />
      <button type="button" class="retry" :disabled="retrying" @click="retry">
        Connect wallet
      </button>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.header { display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 28px; margin: 8px 0 12px; }
.settings-link { font-size: 22px; text-decoration: none; color: var(--text-2); min-width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center; }
.hint { color: var(--text-2); }
.retry {
  display: block; width: 100%; height: 48px; margin-top: 16px;
  border: none; border-radius: 24px; cursor: pointer;
  font-weight: 700; font-size: 16px; color: #fff;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
}
.retry:disabled { opacity: 0.5; }
</style>
