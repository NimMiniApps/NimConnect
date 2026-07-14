<script setup lang="ts">
import { computed, ref } from 'vue'
import QrCode from './QrCode.vue'
import Identicon from './Identicon.vue'
import {
  makeRequestLink,
  makeNimiqPayDeepLink,
  shortAddress,
  type ParsedPaymentRequest,
} from '../services/links'
import { NIMPAY_APP_STORE_URL, NIMPAY_PLAY_STORE_URL } from '../config/host-app'

const props = defineProps<{ payment: ParsedPaymentRequest }>()
const emit = defineEmits<{ continue: [] }>()

const nimiqUri = computed(() =>
  makeRequestLink(props.payment.recipient, props.payment.amountNim, props.payment.message))
const payDeepLink = computed(() =>
  makeNimiqPayDeepLink(props.payment.recipient, props.payment.amountNim, props.payment.message))
const amountText = computed(() =>
  props.payment.amountNim != null
    ? `${props.payment.amountNim.toLocaleString(undefined, { maximumFractionDigits: 5 })} NIM`
    : null)

const copied = ref(false)
async function copyAddress() {
  try {
    await navigator.clipboard.writeText(props.payment.recipient)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard unavailable (http / permissions) — the address text is selectable.
  }
}
</script>

<template>
  <div class="landing">
    <header class="who">
      <Identicon :address="payment.recipient" :size="64" />
      <p class="asking">
        <strong>{{ payment.label || shortAddress(payment.recipient) }}</strong>
        requests a payment
      </p>
    </header>

    <main class="request">
      <p v-if="amountText" class="amount">{{ amountText }}</p>
      <p v-if="payment.message" class="message">{{ payment.message }}</p>

      <QrCode :text="nimiqUri" :size="220" />
      <p class="scan-hint">Scan with any Nimiq wallet to pay</p>

      <button type="button" class="address" @click="copyAddress">
        <span class="address-text">{{ payment.recipient }}</span>
        <span class="copy-label">{{ copied ? 'Copied ✓' : 'Copy address' }}</span>
      </button>
    </main>

    <section class="actions" aria-label="Pay with Nimiq Pay">
      <a :href="payDeepLink" class="pay-btn">Pay with Nimiq Pay</a>
      <p class="store-label">Don't have Nimiq Pay yet?</p>
      <div class="stores">
        <a :href="NIMPAY_PLAY_STORE_URL" class="store-btn" target="_blank" rel="noopener noreferrer">Google Play</a>
        <a :href="NIMPAY_APP_STORE_URL" class="store-btn" target="_blank" rel="noopener noreferrer">App Store</a>
      </div>
    </section>

    <footer class="brand">
      <p>Sent with <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
      <button type="button" class="browser-link" @click="emit('continue')">
        Open NimConnect in the browser
      </button>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.who {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.asking { margin: 0; font-size: 16px; color: var(--text-2); }
.asking strong { color: var(--text); font-weight: 800; }
.request {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 20px 16px;
  border-radius: 16px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.amount { margin: 0; font-size: 34px; font-weight: 800; color: var(--text); }
.message { margin: 0; font-size: 15px; color: var(--text-2); text-align: center; }
.scan-hint { margin: 0; font-size: 13px; color: var(--text-2); }
.address {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: none;
  font: inherit;
  cursor: pointer;
  color: var(--text);
}
.address-text { font-size: 13px; font-family: monospace; word-break: break-all; user-select: all; }
.copy-label { font-size: 12px; font-weight: 700; color: var(--nq-light-blue); }
.actions { display: flex; flex-direction: column; gap: 12px; }
.pay-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 0 24px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 17px;
  font-weight: 800;
  text-decoration: none;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
  box-shadow: var(--nimiq-shadow);
}
.store-label { margin: 0; text-align: center; font-size: 13px; font-weight: 700; color: var(--text-2); }
.stores { display: flex; gap: 10px; }
.store-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border-radius: var(--nimiq-radius-small);
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  font-weight: 800;
  text-decoration: none;
}
.brand { margin-top: auto; text-align: center; }
.brand p { margin: 0 0 4px; font-size: 13px; color: var(--text-2); }
.brand strong { color: var(--nq-gold-dark); }
.browser-link {
  padding: 8px;
  border: none;
  background: none;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--nq-light-blue);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
