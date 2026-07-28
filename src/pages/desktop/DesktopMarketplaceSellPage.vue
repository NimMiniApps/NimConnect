<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { chooseHubAddress, hubSignMessage, hubErrorMessage } from '../../services/hub'
import { getDesktopHubAddress, setDesktopHubAddress } from '../../services/desktop-session'
import { findMyHandle, type HandleClaim } from '../../services/handles'
import { createListing, marketplaceListingMessage, generateNonce } from '../../services/marketplace'

const brandIconUrl = `${import.meta.env.BASE_URL}brand/nimconnect-icon-192x192.png`

/** Fixed platform fee — never editable by the seller. Must stay at or below
 * the backend's configured MARKETPLACE_MAX_FEE_BPS or listing creation
 * fails with a clear "fee exceeds the maximum allowed" error. */
const FEE_BPS = 500 // 5%
const LUNA_PER_NIM = 100000

const hubAddress = ref<string | null>(null)
const claim = ref<HandleClaim | null>(null)
const loadingIdentity = ref(false)
const connecting = ref(false)
const priceNim = ref('')
const listing = ref(false)
const error = ref<string | null>(null)
const listedLink = ref<string | null>(null)

const priceLuna = computed(() => Math.round((parseFloat(priceNim.value) || 0) * LUNA_PER_NIM))
const feeLuna = computed(() => Math.round((priceLuna.value * FEE_BPS) / 10000))
const feeNim = computed(() => (feeLuna.value / LUNA_PER_NIM).toString())

async function loadIdentity(addr: string) {
  loadingIdentity.value = true
  try {
    claim.value = await findMyHandle([addr])
  } finally {
    loadingIdentity.value = false
  }
}

async function connect() {
  error.value = null
  connecting.value = true
  try {
    const addr = await chooseHubAddress()
    setDesktopHubAddress(addr)
    hubAddress.value = addr
    await loadIdentity(addr)
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    connecting.value = false
  }
}

async function submitListing() {
  if (!hubAddress.value || !claim.value || priceLuna.value <= 0) return
  listing.value = true
  error.value = null
  try {
    const nonce = generateNonce()
    const expiresAt = Math.floor(Date.now() / 1000) + 600
    const message = marketplaceListingMessage(
      claim.value.handle, hubAddress.value, priceLuna.value, feeLuna.value,
      claim.value.tx_hash, nonce, expiresAt,
    )
    const { publicKey, signature } = await hubSignMessage(message, hubAddress.value)
    await createListing({
      handle: claim.value.handle, seller: hubAddress.value,
      price_luna: priceLuna.value, fee_luna: feeLuna.value,
      ownership_epoch_tx_hash: claim.value.tx_hash,
      nonce, expires_at: expiresAt, public_key: publicKey, signature,
    })
    listedLink.value = `/marketplace/${claim.value.handle}`
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    listing.value = false
  }
}

onMounted(async () => {
  const stored = getDesktopHubAddress()
  if (stored) {
    hubAddress.value = stored
    await loadIdentity(stored)
  }
})
</script>

<template>
  <section class="desktop-marketplace-sell">
    <header class="desktop-marketplace-sell__header">
      <img :src="brandIconUrl" alt="" width="32" height="32" />
      <h1>Sell your @handle</h1>
    </header>

    <div v-if="!hubAddress">
      <p>Connect your Nimiq Hub wallet to list a handle for sale.</p>
      <button type="button" :disabled="connecting" @click="connect">
        {{ connecting ? 'Connecting…' : 'Connect Wallet' }}
      </button>
    </div>
    <div v-else-if="loadingIdentity">
      <p>Checking your identity…</p>
    </div>
    <div v-else-if="!claim">
      <p>You need to claim a handle before you can list one for sale.</p>
    </div>
    <div v-else-if="listedLink">
      <p>@{{ claim.handle }} is listed. Share its link:</p>
      <code>{{ listedLink }}</code>
    </div>
    <form v-else @submit.prevent="submitListing">
      <p>Listing <strong>@{{ claim.handle }}</strong> for sale.</p>
      <label>
        Price (NIM)
        <input type="number" min="0" step="0.01" v-model="priceNim" />
      </label>
      <p>Marketplace fee: {{ FEE_BPS / 100 }}% ({{ feeNim }} NIM)</p>
      <p v-if="error" class="desktop-marketplace-sell__error">{{ error }}</p>
      <button type="submit" data-list-button :disabled="listing || priceLuna <= 0" @click="submitListing">
        {{ listing ? 'Listing…' : 'List for sale' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.desktop-marketplace-sell { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-sell__header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.desktop-marketplace-sell__header h1 { font-size: 20px; margin: 0; }
.desktop-marketplace-sell__error { color: var(--nq-red); }
</style>
