<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useProfilesStore } from '../stores/profiles'
import { useInvoicesStore } from '../stores/invoices'
import ProfileRow from '../components/ProfileRow.vue'
import SearchBar from '../components/SearchBar.vue'
import EmptyState from '../components/EmptyState.vue'

const store = useProfilesStore()
const invoicesStore = useInvoicesStore()
const query = ref('')

onMounted(async () => {
  await Promise.all([store.load(), invoicesStore.load()])
})

const searching = computed(() => query.value.trim().length > 0)
const results = computed(() => store.search(query.value))
const sections = computed(() => [
  { title: 'Recent', items: store.recent },
  { title: 'Favorites', items: store.favorites },
  { title: 'All', items: store.sortedContacts },
].filter(s => s.items.length > 0))

const pendingTotal = computed(() =>
  invoicesStore.pendingTotalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }),
)

function pendingCount(address: string): number {
  return invoicesStore.pendingByAddress(address).length
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Contacts</h1>
      <SearchBar v-model="query" />
    </header>

    <section v-if="store.contacts.length > 0 || invoicesStore.pending.length > 0" class="status-strip">
      <router-link to="/activity" class="status-tile primary-tile">
        <span class="status-value">{{ invoicesStore.pending.length }}</span>
        <span class="status-label">Open</span>
      </router-link>
      <router-link to="/activity" class="status-tile">
        <span class="status-value">{{ pendingTotal }}</span>
        <span class="status-label">NIM pending</span>
      </router-link>
      <div class="status-tile">
        <span class="status-value">{{ store.recent.length }}</span>
        <span class="status-label">Recent</span>
      </div>
    </section>

    <template v-if="store.contacts.length === 0">
      <EmptyState
        icon="👥"
        title="No contacts yet"
        hint="Start with a wallet address, QR scan, backup import, or sample data."
      >
        <router-link to="/add" class="empty-action primary-action">Add contact</router-link>
        <router-link to="/settings" class="empty-action">Import or samples</router-link>
        <router-link to="/me" class="empty-action">Share profile</router-link>
      </EmptyState>
    </template>

    <template v-else-if="searching">
      <div class="card list">
        <ProfileRow v-for="p in results" :key="p.id" :profile="p" :pending-count="pendingCount(p.address)" />
      </div>
      <EmptyState v-if="results.length === 0" icon="🔍" title="No matches" />
    </template>

    <template v-else>
      <section v-for="section in sections" :key="section.title" class="section">
        <h2 class="section-title">{{ section.title }}</h2>
        <div class="card list">
          <ProfileRow v-for="p in section.items" :key="p.id" :profile="p" :pending-count="pendingCount(p.address)" />
        </div>
      </section>
    </template>

    <router-link to="/add" class="fab" aria-label="Add contact">＋</router-link>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 88px; }
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 12px; }
.status-strip {
  display: grid;
  grid-template-columns: 1fr 1.25fr 1fr;
  gap: 8px;
  margin: 14px 0 18px;
}
.status-tile {
  min-width: 0;
  min-height: 68px;
  padding: 10px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--text);
  text-decoration: none;
  box-shadow: var(--shadow);
}
.primary-tile {
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-white);
}
.primary-tile .status-label { color: rgba(255, 255, 255, 0.72); }
.status-value {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
}
.status-label {
  display: block;
  margin-top: 5px;
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.section { margin-top: 20px; }
.section-title {
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.107em;
  color: var(--text-2);
  margin: 0 0 8px 4px;
}
.list { overflow: hidden; padding: 4px 0; }
.fab {
  position: fixed;
  right: max(16px, calc(50% - 264px));
  bottom: calc(var(--nav-h) + env(safe-area-inset-bottom) + 16px);
  width: 56px;
  height: 56px;
  border-radius: var(--nimiq-radius-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: var(--nimiq-white);
  text-decoration: none;
  background: var(--nimiq-gold-bg);
  box-shadow: var(--nimiq-shadow);
}
.empty-action {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--nq-light-blue);
  background: var(--card);
  text-decoration: none;
  font-weight: 800;
  font-size: 13px;
}
.primary-action {
  border: none;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
</style>
