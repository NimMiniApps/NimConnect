<script setup lang="ts">
import { NIMPAY_APP_STORE_URL, NIMPAY_PLAY_STORE_URL } from '../config/host-app'

defineProps<{ detailed?: boolean }>()
</script>

<template>
  <div class="public-store-links" :class="{ 'public-store-links--detailed': detailed }">
    <p>Don't have Nimiq Pay yet?</p>
    <div v-if="detailed" class="public-store-links__detailed-links">
      <a :href="NIMPAY_PLAY_STORE_URL" target="_blank" rel="noopener noreferrer">
        <span class="public-store-links__store-icon" aria-hidden="true">▶</span>
        <span class="public-store-links__store-text"><small>Get it on</small> Google Play</span>
      </a>
      <a :href="NIMPAY_APP_STORE_URL" target="_blank" rel="noopener noreferrer">
        <span class="public-store-links__store-icon public-store-links__store-icon--apple" aria-hidden="true"></span>
        <span class="public-store-links__store-text"><small>Download on the</small> App Store</span>
      </a>
    </div>
    <div v-else>
      <a :href="NIMPAY_PLAY_STORE_URL" target="_blank" rel="noopener noreferrer">Google Play</a>
      <a :href="NIMPAY_APP_STORE_URL" target="_blank" rel="noopener noreferrer">App Store</a>
    </div>
  </div>
</template>

<style scoped>
.public-store-links { display: grid; gap: 0.5rem; justify-items: center; }
.public-store-links p { color: var(--text-2); font-size: 0.8125rem; font-weight: 700; margin: 0; }
.public-store-links > div { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.public-store-links a { border: 1px solid #bdc9e5; border-radius: 0.75rem; color: var(--text); font-size: 0.8125rem; font-weight: 800; padding: 0.625rem 0.75rem; text-decoration: none; }

.public-store-links__detailed-links a {
  align-items: center;
  display: flex;
  flex: 1;
  gap: 0.75rem;
  min-height: 3.25rem;
  text-align: left;
}

.public-store-links__store-icon {
  font-size: 1.375rem;
  line-height: 1;
  text-align: center;
  width: 1.75rem;
}

.public-store-links__store-icon--apple::before {
  background: currentColor;
  content: '';
  display: block;
  height: 1.375rem;
  margin: 0 auto;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z'/%3E%3C/svg%3E") center / contain no-repeat;
  width: 1.375rem;
}

.public-store-links__store-text { display: grid; font-size: 1rem; line-height: 1.2; }
.public-store-links__store-text small { color: var(--text-2); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }

@media (min-width: 25rem) {
  .public-store-links__detailed-links { flex-wrap: nowrap; }
}
</style>
