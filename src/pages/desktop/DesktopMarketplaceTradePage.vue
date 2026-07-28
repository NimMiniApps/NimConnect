<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { hubCheckoutPayment, hubSignReleaseTransaction, hubSignClaimTransaction, hubErrorMessage } from '../../services/hub'
import { getDesktopHubAddress } from '../../services/desktop-session'
import { getTrade, submitRelease, submitClaim, fetchChainHeight, type MarketplaceTrade } from '../../services/marketplace'

const TERMINAL_STATES = new Set(['SETTLED', 'REFUNDED', 'FAILED_AFTER_RELEASE', 'MANUAL_REVIEW'])
const POLL_INTERVAL_MS = 4000

const route = useRoute()
const tradeId = computed(() => String(route.params.id))

const trade = ref<MarketplaceTrade | null>(null)
const notFound = ref<string | null>(null)
const acting = ref(false)
const error = ref<string | null>(null)
let pollHandle: ReturnType<typeof setInterval> | undefined
let consecutiveFailures = 0
let polling = true

function compact(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

const ownAddress = computed(() => getDesktopHubAddress())
const isSeller = computed(() => !!trade.value && compact(ownAddress.value || '') === compact(trade.value.seller))
const isBuyer = computed(() => !!trade.value && compact(ownAddress.value || '') === compact(trade.value.buyer))

function lunaToNim(luna: number): string {
  return (luna / 100000).toString()
}

async function refresh() {
  try {
    trade.value = await getTrade(tradeId.value)
    notFound.value = null
    consecutiveFailures = 0
    if (trade.value && TERMINAL_STATES.has(trade.value.state)) {
      stopPolling()
    }
  } catch (e) {
    consecutiveFailures++
    if (!trade.value) notFound.value = (e as Error).message
    if (consecutiveFailures >= 3) stopPolling()
  }
}

function stopPolling() {
  polling = false
  if (pollHandle) clearInterval(pollHandle)
  pollHandle = undefined
}

const canPay = computed(() => !!trade.value?.escrow_address)

async function pay() {
  if (acting.value || !trade.value || !trade.value.escrow_address) return
  acting.value = true
  error.value = null
  try {
    await hubCheckoutPayment({
      recipient: trade.value.escrow_address,
      valueLuna: trade.value.price_luna,
      data: `NME1:${trade.value.reference}`,
      sender: trade.value.buyer,
    })
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    acting.value = false
  }
}

async function release() {
  if (acting.value || !trade.value || !ownAddress.value) return
  acting.value = true
  error.value = null
  try {
    const height = await fetchChainHeight()
    const { rawHex } = await hubSignReleaseTransaction(trade.value.handle, ownAddress.value, height)
    await submitRelease(trade.value.id, { kind: 'hub', raw_hex: rawHex })
    await refresh()
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    acting.value = false
  }
}

async function claim() {
  if (acting.value || !trade.value || !ownAddress.value) return
  acting.value = true
  error.value = null
  try {
    const height = await fetchChainHeight()
    const { rawHex } = await hubSignClaimTransaction(trade.value.handle, ownAddress.value, height)
    await submitClaim(trade.value.id, { kind: 'hub', raw_hex: rawHex })
    await refresh()
  } catch (e) {
    error.value = hubErrorMessage(e)
  } finally {
    acting.value = false
  }
}

onMounted(async () => {
  await refresh()
  if (polling) pollHandle = setInterval(refresh, POLL_INTERVAL_MS)
})
onUnmounted(stopPolling)
</script>

<template>
  <section class="desktop-marketplace-trade">
    <p v-if="notFound">{{ notFound }}</p>
    <template v-else-if="trade">
      <h1>@{{ trade.handle }}</h1>
      <p v-if="error" class="desktop-marketplace-trade__error">{{ error }}</p>

      <div v-if="trade.state === 'AWAITING_DEPOSIT' || trade.state === 'DEPOSIT_FINALIZING'">
        <p>Pay {{ lunaToNim(trade.price_luna) }} NIM to fund this trade.</p>
        <p v-if="!canPay">Escrow address unavailable — reload this page in a moment.</p>
        <button v-else type="button" data-pay-button :disabled="acting" @click="pay">Pay with Hub</button>
      </div>

      <div v-else-if="['FUNDED', 'AWAITING_RELEASE'].includes(trade.state) && isSeller">
        <button type="button" data-release-button :disabled="acting" @click="release">
          {{ acting ? 'Releasing…' : `Release @${trade.handle}` }}
        </button>
      </div>
      <div v-else-if="['FUNDED', 'AWAITING_RELEASE'].includes(trade.state)">
        <p>Still waiting for the seller to release @{{ trade.handle }}.</p>
      </div>

      <div v-else-if="['RELEASE_CONFIRMING', 'AWAITING_CLAIM'].includes(trade.state) && isBuyer">
        <button type="button" data-claim-button :disabled="acting" @click="claim">
          {{ acting ? 'Claiming…' : `Claim @${trade.handle}` }}
        </button>
      </div>
      <div v-else-if="['RELEASE_CONFIRMING', 'AWAITING_CLAIM'].includes(trade.state)">
        <p>Still waiting for the buyer to claim @{{ trade.handle }}.</p>
      </div>

      <div v-else-if="['CLAIM_CONFIRMING', 'SETTLEMENT_PENDING'].includes(trade.state)">
        <p>Confirming on chain…</p>
      </div>

      <div v-else-if="trade.state === 'SETTLED'">
        <p v-if="isBuyer">🎉 You now own @{{ trade.handle }}.</p>
        <p v-else>You were paid for @{{ trade.handle }}.</p>
      </div>

      <div v-else-if="trade.state === 'REFUNDED'">
        <p>This trade was refunded — the buyer's payment was returned.</p>
      </div>
      <div v-else-if="trade.state === 'FAILED_AFTER_RELEASE' || trade.state === 'MANUAL_REVIEW'">
        <p>This trade did not complete.</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.desktop-marketplace-trade { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
.desktop-marketplace-trade__error { color: var(--nq-red); }
</style>
