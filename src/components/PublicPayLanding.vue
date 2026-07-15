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
      <Identicon :address="payment.recipient" :size="64" />
      <p class="identity__request"><strong>{{ payment.label || shortAddress(payment.recipient) }}</strong> requests a payment</p>
    </template>

    <template #panel>
      <p v-if="amountText" class="payment-panel__amount">{{ amountText }}</p>
      <p v-if="payment.message" class="payment-panel__message">{{ payment.message }}</p>
      <QrCode :text="nimiqUri" :size="220" />
      <span>Scan with any Nimiq wallet, or use a wallet app below</span>
      <PublicAddressCopy :address="payment.recipient" />
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
      <p>Sent with <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
      <button v-if="showBrowserContinue" type="button" @click="emit('continue')">
        Open NimConnect in the browser
      </button>
    </template>
  </PublicSurface>
</template>

<style scoped>
.identity__request,
.payment-panel__message { color: var(--text-2); }
.identity__request { margin: 0; }
.identity__request strong { color: var(--text); }
.payment-panel__amount { color: var(--text); font-size: 2.125rem; font-weight: 800; }
.payment-panel__message { line-height: 1.45; }
</style>
