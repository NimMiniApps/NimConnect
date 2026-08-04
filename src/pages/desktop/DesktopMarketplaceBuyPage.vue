<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
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
const loadError = ref<string | null>(null)

function lunaToNim(luna: number): string {
  return (luna / 100000).toLocaleString(undefined, { maximumFractionDigits: 5 })
}

function shortAddress(address: string): string {
  const normalized = address.trim().replace(/\s+/g, ' ')
  if (normalized.length <= 22) return normalized
  return `${normalized.slice(0, 10)}…${normalized.slice(-7)}`
}

const priceNim = computed(() => listing.value ? lunaToNim(listing.value.price_luna) : '0')
const feeNim = computed(() => listing.value ? lunaToNim(listing.value.fee_luna) : '0')
const sellerPayoutNim = computed(() => listing.value
  ? lunaToNim(listing.value.price_luna - listing.value.fee_luna)
  : '0')
const buyerLabel = computed(() => hubAddress.value ? shortAddress(hubAddress.value) : '')

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
  const nonce = generateNonce()
  const expiresAt = Math.floor(Date.now() / 1000) + 600
  const message = marketplacePurchaseMessage(handle.value, hubAddress.value, hubAddress.value, nonce, expiresAt)
  let publicKey: string, signature: string
  try {
    ;({ publicKey, signature } = await hubSignMessage(message, hubAddress.value))
  } catch (e) {
    error.value = hubErrorMessage(e)
    buying.value = false
    return
  }
  try {
    const trade = await reserveTrade({
      handle: handle.value, buyer: hubAddress.value, refund_address: hubAddress.value,
      nonce, expires_at: expiresAt, public_key: publicKey, signature,
    })
    router.push(`/marketplace/trades/${trade.trade_id}`)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    buying.value = false
  }
}

onMounted(async () => {
  hubAddress.value = getDesktopHubAddress()
  loadError.value = null
  try {
    const listings = await fetchListings()
    listing.value = listings.find((l) => l.handle === handle.value) || null
  } catch (e) {
    loadError.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="desktop-marketplace-buy">
    <RouterLink to="/marketplace" class="desktop-marketplace-buy__back" data-back-marketplace>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
      Marketplace
    </RouterLink>

    <div
      v-if="loading"
      class="desktop-marketplace-buy__card desktop-marketplace-buy__loading"
      data-buy-loading
      aria-busy="true"
      aria-label="Loading purchase details"
    >
      <div class="skeleton desktop-marketplace-buy__skeleton-label" />
      <div class="skeleton desktop-marketplace-buy__skeleton-title" />
      <div class="skeleton desktop-marketplace-buy__skeleton-price" />
      <div class="skeleton desktop-marketplace-buy__skeleton-block" />
      <div class="skeleton desktop-marketplace-buy__skeleton-button" />
    </div>

    <div
      v-else-if="loadError"
      class="desktop-marketplace-buy__card desktop-marketplace-buy__state"
      data-buy-load-error
      role="alert"
    >
      <span class="desktop-marketplace-buy__state-icon" aria-hidden="true">!</span>
      <p class="desktop-marketplace-buy__eyebrow">Marketplace unavailable</p>
      <h1>We couldn't load @{{ handle }}</h1>
      <p>{{ loadError }}</p>
      <RouterLink to="/marketplace" class="nq-button">Back to marketplace</RouterLink>
    </div>

    <div
      v-else-if="!listing"
      class="desktop-marketplace-buy__card desktop-marketplace-buy__state"
      data-buy-unavailable
    >
      <svg class="desktop-marketplace-buy__state-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10v10H7z" />
        <path d="m9 9 6 6m0-6-6 6" />
      </svg>
      <p class="desktop-marketplace-buy__eyebrow">Listing unavailable</p>
      <h1>This listing is no longer available</h1>
      <p>@{{ handle }} may have been reserved, removed, or transferred.</p>
      <RouterLink to="/marketplace" class="nq-button">Browse other handles</RouterLink>
    </div>

    <article v-else class="desktop-marketplace-buy__card" data-buy-card aria-labelledby="marketplace-buy-title">
      <header class="desktop-marketplace-buy__header">
        <p class="desktop-marketplace-buy__eyebrow">Review purchase</p>
        <h1 id="marketplace-buy-title">Buy <span>@{{ handle }}</span></h1>
        <p>Reserve this listing, then complete the protected escrow handoff.</p>
      </header>

      <div class="desktop-marketplace-buy__price">
        <span>Purchase price</span>
        <strong>{{ priceNim }} <small>NIM</small></strong>
        <p>No funds move when you reserve.</p>
      </div>

      <div v-if="hubAddress" class="desktop-marketplace-buy__wallet">
        <span class="desktop-marketplace-buy__wallet-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7.5h14a2 2 0 0 1 2 2v8.5H6a2 2 0 0 1-2-2V7.5Z" />
            <path d="M4.5 7.5 16 4v3.5m1 4h3" />
          </svg>
        </span>
        <span class="desktop-marketplace-buy__wallet-copy">
          <small>Purchasing with</small>
          <strong :title="hubAddress">{{ buyerLabel }}</strong>
        </span>
        <RouterLink to="/me" class="desktop-marketplace-buy__switch">Switch</RouterLink>
      </div>

      <section class="desktop-marketplace-buy__steps" aria-labelledby="marketplace-buy-steps">
        <h2 id="marketplace-buy-steps">How the handoff works</h2>
        <ol>
          <li>
            <span>1</span>
            <div><strong>Fund escrow</strong><p>After reserving, send {{ priceNim }} NIM to protected escrow.</p></div>
          </li>
          <li>
            <span>2</span>
            <div><strong>Seller releases</strong><p>The seller signs the on-chain release for @{{ handle }}.</p></div>
          </li>
          <li>
            <span>3</span>
            <div><strong>You claim</strong><p>Claim @{{ handle }}. The seller is paid only after ownership finalizes.</p></div>
          </li>
        </ol>
      </section>

      <dl class="desktop-marketplace-buy__summary">
        <div><dt>Marketplace fee</dt><dd>{{ feeNim }} NIM</dd></div>
        <div data-seller-payout><dt>Seller receives</dt><dd>{{ sellerPayoutNim }} NIM</dd></div>
      </dl>

      <div class="desktop-marketplace-buy__notice">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        <p><strong>Protected by escrow</strong><span>NimConnect releases payment only after the buyer is the finalized on-chain owner.</span></p>
      </div>

      <p v-if="error" class="desktop-marketplace-buy__error" role="alert">{{ error }}</p>

      <button
        v-if="!hubAddress"
        type="button"
        class="nq-button desktop-marketplace-buy__primary"
        data-connect-wallet
        @click="connect"
      >
        Connect wallet to continue
      </button>
      <button
        v-else
        type="button"
        class="nq-button desktop-marketplace-buy__primary"
        data-confirm-buy
        :disabled="buying"
        @click="confirmBuy"
      >
        {{ buying ? 'Reserving…' : `Reserve @${handle}` }}
      </button>
      <p class="desktop-marketplace-buy__footnote">
        Reserving signs a purchase intent and temporarily holds the listing for payment.
      </p>
    </article>
  </section>
</template>

<style scoped>
.desktop-marketplace-buy {
  width: min(100%, 640px);
  margin: 0 auto;
  padding: 32px 16px 72px;
}

.desktop-marketplace-buy__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  margin-bottom: 12px;
  color: var(--text-2);
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  transition: color var(--attr-duration) var(--nimiq-ease);
}
.desktop-marketplace-buy__back svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; }
.desktop-marketplace-buy__back:hover { color: var(--nq-light-blue); }
.desktop-marketplace-buy__back:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 2px; border-radius: 4px; }

.desktop-marketplace-buy__card {
  position: relative;
  overflow: hidden;
  padding: 32px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-card);
  background: var(--card);
  box-shadow: var(--nimiq-shadow-card);
}
.desktop-marketplace-buy__card::before {
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: var(--nimiq-gold-bg);
  content: '';
}

.desktop-marketplace-buy__eyebrow {
  margin: 0 0 8px;
  color: var(--nq-gold);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.desktop-marketplace-buy__header h1,
.desktop-marketplace-buy__state h1 {
  margin: 0;
  color: var(--text);
  font-size: clamp(28px, 5vw, 38px);
  line-height: 1.12;
  letter-spacing: -0.03em;
}
.desktop-marketplace-buy__header h1 span { color: var(--nq-gold); }
.desktop-marketplace-buy__header > p:last-child,
.desktop-marketplace-buy__state > p {
  margin: 10px 0 0;
  color: var(--text-2);
  font-size: 15px;
  line-height: 1.55;
}

.desktop-marketplace-buy__price {
  margin: 28px 0 16px;
  padding: 20px 22px;
  border: 1px solid color-mix(in srgb, var(--nq-gold) 35%, var(--border));
  border-radius: var(--nimiq-radius-card);
  background: color-mix(in srgb, var(--nq-gold) 9%, var(--card));
}
.desktop-marketplace-buy__price > span {
  display: block;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.desktop-marketplace-buy__price strong {
  display: block;
  margin-top: 3px;
  color: var(--text);
  font-family: var(--nimiq-font-family-mono);
  font-size: clamp(32px, 7vw, 44px);
  line-height: 1.15;
  letter-spacing: -0.04em;
}
.desktop-marketplace-buy__price strong small { font-family: var(--nimiq-font-family); font-size: 0.42em; letter-spacing: 0; }
.desktop-marketplace-buy__price p { margin: 6px 0 0; color: var(--text-2); font-size: 13px; }

.desktop-marketplace-buy__wallet {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-card);
  background: var(--bg);
}
.desktop-marketplace-buy__wallet-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: var(--nimiq-light-blue-bg);
  color: var(--nimiq-white);
}
.desktop-marketplace-buy__wallet-icon svg,
.desktop-marketplace-buy__notice svg,
.desktop-marketplace-buy__state-svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}
.desktop-marketplace-buy__wallet-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.desktop-marketplace-buy__wallet-copy small { color: var(--text-2); font-size: 11px; font-weight: 700; text-transform: uppercase; }
.desktop-marketplace-buy__wallet-copy strong {
  overflow: hidden;
  font-family: var(--nimiq-font-family-mono);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desktop-marketplace-buy__switch { color: var(--nq-light-blue); font-size: 13px; font-weight: 800; text-decoration: none; }
.desktop-marketplace-buy__switch:hover { text-decoration: underline; }
.desktop-marketplace-buy__switch:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; border-radius: 3px; }

.desktop-marketplace-buy__steps { margin-top: 28px; }
.desktop-marketplace-buy__steps h2 { margin: 0 0 14px; font-size: 16px; }
.desktop-marketplace-buy__steps ol { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.desktop-marketplace-buy__steps li { display: flex; align-items: flex-start; gap: 12px; }
.desktop-marketplace-buy__steps li > span {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--nq-light-blue) 35%, var(--border));
  border-radius: 50%;
  background: color-mix(in srgb, var(--nq-light-blue) 9%, var(--card));
  color: var(--nq-light-blue);
  font-size: 12px;
  font-weight: 800;
}
.desktop-marketplace-buy__steps strong { display: block; font-size: 14px; }
.desktop-marketplace-buy__steps p { margin: 2px 0 0; color: var(--text-2); font-size: 13px; line-height: 1.45; }

.desktop-marketplace-buy__summary {
  margin: 24px 0 0;
  padding: 14px 0;
  border-block: 1px solid var(--border);
}
.desktop-marketplace-buy__summary div { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.desktop-marketplace-buy__summary div + div { margin-top: 8px; }
.desktop-marketplace-buy__summary dt { color: var(--text-2); font-size: 13px; }
.desktop-marketplace-buy__summary dd { margin: 0; font-family: var(--nimiq-font-family-mono); font-size: 13px; font-weight: 700; }

.desktop-marketplace-buy__notice {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  margin-top: 20px;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--nq-green) 30%, var(--border));
  border-radius: var(--nimiq-radius-card);
  background: color-mix(in srgb, var(--nq-green) 8%, var(--card));
  color: var(--nq-green);
}
.desktop-marketplace-buy__notice svg { flex: 0 0 auto; }
.desktop-marketplace-buy__notice p { display: flex; margin: 0; flex-direction: column; gap: 2px; }
.desktop-marketplace-buy__notice strong { color: var(--text); font-size: 13px; }
.desktop-marketplace-buy__notice span { color: var(--text-2); font-size: 12px; line-height: 1.45; }

.desktop-marketplace-buy__error {
  margin: 16px 0 0;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--nq-red) 35%, var(--border));
  border-radius: var(--nimiq-radius-input);
  background: color-mix(in srgb, var(--nq-red) 8%, var(--card));
  color: var(--nq-red);
  font-size: 13px;
  line-height: 1.45;
}
.desktop-marketplace-buy__primary { width: 100%; min-height: 52px; margin-top: 20px; font-size: 15px; }
.desktop-marketplace-buy__footnote { margin: 10px auto 0; max-width: 42ch; color: var(--text-2); font-size: 11px; line-height: 1.45; text-align: center; }

.desktop-marketplace-buy__state { display: flex; min-height: 360px; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.desktop-marketplace-buy__state .nq-button { margin-top: 24px; }
.desktop-marketplace-buy__state-icon,
.desktop-marketplace-buy__state-svg {
  display: grid;
  width: 44px;
  height: 44px;
  margin-bottom: 18px;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--nq-red) 10%, var(--card));
  color: var(--nq-red);
  font-weight: 800;
}
.desktop-marketplace-buy__state-svg { padding: 10px; }

.desktop-marketplace-buy__loading { min-height: 520px; }
.desktop-marketplace-buy__loading > div { border-radius: 4px; }
.desktop-marketplace-buy__skeleton-label { width: 96px; height: 12px; }
.desktop-marketplace-buy__skeleton-title { width: 56%; height: 36px; margin-top: 14px; }
.desktop-marketplace-buy__skeleton-price { width: 100%; height: 112px; margin-top: 28px; }
.desktop-marketplace-buy__skeleton-block { width: 100%; height: 184px; margin-top: 18px; }
.desktop-marketplace-buy__skeleton-button { width: 100%; height: 52px; margin-top: 22px; border-radius: var(--nimiq-radius-pill) !important; }

@media (max-width: 560px) {
  .desktop-marketplace-buy { padding: 16px 12px 48px; }
  .desktop-marketplace-buy__card { padding: 24px 18px; }
  .desktop-marketplace-buy__price { padding: 18px; }
  .desktop-marketplace-buy__wallet { align-items: flex-start; }
  .desktop-marketplace-buy__switch { padding-top: 7px; }
  .desktop-marketplace-buy__state { min-height: 320px; }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-marketplace-buy__back,
  .desktop-marketplace-buy :deep(.nq-button) { transition: none; }
}
</style>
