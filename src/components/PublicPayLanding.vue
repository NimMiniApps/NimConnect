<script setup lang="ts">
import { computed } from 'vue'
import Identicon from './Identicon.vue'
import PublicAddressCopy from './PublicAddressCopy.vue'
import PublicSurface from './PublicSurface.vue'
import PublicStoreLinks from './PublicStoreLinks.vue'
import QrCode from './QrCode.vue'
import {
  makeRequestLink,
  makeNimiqPayDeepLink,
  makeWalletRequestLink,
  shortAddress,
  type ParsedPaymentRequest,
} from '../services/links'

const props = withDefaults(defineProps<{ payment: ParsedPaymentRequest; allowBrowserContinue?: boolean }>(), {
  allowBrowserContinue: true,
})
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
const showBrowserContinue = computed(() => props.allowBrowserContinue !== false)
</script>

<template>
  <PublicSurface context="Payment request" footer-verb="Sent">
    <template #identity>
      <div class="public-landing__identity identity">
        <Identicon :address="payment.recipient" :size="64" />
        <p><strong>{{ payment.label || shortAddress(payment.recipient) }}</strong> requests a payment</p>
      </div>
    </template>

    <template #panel>
      <div class="public-landing__panel payment-panel">
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
    </template>

    <template #tertiary>
      <PublicStoreLinks />
    </template>

    <template #footer>
      <div class="public-landing__footer">
        <p>Sent with <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
        <button v-if="showBrowserContinue" type="button" @click="emit('continue')">
          Open NimConnect in the browser
        </button>
      </div>
    </template>
  </PublicSurface>
</template>

<style scoped>
.identity p,
.payment-panel p { margin: 0; }
.identity p,
.payment-panel__message,
.payment-panel > span { color: var(--text-2); }
.identity strong { color: var(--text); }
.payment-panel__amount { color: var(--text); font-size: 2.125rem; font-weight: 800; }
.payment-panel__message { line-height: 1.45; }
</style>
