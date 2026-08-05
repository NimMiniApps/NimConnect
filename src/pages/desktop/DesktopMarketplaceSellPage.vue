<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { findMyHandle, type HandleClaim } from '../../services/handles'
import { createListing, generateNonce } from '../../services/marketplace'

const brandIconUrl = `${import.meta.env.BASE_URL}brand/nimconnect-icon-192x192.png`

/** Fixed platform fee — never editable by the seller. Must stay at or below
 * the backend's configured MARKETPLACE_MAX_FEE_BPS or listing creation
 * fails with a clear "fee exceeds the maximum allowed" error. */
const FEE_BPS = 500 // 5%
const LUNA_PER_NIM = 100000

const hubAddress = computed(() => getDesktopHubAddress())
const claim = ref<HandleClaim | null>(null)
const loadingIdentity = ref(false)
const priceNim = ref('')
const listing = ref(false)
const error = ref<string | null>(null)
const listedLink = ref<string | null>(null)

const priceLuna = computed(() => Math.round((parseFloat(priceNim.value) || 0) * LUNA_PER_NIM))
const feeLuna = computed(() => Math.round((priceLuna.value * FEE_BPS) / 10000))
const feeNim = computed(() => (feeLuna.value / LUNA_PER_NIM).toLocaleString(undefined, { maximumFractionDigits: 5 }))

async function loadIdentity(addr: string) {
  loadingIdentity.value = true
  try {
    claim.value = await findMyHandle([addr])
  } finally {
    loadingIdentity.value = false
  }
}

async function submitListing() {
  if (!hubAddress.value || !claim.value || priceLuna.value <= 0 || listing.value) return
  listing.value = true
  error.value = null
  const nonce = generateNonce()
  const expiresAt = Math.floor(Date.now() / 1000) + 600
  try {
    await createListing({
      handle: claim.value.handle, seller: hubAddress.value,
      price_luna: priceLuna.value, fee_luna: feeLuna.value,
      ownership_epoch_tx_hash: claim.value.tx_hash,
      nonce, expires_at: expiresAt,
    })
    listedLink.value = `/marketplace/buy?handle=${claim.value.handle}`
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    listing.value = false
  }
}

onMounted(async () => {
  if (hubAddress.value) {
    await loadIdentity(hubAddress.value)
  }
})
</script>

<template>
  <section class="desktop-marketplace-sell">
    <header class="desktop-marketplace-sell__header">
      <img :src="brandIconUrl" alt="" width="32" height="32" />
      <h1>Sell your @handle</h1>
    </header>

    <div v-if="!hubAddress" class="desktop-marketplace-sell__connect">
      <p>Connect your Nimiq Hub wallet to list a handle for sale.</p>
      <RouterLink to="/me" class="nq-button">Connect Wallet</RouterLink>
    </div>
    <div v-else-if="loadingIdentity">
      <p>Checking your identity…</p>
    </div>
    <div v-else-if="!claim">
      <p>You need to claim a handle before you can list one for sale.</p>
    </div>
    <div v-else-if="listedLink" class="desktop-marketplace-sell__done">
      <p>@{{ claim.handle }} is listed. Share its link:</p>
      <code>{{ listedLink }}</code>
    </div>
    <form v-else class="desktop-marketplace-sell__form" @submit.prevent="submitListing">
      <p class="desktop-marketplace-sell__intro">Listing <strong>@{{ claim.handle }}</strong> for sale.</p>
      <label class="desktop-marketplace-sell__label" for="desktop-marketplace-sell-price">Price (NIM)</label>
      <input
        id="desktop-marketplace-sell-price"
        type="number" min="0" step="0.01" inputmode="decimal"
        class="desktop-marketplace-sell__input"
        v-model="priceNim"
      />
      <p class="desktop-marketplace-sell__fee">Marketplace fee: {{ FEE_BPS / 100 }}% ({{ feeNim }} NIM)</p>
      <p v-if="error" class="desktop-marketplace-sell__error">{{ error }}</p>
      <button type="submit" class="nq-button" data-list-button :disabled="listing || priceLuna <= 0">
        {{ listing ? 'Listing…' : 'List for sale' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.desktop-marketplace-sell { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-sell__header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.desktop-marketplace-sell__header h1 { font-size: 20px; margin: 0; }
.desktop-marketplace-sell__connect,
.desktop-marketplace-sell__done {
  display: flex; flex-direction: column; align-items: flex-start; gap: 16px;
  padding: 24px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-card);
}
.desktop-marketplace-sell__done code {
  padding: 8px 12px; border-radius: var(--nimiq-radius-input);
  background: var(--card); font-family: 'Fira Mono', monospace; word-break: break-all;
}
.desktop-marketplace-sell__form {
  display: flex; flex-direction: column; gap: 8px;
  padding: 24px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-card);
}
.desktop-marketplace-sell__intro { margin: 0 0 8px; }
.desktop-marketplace-sell__label { font-size: 13px; font-weight: 700; color: var(--text-2); }
.desktop-marketplace-sell__input {
  height: 48px; padding: 0 14px; margin-bottom: 4px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); font: inherit; font-size: 18px; color: var(--text);
}
.desktop-marketplace-sell__input:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 1px; }
.desktop-marketplace-sell__fee { margin: 0 0 12px; font-size: 14px; color: var(--text-2); }
.desktop-marketplace-sell__error { color: var(--nq-red); }
.desktop-marketplace-sell__form .nq-button,
.desktop-marketplace-sell__form button { align-self: flex-start; }
</style>
