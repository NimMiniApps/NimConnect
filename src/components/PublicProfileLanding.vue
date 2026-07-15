<script setup lang="ts">
import { computed } from 'vue'
import Identicon from './Identicon.vue'
import PublicAddressCopy from './PublicAddressCopy.vue'
import PublicSurface from './PublicSurface.vue'
import QrCode from './QrCode.vue'
import {
  makeRequestLink,
  makeNimiqPayDeepLink,
  makeWalletRequestLink,
} from '../services/links'
import { makeNimiqPayProfileLink, type SharedProfile } from '../services/profile-share'
import { NIMPAY_APP_STORE_URL, NIMPAY_PLAY_STORE_URL } from '../config/host-app'

const props = defineProps<{ profile: SharedProfile; allowBrowserContinue?: boolean }>()
const emit = defineEmits<{ continue: [] }>()

const nimiqUri = computed(() => makeRequestLink(props.profile.address))
const payDeepLink = computed(() => makeNimiqPayDeepLink(props.profile.address))
const walletLink = computed(() => makeWalletRequestLink(props.profile.address))
const addInPayLink = computed(() => makeNimiqPayProfileLink(props.profile))
</script>

<template>
  <PublicSurface context="Shared profile">
    <template #identity>
      <div class="identity">
        <Identicon :address="profile.address" :size="80" />
        <h1>{{ profile.name }}</h1>
        <p v-if="profile.bio" class="identity__bio">{{ profile.bio }}</p>
        <div v-if="profile.tags.length" class="identity__tags">
          <span v-for="tag in profile.tags" :key="tag">{{ tag }}</span>
        </div>
        <div v-if="profile.website || profile.github || profile.x" class="identity__links">
          <a v-if="profile.website" :href="profile.website" target="_blank" rel="noopener">Website</a>
          <a v-if="profile.github" :href="`https://github.com/${encodeURIComponent(profile.github)}`" target="_blank" rel="noopener">GitHub</a>
          <a v-if="profile.x" :href="`https://x.com/${encodeURIComponent(profile.x)}`" target="_blank" rel="noopener">𝕏 @{{ profile.x }}</a>
        </div>
      </div>
    </template>

    <template #panel>
      <div class="payment-panel">
        <p>Send NIM to {{ profile.name }}</p>
        <QrCode :text="nimiqUri" :size="220" />
        <span>Scan with any Nimiq wallet, or use a wallet app below</span>
        <PublicAddressCopy :address="profile.address" />
      </div>
    </template>

    <template #primary>
      <a :href="payDeepLink">Pay with Nimiq Pay</a>
    </template>

    <template #secondary>
      <a :href="walletLink" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
      <a :href="addInPayLink" class="public-action--outline">Add to NimConnect</a>
      <div class="store-group">
        <p>Don't have Nimiq Pay yet?</p>
        <div>
          <a :href="NIMPAY_PLAY_STORE_URL" target="_blank" rel="noopener noreferrer">Google Play</a>
          <a :href="NIMPAY_APP_STORE_URL" target="_blank" rel="noopener noreferrer">App Store</a>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="landing-footer">
        <p>Shared via <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
        <button v-if="allowBrowserContinue !== false" type="button" @click="emit('continue')">
          Open NimConnect in the browser
        </button>
      </div>
    </template>
  </PublicSurface>
</template>

<style scoped>
.identity,
.payment-panel,
.landing-footer,
.store-group { display: grid; justify-items: center; }
.identity { gap: 0.625rem; }
.identity h1,
.payment-panel p,
.landing-footer p,
.store-group p { margin: 0; }
.identity h1 { color: var(--text); font-size: 1.625rem; }
.identity__bio,
.payment-panel > span,
.landing-footer,
.store-group p { color: var(--text-2); }
.identity__bio { line-height: 1.45; max-width: 22.5rem; }
.identity__tags,
.identity__links,
.store-group > div { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.identity__tags span,
.identity__links a { border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill); color: var(--text-2); font-size: 0.8125rem; font-weight: 700; padding: 0.375rem 0.625rem; text-decoration: none; }
.payment-panel { gap: 0.75rem; text-align: center; }
.payment-panel p { color: var(--text-2); font-weight: 800; }
.payment-panel > span { font-size: 0.8125rem; }
.store-group { gap: 0.5rem; margin-top: 0.5rem; }
.store-group p { font-size: 0.8125rem; font-weight: 700; }
.store-group a { border: 1px solid #bdc9e5; border-radius: 0.75rem; color: var(--text); font-size: 0.8125rem; font-weight: 800; padding: 0.625rem 0.75rem; text-decoration: none; }
.landing-footer { gap: 0.25rem; text-align: center; }
.landing-footer p { font-size: 0.8125rem; }
.landing-footer button { background: none; border: 0; color: var(--nq-light-blue); cursor: pointer; font: inherit; font-size: 0.8125rem; font-weight: 700; padding: 0.5rem; text-decoration: underline; text-underline-offset: 0.1875rem; }
</style>
