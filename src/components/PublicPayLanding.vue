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
  shortAddress,
  type ParsedPaymentRequest,
} from '../services/links'
import { NIMPAY_APP_STORE_URL, NIMPAY_PLAY_STORE_URL } from '../config/host-app'

const props = defineProps<{ payment: ParsedPaymentRequest; allowBrowserContinue?: boolean }>()
const emit = defineEmits<{ continue: [] }>()

const nimiqUri = computed(() =>
  makeRequestLink(props.payment.recipient, props.payment.amountNim, props.payment.message))
const payDeepLink = computed(() =>
  makeNimiqPayDeepLink(props.payment.recipient, props.payment.amountNim, props.payment.message))
const walletLink = computed(() =>
  makeWalletRequestLink(props.payment.recipient, props.payment.amountNim, props.payment.message))
const amountText = computed(() =>
  props.payment.amountNim != null
    ? `${props.payment.amountNim.toLocaleString(undefined, { maximumFractionDigits: 5 })} NIM`
    : null)
</script>

<template>
  <PublicSurface context="Payment request" footer-verb="Sent">
    <template #identity>
      <div class="identity">
        <Identicon :address="payment.recipient" :size="64" />
        <p><strong>{{ payment.label || shortAddress(payment.recipient) }}</strong> requests a payment</p>
      </div>
    </template>

    <template #panel>
      <div class="payment-panel">
        <p v-if="amountText" class="payment-panel__amount">{{ amountText }}</p>
        <p v-if="payment.message" class="payment-panel__message">{{ payment.message }}</p>
        <QrCode :text="nimiqUri" :size="220" />
        <span>Scan with any Nimiq wallet, or use a wallet app below</span>
        <PublicAddressCopy :address="payment.recipient" />
      </div>
    </template>

    <template #primary>
      <a :href="payDeepLink">Pay with Nimiq Pay</a>
    </template>

    <template #secondary>
      <a :href="walletLink" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
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
        <p>Sent with <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
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
.identity p,
.payment-panel p,
.landing-footer p,
.store-group p { margin: 0; }
.identity p,
.payment-panel__message,
.payment-panel > span,
.landing-footer,
.store-group p { color: var(--text-2); }
.identity strong { color: var(--text); }
.payment-panel { gap: 0.75rem; text-align: center; }
.payment-panel__amount { color: var(--text); font-size: 2.125rem; font-weight: 800; }
.payment-panel__message { line-height: 1.45; }
.payment-panel > span { font-size: 0.8125rem; }
.store-group { gap: 0.5rem; margin-top: 0.5rem; }
.store-group p { font-size: 0.8125rem; font-weight: 700; }
.store-group > div { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.store-group a { border: 1px solid #bdc9e5; border-radius: 0.75rem; color: var(--text); font-size: 0.8125rem; font-weight: 800; padding: 0.625rem 0.75rem; text-decoration: none; }
.landing-footer { gap: 0.25rem; text-align: center; }
.landing-footer p { font-size: 0.8125rem; }
.landing-footer button { background: none; border: 0; color: var(--nq-light-blue); cursor: pointer; font: inherit; font-size: 0.8125rem; font-weight: 700; padding: 0.5rem; text-decoration: underline; text-underline-offset: 0.1875rem; }
</style>
