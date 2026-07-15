<script setup lang="ts">
import { ref, watch } from 'vue'
import { useProfilesStore } from '../stores/profiles'
import {
  connectWallet,
  formatNimAmount,
  getSpendableBalanceNim,
  maxSendableNim,
} from '../services/nimiq'

const props = defineProps<{ when?: boolean }>()
const emit = defineEmits<{
  balance: [nim: number | null]
  max: [nim: number]
}>()

const store = useProfilesStore()
const balance = ref<number | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  balance.value = null
  emit('balance', null)
  try {
    await connectWallet()
    balance.value = await getSpendableBalanceNim(store.self?.address ?? null)
    emit('balance', balance.value)
  } finally {
    loading.value = false
  }
}

watch(() => props.when, active => {
  if (active) void load()
}, { immediate: true })

function onMax() {
  if (balance.value == null) return
  emit('max', maxSendableNim(balance.value))
}
</script>

<template>
  <p v-if="loading" class="balance">Loading spending balance…</p>
  <p v-else-if="balance != null" class="balance">
    <span>Available: <strong>{{ formatNimAmount(balance) }} NIM</strong></span>
    <button type="button" class="max-btn" :disabled="balance <= 0" @click="onMax">Max</button>
  </p>
  <p v-else class="balance muted">Spending balance unavailable</p>
</template>

<style scoped>
.balance {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--text-2);
}
.balance strong { color: var(--text); }
.balance.muted { justify-content: center; }
.max-btn {
  flex-shrink: 0;
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.max-btn:disabled { opacity: 0.4; cursor: default; }
</style>
