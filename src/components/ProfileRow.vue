<script setup lang="ts">
import type { Profile } from '../types/profile'
import { shortAddress } from '../services/links'
import Identicon from './Identicon.vue'

defineProps<{ profile: Profile }>()
</script>

<template>
  <router-link :to="`/profile/${profile.id}`" class="row">
    <Identicon :address="profile.address" :size="44" />
    <div class="row-main">
      <div class="row-name">{{ profile.name }}</div>
      <div class="row-address">{{ shortAddress(profile.address) }}</div>
    </div>
    <span v-if="profile.favorite" class="row-star">★</span>
  </router-link>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  min-height: 64px;
  text-decoration: none;
  color: var(--text);
  transition: background 0.12s ease;
}
.row:active { background: var(--border); }
.row-main { flex: 1; min-width: 0; }
.row-name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-address { font-size: 13px; color: var(--text-2); }
.row-star { color: var(--nq-gold); font-size: 18px; }
</style>
