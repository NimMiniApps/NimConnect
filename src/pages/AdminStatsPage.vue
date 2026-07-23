<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AdminSessionExpiredError, fetchStats, getSessionToken, login, type StatsSummary } from '../services/adminAuth'

type ViewState = 'connect' | 'loading' | 'loaded' | 'error'

const state = ref<ViewState>('connect')
const summary = ref<StatsSummary | null>(null)

async function load() {
  state.value = 'loading'
  try {
    summary.value = await fetchStats()
    state.value = 'loaded'
  } catch (err) {
    if (err instanceof AdminSessionExpiredError) {
      state.value = 'connect'
    } else {
      state.value = 'error'
    }
  }
}

async function onConnect() {
  state.value = 'loading'
  try {
    await login()
    await load()
  } catch {
    state.value = 'connect'
  }
}

onMounted(() => {
  if (getSessionToken()) void load()
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Admin · Stats</h1>
      <p>Daily unique wallets and app opens.</p>
    </header>

    <div v-if="state === 'connect'" class="hint">
      <button type="button" class="nq-button" data-connect @click="onConnect">Connect wallet</button>
    </div>

    <p v-else-if="state === 'loading'" class="hint">Loading…</p>

    <div v-else-if="state === 'error'" class="hint">
      <p>Stats are unavailable right now.</p>
      <button type="button" class="nq-button" data-retry @click="load">Retry</button>
    </div>

    <template v-else-if="state === 'loaded' && summary">
      <div class="totals">
        <div class="total-card">
          <span class="total-value">{{ summary.unique_wallets }}</span>
          <span class="total-label">Unique wallets</span>
        </div>
        <div class="total-card">
          <span class="total-value">{{ summary.total_opens }}</span>
          <span class="total-label">Total opens</span>
        </div>
      </div>

      <table class="stats-table">
        <thead>
          <tr><th>Day</th><th>Wallets</th><th>Opens</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in [...summary.days].reverse()" :key="d.day" data-day-row>
            <td>{{ d.day }}</td>
            <td>{{ d.wallets }}</td>
            <td>{{ d.opens }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 88px; max-width: 720px; margin: 0 auto; }
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 4px; }
.header p { margin: 0 0 14px; color: var(--text-2); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; margin: 24px 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.total-card { padding: 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--card); box-shadow: var(--shadow); text-align: center; }
.total-value { display: block; font-size: 22px; font-weight: 700; }
.total-label { display: block; margin-top: 4px; color: var(--text-2); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.stats-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.stats-table th, .stats-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
.stats-table th { color: var(--text-2); font-weight: 700; text-transform: uppercase; font-size: 11px; }
</style>
