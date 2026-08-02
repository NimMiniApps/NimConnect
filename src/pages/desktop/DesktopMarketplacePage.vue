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
  return (luna / 100000).toLocaleString(undefined, { maximumFractionDigits: 5 })
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
      <RouterLink to="/marketplace/sell" class="nq-button desktop-marketplace__sell-cta">Sell your @handle</RouterLink>
    </header>
    <p class="desktop-marketplace__subtext">
      Buy and sell @handles peer-to-peer. Payment sits in escrow and only releases once the
      handle's ownership has transferred on-chain.
    </p>

    <input
      type="search"
      v-model="filter"
      placeholder="Filter by handle…"
      class="desktop-marketplace__filter"
    />

    <div v-if="loading" class="desktop-marketplace__list" aria-busy="true" aria-label="Loading listings">
      <div v-for="n in 4" :key="n" class="skeleton-row desktop-marketplace__row">
        <div class="skeleton-stack">
          <div class="skeleton skeleton-line short" />
        </div>
        <div class="skeleton skeleton-line" style="width: 4.5rem; height: 20px; margin: 0;" />
      </div>
    </div>
    <div v-else-if="error" class="desktop-marketplace__error" role="alert">
      <span class="desktop-marketplace__error-icon" aria-hidden="true">!</span>
      <div>
        <p class="desktop-marketplace__error-title">Couldn't load listings</p>
        <p class="desktop-marketplace__error-detail">{{ error }}</p>
      </div>
      <button type="button" class="nq-button" data-retry @click="load">Retry</button>
    </div>
    <ul v-else-if="visible.length" class="desktop-marketplace__list">
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
    </ul>
    <div v-else class="desktop-marketplace__empty">
      <p v-if="filter.trim()">No handles match "{{ filter.trim() }}".</p>
      <template v-else>
        <p>No listings yet.</p>
        <RouterLink to="/marketplace/sell" class="nq-button">Be the first to sell a handle</RouterLink>
      </template>
    </div>
  </section>
</template>

<style scoped>
.desktop-marketplace { max-width: 720px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace__header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.desktop-marketplace__header h1 { flex: 1; font-size: 20px; margin: 0; }
.desktop-marketplace__sell-cta { min-height: 40px; padding: 0 18px; font-size: 14px; }
.desktop-marketplace__subtext { margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: var(--text-2); }
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
.desktop-marketplace__error {
  display: flex; align-items: center; gap: 12px; padding: 16px;
  border: 1px solid color-mix(in srgb, var(--nq-red) 35%, var(--border));
  border-radius: var(--nimiq-radius-card);
  background: color-mix(in srgb, var(--nq-red) 8%, var(--card));
}
.desktop-marketplace__error-icon {
  display: flex; align-items: center; justify-content: center; flex: 0 0 auto;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--nq-red); color: var(--nimiq-white); font-weight: 800;
}
.desktop-marketplace__error-title { margin: 0; font-weight: 700; color: var(--text); }
.desktop-marketplace__error-detail { margin: 2px 0 0; font-size: 13px; color: var(--text-2); }
.desktop-marketplace__error .nq-button { margin-left: auto; flex: 0 0 auto; }
.desktop-marketplace__empty {
  display: flex; flex-direction: column; align-items: center; gap: 16px;
  padding: 40px 12px; text-align: center; color: var(--text-2);
  border: 1px dashed var(--border); border-radius: var(--nimiq-radius-card);
}
</style>
