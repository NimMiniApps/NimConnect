<script setup lang="ts">
import { computed, ref } from 'vue'
import type { InboxItem } from '../types/profile'
import { parsePaymentRequest, shortAddress } from '../services/links'
import Identicon from './Identicon.vue'

const props = defineProps<{
  item: InboxItem
  contactName?: string // undefined = unknown sender
  paying?: boolean
}>()
const emit = defineEmits<{ pay: []; dismiss: [] }>()

const confirming = ref(false)
const parsed = computed(() => parsePaymentRequest(props.item.payload))

function onPay() {
  // Unknown senders always get an explicit confirmation step (spec).
  if (!props.contactName && !confirming.value) {
    confirming.value = true
    return
  }
  confirming.value = false
  emit('pay')
}
</script>

<template>
  <article class="card request-card">
    <div class="request-head">
      <Identicon :address="item.sender" :size="44" />
      <div class="request-title">
        <span class="request-name" :class="{ missing: !contactName }">
          {{ contactName ?? 'Unknown sender' }}
        </span>
        <span class="request-date">
          {{ shortAddress(item.sender) }} · {{ new Date(item.receivedAt).toLocaleDateString() }}
          <span v-if="item.reminders" class="reminder-badge">reminder ×{{ item.reminders }}</span>
        </span>
      </div>
      <div v-if="parsed?.amountNim" class="request-amount">
        {{ parsed.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM
      </div>
    </div>

    <p v-if="parsed?.message" class="request-desc">{{ parsed.message }}</p>

    <div v-if="confirming" class="confirm">
      <p>
        You are about to pay someone <strong>not in your contacts</strong>.
        Funds go to:<br /><code>{{ item.sender }}</code>
      </p>
      <div class="request-actions">
        <button type="button" class="action danger-solid" :disabled="paying" @click="onPay">Pay anyway</button>
        <button type="button" class="action" @click="confirming = false">Cancel</button>
      </div>
    </div>
    <div v-else class="request-actions">
      <button v-if="parsed?.amountNim" type="button" class="action primary" :disabled="paying" @click="onPay">
        {{ paying ? 'Paying…' : 'Pay' }}
      </button>
      <button type="button" class="action" @click="emit('dismiss')">Dismiss</button>
    </div>
  </article>
</template>

<style scoped>
.request-card { padding: 14px; }
.request-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.request-title { flex: 1; min-width: 0; }
.request-name { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.request-name.missing { color: var(--text-2); }
.request-date { display: block; margin-top: 2px; color: var(--text-2); font-size: 12px; }
.reminder-badge {
  display: inline-block; margin-left: 4px; padding: 1px 6px;
  border-radius: var(--nimiq-radius-small); background: var(--text-6);
  font-size: 11px; font-weight: 700; color: var(--nq-gold-dark);
}
.request-amount { text-align: right; font-weight: 700; color: var(--nq-gold-dark); flex: 0 0 auto; }
.request-desc { margin: 12px 0 0; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.confirm { margin-top: 12px; padding: 10px 12px; border-radius: var(--radius); background: rgba(216, 65, 62, 0.08); font-size: 13px; }
.confirm code { overflow-wrap: anywhere; font-size: 12px; }
.request-actions { display: flex; gap: 8px; margin-top: 12px; }
.request-actions .action {
  min-height: 42px; padding: 0 16px; border: 1px solid var(--border); border-radius: 21px;
  background: var(--bg); color: var(--nq-light-blue); cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.request-actions .action.primary { border: none; color: var(--nimiq-white); background: var(--nimiq-gold-bg); }
.request-actions .action.danger-solid { border: none; color: var(--nimiq-white); background: var(--nq-red); }
.request-actions .action:disabled { opacity: 0.5; cursor: default; }
</style>
