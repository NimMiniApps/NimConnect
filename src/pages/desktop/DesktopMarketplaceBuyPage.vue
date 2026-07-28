<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { chooseHubAddress, hubSignMessage, hubErrorMessage } from '../../services/hub'
import { getDesktopHubAddress, setDesktopHubAddress } from '../../services/desktop-session'
import { fetchListings, reserveTrade, marketplacePurchaseMessage, generateNonce, type MarketplaceListing } from '../../services/marketplace'

const route = useRoute()
const router = useRouter()
const handle = computed(() => String(route.query.handle || ''))

const hubAddress = ref<string | null>(null)
const listing = ref<MarketplaceListing | null>(null)
const loading = ref(true)
const buying = ref(false)
const error = ref<string | null>(null)

function lunaToNim(luna: number): string {
  return (luna / 100000).toString()
}

async function connect() {
  error.value = null
  try {
    const addr = await chooseHubAddress()
    setDesktopHubAddress(addr)
    hubAddress.value = addr
  } catch (e) {
    error.value = hubErrorMessage(e)
  }
}

async function confirmBuy() {
  if (buying.value || !hubAddress.value || !listing.value) return
  buying.value = true
  error.value = null
  try {
    const nonce = generateNonce()
    const expiresAt = Math.floor(Date.now() / 1000) + 600
    const message = marketplacePurchaseMessage(handle.value, hubAddress.value, hubAddress.value, nonce, expiresAt)
    const { publicKey, signature } = await hubSignMessage(message, hubAddress.value)
    const trade = await reserveTrade({
      handle: handle.value, buyer: hubAddress.value, refund_address: hubAddress.value,
      nonce, expires_at: expiresAt, public_key: publicKey, signature,
    })
    router.push(`/marketplace/trades/${trade.trade_id}`)
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    buying.value = false
  }
}

onMounted(async () => {
  hubAddress.value = getDesktopHubAddress()
  try {
    const listings = await fetchListings()
    listing.value = listings.find((l) => l.handle === handle.value) || null
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="desktop-marketplace-buy">
    <h1>Buy @{{ handle }}</h1>
    <p v-if="loading">Loading…</p>
    <p v-else-if="!listing">This listing is no longer available.</p>
    <template v-else>
      <p>Price: {{ lunaToNim(listing.price_luna) }} NIM</p>
      <button v-if="!hubAddress" type="button" @click="connect">Connect Wallet</button>
      <button v-else type="button" data-confirm-buy :disabled="buying" @click="confirmBuy">
        {{ buying ? 'Confirming…' : 'Confirm purchase' }}
      </button>
      <p v-if="error" class="desktop-marketplace-buy__error">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
.desktop-marketplace-buy { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-buy__error { color: var(--nq-red); }
</style>
