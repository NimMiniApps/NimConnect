<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchListings, type MarketplaceListing } from '../../services/marketplace'
import { getDesktopHubAddress } from '../../services/desktop-session'

const brandIconUrl = `${import.meta.env.BASE_URL}brand/nimconnect-icon-192x192.png`

const listings = ref<MarketplaceListing[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const filter = ref('')

function lunaToNim(luna: number): string {
  return (luna / 100000).toString()
}

function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

const ownAddress = computed(() => getDesktopHubAddress())

const visible = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return listings.value
  return listings.value.filter((l) => l.handle.startsWith(q))
})

async function load() {
  loading.value = true
  error.value = null
  try {
    listings.value = await fetchListings()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="desktop-marketplace">
    <header class="desktop-marketplace__header">
      <img :src="brandIconUrl" alt="" width="32" height="32" />
      <h1>Handle Marketplace</h1>
      <RouterLink to="/marketplace/sell" class="desktop-marketplace__sell-link">Sell your @handle</RouterLink>
    </header>

    <input
      type="search"
      v-model="filter"
      placeholder="Filter by handle…"
      class="desktop-marketplace__filter"
    />

    <p v-if="loading">Loading listings…</p>
    <div v-else-if="error" class="desktop-marketplace__error">
      <p>{{ error }}</p>
      <button type="button" data-retry @click="load">Retry</button>
    </div>
    <ul v-else class="desktop-marketplace__list">
      <li v-for="listing in visible" :key="listing.handle" class="desktop-marketplace__row">
        <span class="desktop-marketplace__handle">@{{ listing.handle }}</span>
        <span class="desktop-marketplace__price">{{ lunaToNim(listing.price_luna) }} NIM</span>
        <RouterLink
          v-if="compact(listing.seller) !== compact(ownAddress || '')"
          :to="{ path: '/marketplace/buy', query: { handle: listing.handle } }"
          :data-buy-handle="listing.handle"
          class="desktop-marketplace__buy"
        >
          Buy
        </RouterLink>
      </li>
      <li v-if="visible.length === 0" class="desktop-marketplace__empty">No listings match.</li>
    </ul>
  </section>
</template>

<style scoped>
.desktop-marketplace { max-width: 720px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace__header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.desktop-marketplace__header h1 { flex: 1; font-size: 20px; margin: 0; }
.desktop-marketplace__filter {
  width: 100%; height: 40px; padding: 0 12px; margin-bottom: 16px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); font: inherit; color: var(--text);
}
.desktop-marketplace__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.desktop-marketplace__row {
  display: flex; align-items: center; gap: 12px; padding: 12px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
}
.desktop-marketplace__handle { flex: 1; font-weight: 700; }
.desktop-marketplace__buy {
  padding: 6px 14px; border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-gold-bg); color: var(--nimiq-white); font-weight: 700; text-decoration: none;
}
.desktop-marketplace__error { color: var(--nq-red); }
.desktop-marketplace__empty { color: var(--text-2); padding: 12px; }
</style>
