<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { getMyAddress } from '../services/nimiq'
import ProfileView from '../components/ProfileView.vue'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()
const store = useProfilesStore()
const checking = ref(true)

onMounted(async () => {
  await store.load()
  if (!store.self) {
    const address = await getMyAddress()
    if (address) await store.ensureSelf(address)
  }
  checking.value = false
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Profile</h1>
      <router-link to="/settings" class="settings-link" aria-label="Settings">⚙</router-link>
    </header>

    <p v-if="checking" class="hint">Connecting…</p>

    <ProfileView
      v-else-if="store.self"
      :profile="store.self"
      own
      @edit="router.push(`/edit/${store.self!.id}`)"
    />

    <EmptyState
      v-else
      icon="🪪"
      title="No wallet connected"
      hint="Open NimConnect inside Nimiq Pay to create your profile."
    />
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.header { display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 28px; margin: 8px 0 12px; }
.settings-link { font-size: 22px; text-decoration: none; color: var(--text-2); min-width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center; }
.hint { color: var(--text-2); }
</style>
