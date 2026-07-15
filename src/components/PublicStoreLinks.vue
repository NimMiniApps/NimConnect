<script setup lang="ts">
import { NIMPAY_APP_STORE_URL, NIMPAY_PLAY_STORE_URL } from '../config/host-app'
</script>

<template>
  <div class="public-store-links">
    <p>Don't have Nimiq Pay yet?</p>
    <div>
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
</style>
