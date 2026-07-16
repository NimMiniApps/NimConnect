<script setup lang="ts">
import { computed } from 'vue'
import Identicon from './Identicon.vue'
import PublicAddressCopy from './PublicAddressCopy.vue'
import PublicSurface from './PublicSurface.vue'
import PublicStoreLinks from './PublicStoreLinks.vue'
import QrCode from './QrCode.vue'
import {
  makeRequestLink,
  makeNimiqPayDeepLink,
  makeWalletRequestLink,
} from '../services/links'
import { makeNimiqPayProfileLink, type SharedProfile } from '../services/profile-share'

const props = withDefaults(defineProps<{ profile: SharedProfile; allowBrowserContinue?: boolean }>(), {
  allowBrowserContinue: true,
})
const emit = defineEmits<{ continue: [] }>()

const nimiqUri = computed(() => makeRequestLink(props.profile.address))
const payDeepLink = computed(() => makeNimiqPayDeepLink(props.profile.address))
const walletLink = computed(() => makeWalletRequestLink(props.profile.address))
const addInPayLink = computed(() => makeNimiqPayProfileLink(props.profile))
const showBrowserContinue = computed(() => props.allowBrowserContinue !== false)
</script>

<template>
  <PublicSurface context="Shared profile">
    <template #identity>
      <Identicon :address="profile.address" :size="80" />
      <h1 class="identity__title">{{ profile.name }}</h1>
      <p v-if="profile.bio" class="identity__bio">{{ profile.bio }}</p>
      <div v-if="profile.tags.length" class="identity__tags">
        <span v-for="tag in profile.tags" :key="tag">{{ tag }}</span>
      </div>
      <div v-if="profile.website || profile.github || profile.x" class="identity__links">
        <a v-if="profile.website" :href="profile.website" target="_blank" rel="noopener">Website</a>
        <a v-if="profile.github" :href="`https://github.com/${encodeURIComponent(profile.github)}`" target="_blank" rel="noopener">GitHub</a>
        <a v-if="profile.x" :href="`https://x.com/${encodeURIComponent(profile.x)}`" target="_blank" rel="noopener">𝕏 @{{ profile.x }}</a>
      </div>
    </template>

    <template #panel>
      <p class="payment-panel__label">Send NIM to {{ profile.name }}</p>
      <QrCode :text="nimiqUri" :size="180" />
      <span>Scan with any Nimiq wallet, or use a wallet app below</span>
      <PublicAddressCopy :address="profile.address" />
    </template>

    <template #primary>
      <a class="nq-button" :href="payDeepLink">Pay with Nimiq Pay</a>
    </template>

    <template #secondary>
      <a class="nq-button light-blue" :href="walletLink" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
      <a :href="addInPayLink" class="public-action--outline">Add to NimConnect</a>
    </template>

    <template #tertiary>
      <PublicStoreLinks />
    </template>

    <template #footer>
      <p>Shared via <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
      <button v-if="showBrowserContinue" type="button" @click="emit('continue')">
        Open NimConnect in the browser
      </button>
    </template>
  </PublicSurface>
</template>

<style scoped>
.identity__title { color: var(--text); font-size: 1.625rem; margin: 0; }
.identity__bio { color: var(--text-2); }
.identity__bio { line-height: 1.45; max-width: 22.5rem; }
.identity__tags,
.identity__links { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.identity__links a {
  border: 1px solid color-mix(in srgb, var(--nq-light-blue) 45%, transparent);
  border-radius: var(--nimiq-radius-pill);
  color: var(--nq-light-blue);
  font-size: 0.8125rem;
  font-weight: 700;
  padding: 0.375rem 0.75rem;
  text-decoration: none;
}
.identity__tags span {
  background: color-mix(in srgb, var(--nimiq-gold) 24%, transparent);
  border-radius: var(--nimiq-radius-pill);
  color: var(--text);
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.3125rem 0.75rem;
}
.payment-panel__label { color: var(--text-2); font-weight: 800; }
</style>
