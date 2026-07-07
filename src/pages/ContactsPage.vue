<script setup lang="ts">
import { ref, computed } from 'vue'
import { useProfilesStore } from '../stores/profiles'
import ProfileRow from '../components/ProfileRow.vue'
import SearchBar from '../components/SearchBar.vue'
import EmptyState from '../components/EmptyState.vue'
import { loadSampleContacts } from '../services/samples'

const store = useProfilesStore()
const query = ref('')
const seeding = ref(false)

async function seedSamples() {
  seeding.value = true
  try {
    await loadSampleContacts()
  } finally {
    seeding.value = false
  }
}

const searching = computed(() => query.value.trim().length > 0)
const results = computed(() => store.search(query.value))
const sections = computed(() => [
  { title: 'Recent', items: store.recent },
  { title: 'Favorites', items: store.favorites },
  { title: 'All', items: store.sortedContacts },
].filter(s => s.items.length > 0))
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Contacts</h1>
      <SearchBar v-model="query" />
    </header>

    <template v-if="store.contacts.length === 0">
      <EmptyState
        icon="👥"
        title="No contacts yet"
        hint="Add your first contact to turn addresses into people."
      />
      <button class="seed" :disabled="seeding" @click="seedSamples">
        {{ seeding ? 'Adding…' : 'Try it with sample contacts' }}
      </button>
    </template>

    <template v-else-if="searching">
      <div class="card list">
        <ProfileRow v-for="p in results" :key="p.id" :profile="p" />
      </div>
      <EmptyState v-if="results.length === 0" icon="🔍" title="No matches" />
    </template>

    <template v-else>
      <section v-for="section in sections" :key="section.title" class="section">
        <h2 class="section-title">{{ section.title }}</h2>
        <div class="card list">
          <ProfileRow v-for="p in section.items" :key="p.id" :profile="p" />
        </div>
      </section>
    </template>

    <router-link to="/add" class="fab" aria-label="Add contact">＋</router-link>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 88px; }
.header h1 { font-size: 28px; margin: 8px 0 12px; }
.section { margin-top: 20px; }
.section-title {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-2);
  margin: 0 0 8px 4px;
}
.list { overflow: hidden; padding: 4px 0; }
.seed {
  display: block;
  margin: 0 auto;
  min-height: 44px;
  padding: 0 20px;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: var(--card);
  color: var(--nq-light-blue);
  font-weight: 700;
  cursor: pointer;
}
.seed:disabled { opacity: 0.5; }
.fab {
  position: fixed;
  right: max(16px, calc(50% - 264px));
  bottom: calc(var(--nav-h) + env(safe-area-inset-bottom) + 16px);
  width: 56px;
  height: 56px;
  border-radius: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: #fff;
  text-decoration: none;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
  box-shadow: 0 4px 16px rgba(233, 178, 19, 0.4);
}
</style>
