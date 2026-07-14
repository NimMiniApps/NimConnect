<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import Identicon from '../components/Identicon.vue'
import QrCode from '../components/QrCode.vue'
import {
  resolveHandle,
  fetchPublicProfile,
  type HandleClaim,
  type PublicProfile,
} from '../services/handles'
import {
  makeRequestLink,
  makeNimiqPayDeepLink,
  makeAppAddLink,
  shortAddress,
  transactionExplorerUrl,
} from '../services/links'

const route = useRoute()
const state = ref<'loading' | 'ready' | 'notfound' | 'error'>('loading')
const claim = ref<HandleClaim | null>(null)
const profile = ref<PublicProfile | null>(null)

const handle = computed(() => String(route.params.handle ?? '').toLowerCase())
const displayName = computed(() => profile.value?.display_name || `@${handle.value}`)
const payUri = computed(() => (claim.value ? makeRequestLink(claim.value.address) : ''))

// The backend rejects non-http(s) website URLs at publish time; this guard
// keeps javascript:/data: URIs out of href even if served data is ever stale.
const safeWebsite = computed(() => {
  try {
    const u = new URL(profile.value?.website ?? '')
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
})

onMounted(async () => {
  try {
    const resolved = await resolveHandle(handle.value)
    if (!resolved) {
      state.value = 'notfound'
      return
    }
    claim.value = resolved
    profile.value = (await fetchPublicProfile(resolved.address))?.profile ?? null
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
})
</script>

<template>
  <div class="public-profile">
    <p v-if="state === 'loading'" class="status">Loading @{{ handle }}…</p>
    <p v-else-if="state === 'notfound'" class="status">
      @{{ handle }} isn't claimed yet.
      <router-link to="/">Claim it in NimConnect →</router-link>
    </p>
    <p v-else-if="state === 'error'" class="status">Couldn't load this profile — try again in a moment.</p>

    <template v-else-if="claim">
      <header class="who">
        <Identicon :address="claim.address" :size="80" />
        <h1>{{ displayName }}</h1>
        <p class="handle">@{{ claim.handle }}</p>
        <p v-if="profile?.bio" class="bio">{{ profile.bio }}</p>
        <ul v-if="safeWebsite || profile?.github || profile?.x" class="socials">
          <li v-if="safeWebsite">
            <a :href="safeWebsite" target="_blank" rel="noopener noreferrer nofollow">🌐 Website</a>
          </li>
          <li v-if="profile?.github">
            <a :href="`https://github.com/${profile.github}`" target="_blank" rel="noopener noreferrer">GitHub</a>
          </li>
          <li v-if="profile?.x">
            <a :href="`https://x.com/${profile.x}`" target="_blank" rel="noopener noreferrer">X</a>
          </li>
        </ul>
        <ul v-if="profile?.tags?.length" class="tags">
          <li v-for="tag in profile.tags" :key="tag">{{ tag }}</li>
        </ul>
      </header>

      <section class="pay-card">
        <h2>Send NIM to {{ displayName }}</h2>
        <QrCode :text="payUri" :size="200" />
        <p class="scan-hint">Scan with any Nimiq wallet</p>
        <p class="address" :title="claim.address">{{ shortAddress(claim.address) }}</p>
        <a class="verified" :href="transactionExplorerUrl(claim.tx_hash)" target="_blank" rel="noopener">
          ✓ Handle verified on the Nimiq chain
        </a>
        <a :href="makeNimiqPayDeepLink(claim.address)" class="primary-btn">Send in Nimiq Pay</a>
        <a :href="makeAppAddLink(claim.address)" class="secondary-btn">Add to NimConnect</a>
      </section>

      <footer class="brand">
        <p><strong>NimConnect</strong> — a relationship manager for your wallet.</p>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.public-profile {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.status { padding: 40px 0; text-align: center; color: var(--text-2); }
.who { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
.who h1 { margin: 8px 0 0; font-size: 26px; line-height: 1.2; color: var(--text); }
.handle { margin: 0; font-size: 15px; font-weight: 800; color: var(--nq-gold-dark); }
.bio { margin: 6px 0 0; max-width: 380px; font-size: 15px; line-height: 1.5; color: var(--text-2); }
.socials { display: flex; gap: 14px; margin: 8px 0 0; padding: 0; list-style: none; }
.socials a { font-size: 14px; font-weight: 700; color: var(--nq-light-blue); text-decoration: none; }
.tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.tags li {
  padding: 3px 10px; border-radius: var(--nimiq-radius-pill); font-size: 12px; font-weight: 700;
  background: var(--bg); border: 1px solid var(--border); color: var(--text-2);
}
.pay-card {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 20px 16px; border-radius: 16px;
  background: var(--card); border: 1px solid var(--border); box-shadow: var(--shadow);
}
.pay-card h2 { margin: 0; font-size: 17px; color: var(--text); }
.scan-hint { margin: 0; font-size: 13px; color: var(--text-2); }
.address { margin: 0; font-size: 13px; font-family: monospace; color: var(--text); }
.verified { font-size: 12px; font-weight: 700; color: var(--nq-green); text-decoration: none; }
.primary-btn {
  display: flex; align-items: center; justify-content: center; width: 100%;
  min-height: 50px; border-radius: var(--nimiq-radius-pill); text-decoration: none;
  font-size: 16px; font-weight: 800; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg); box-shadow: var(--nimiq-shadow);
}
.secondary-btn {
  display: flex; align-items: center; justify-content: center; width: 100%;
  min-height: 44px; border-radius: var(--nimiq-radius-pill); text-decoration: none;
  font-size: 14px; font-weight: 700; color: var(--text);
  border: 1px solid var(--border); background: var(--card);
}
.brand { margin-top: auto; text-align: center; font-size: 13px; color: var(--text-2); }
.brand strong { color: var(--nq-gold-dark); }
</style>
