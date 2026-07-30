<script setup lang="ts">
import { ref } from 'vue'
import { chooseHubAddress, hubSignMessage } from '../../services/hub'
import { getDesktopHubAddress, setDesktopHubAddress } from '../../services/desktop-session'
import {
  fetchTradesForWallet,
  marketplaceTradesLookupMessage,
  generateNonce,
  type MarketplaceTrade,
} from '../../services/marketplace'

const hubAddress = ref<string | null>(getDesktopHubAddress())
const trades = ref<MarketplaceTrade[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

function roleFor(trade: MarketplaceTrade): string {
  return compact(trade.seller) === compact(hubAddress.value || '') ? 'Selling' : 'Buying'
}

// A stored address alone doesn't carry a valid signature — every load, first
// visit or returning, signs a fresh short-lived proof of ownership before
// fetching, since the backend requires one on every request.
async function loadTrades() {
  loading.value = true
  error.value = null
  try {
    let address = hubAddress.value
    if (!address) {
      address = await chooseHubAddress()
      setDesktopHubAddress(address)
      hubAddress.value = address
    }
    const nonce = generateNonce()
    const expiresAt = Math.floor(Date.now() / 1000) + 600
    const message = marketplaceTradesLookupMessage(address, nonce, expiresAt)
    const { publicKey, signature } = await hubSignMessage(message, address)
    trades.value = await fetchTradesForWallet(address, nonce, expiresAt, publicKey, signature)
    loaded.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="desktop-marketplace-trades">
    <h1>My Trades</h1>
    <div v-if="!loaded">
      <p>{{ hubAddress ? 'Sign to prove you own this wallet and load your trades.' : 'Connect your Nimiq Hub wallet to see your trades.' }}</p>
      <button type="button" data-load-trades :disabled="loading" @click="loadTrades">
        {{ loading ? 'Loading…' : (hubAddress ? 'Load My Trades' : 'Connect Wallet') }}
      </button>
      <p v-if="error" class="desktop-marketplace-trades__error">{{ error }}</p>
    </div>
    <div v-else-if="trades.length === 0">
      <p>No trades yet. <a href="#/marketplace">Browse the marketplace</a>.</p>
    </div>
    <ul v-else class="desktop-marketplace-trades__list">
      <li v-for="trade in trades" :key="trade.id">
        <a :href="`#/marketplace/trades/${trade.id}`">
          @{{ trade.handle }} — {{ roleFor(trade) }} — {{ trade.state }}
        </a>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.desktop-marketplace-trades { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-trades__error { color: var(--nq-red); }
.desktop-marketplace-trades__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
</style>
