<script setup lang="ts">
import { computed, ref } from 'vue'
import QrCode from './QrCode.vue'
import Identicon from './Identicon.vue'
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

const copied = ref(false)
async function copyAddress() {
  try {
    await navigator.clipboard.writeText(props.profile.address)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard unavailable — the address text is selectable.
  }
}
</script>

<template>
  <div class="landing">
    <header class="who">
      <Identicon :address="profile.address" :size="80" />
      <h1 class="name">{{ profile.name }}</h1>
      <p v-if="profile.bio" class="bio">{{ profile.bio }}</p>
      <div v-if="profile.tags.length" class="tag-row">
        <span v-for="t in profile.tags" :key="t" class="tag">{{ t }}</span>
      </div>
      <div v-if="profile.website || profile.github || profile.x" class="link-row">
        <a v-if="profile.website" :href="profile.website" target="_blank" rel="noopener" class="link-chip">🌐 Website</a>
        <a v-if="profile.github" :href="`https://github.com/${encodeURIComponent(profile.github)}`" target="_blank" rel="noopener" class="link-chip">GitHub</a>
        <a v-if="profile.x" :href="`https://x.com/${encodeURIComponent(profile.x)}`" target="_blank" rel="noopener" class="link-chip">𝕏 @{{ profile.x }}</a>
      </div>
    </header>

    <main class="pay-card">
      <p class="pay-label">Send NIM to {{ profile.name }}</p>
      <QrCode :text="nimiqUri" :size="220" />
      <p class="scan-hint">Scan with any Nimiq wallet, or use a wallet app below</p>

      <button type="button" class="address" @click="copyAddress">
        <span class="address-text">{{ profile.address }}</span>
        <span class="copy-label">{{ copied ? 'Copied ✓' : 'Copy address' }}</span>
      </button>
    </main>

    <section class="actions" aria-label="Pay or save contact">
      <a :href="walletLink" class="wallet-btn" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
      <a :href="payDeepLink" class="pay-btn">Pay with Nimiq Pay</a>
      <a :href="addInPayLink" class="add-btn">Add to NimConnect</a>
      <p class="store-label">Don't have Nimiq Pay yet?</p>
      <div class="stores">
        <a :href="NIMPAY_PLAY_STORE_URL" class="store-btn" target="_blank" rel="noopener noreferrer">Google Play</a>
        <a :href="NIMPAY_APP_STORE_URL" class="store-btn" target="_blank" rel="noopener noreferrer">App Store</a>
      </div>
    </section>

    <footer class="brand">
      <p>Shared via <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
      <button
        v-if="allowBrowserContinue !== false"
        type="button"
        class="browser-link"
        @click="emit('continue')"
      >
        Open NimConnect in the browser
      </button>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.who {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.name { margin: 0; font-size: 26px; font-weight: 800; color: var(--text); }
.bio { margin: 0; font-size: 15px; line-height: 1.45; color: var(--text-2); max-width: 360px; }
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
.tag {
  padding: 4px 10px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 12px;
  font-weight: 700;
  background: var(--card);
  border: 1px solid var(--border);
  color: var(--text-2);
}
.link-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.link-chip {
  padding: 6px 12px;
  border-radius: var(--nimiq-radius-small);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  color: var(--text);
  background: var(--card);
  border: 1px solid var(--border);
}
.pay-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 16px;
  border-radius: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.pay-label { margin: 0; font-size: 15px; font-weight: 700; color: var(--text-2); }
.scan-hint { margin: 0; font-size: 13px; color: var(--text-2); }
.address {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: none;
  font: inherit;
  cursor: pointer;
  color: var(--text);
}
.address-text { font-size: 13px; font-family: monospace; word-break: break-all; user-select: all; }
.copy-label { font-size: 12px; font-weight: 700; color: var(--nq-light-blue); }
.actions { display: flex; flex-direction: column; gap: 12px; }
.wallet-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 24px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 17px;
  font-weight: 800;
  text-decoration: none;
  color: var(--text);
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.pay-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 24px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 17px;
  font-weight: 800;
  text-decoration: none;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
  box-shadow: var(--nimiq-shadow);
}
.add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 24px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 15px;
  font-weight: 800;
  text-decoration: none;
  color: var(--nq-gold-dark);
  background: var(--card);
  border: 1px solid var(--border);
}
.store-label { margin: 0; text-align: center; font-size: 13px; font-weight: 700; color: var(--text-2); }
.stores { display: flex; gap: 10px; }
.store-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border-radius: var(--nimiq-radius-small);
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  font-weight: 800;
  text-decoration: none;
}
.brand { margin-top: auto; text-align: center; }
.brand p { margin: 0 0 4px; font-size: 13px; color: var(--text-2); }
.brand strong { color: var(--nq-gold-dark); }
.browser-link {
  padding: 8px;
  border: none;
  background: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--nq-light-blue);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
