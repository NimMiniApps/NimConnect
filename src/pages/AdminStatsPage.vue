<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdminStatsChart from '../components/AdminStatsChart.vue'
import {
  AdminSessionExpiredError,
  fetchAdminHandles,
  fetchStats,
  getSessionToken,
  login,
  type AdminHandle,
  type StatsSummary,
} from '../services/adminAuth'
import { getDesktopHubAddress } from '../services/desktop-session'
import { shortAddress, transactionExplorerUrl } from '../services/links'

type ViewState = 'connect' | 'loading' | 'loaded' | 'error'
type SortKey = 'handle' | 'owner' | 'claimed' | 'transaction'
type SortDir = 'asc' | 'desc'

const state = ref<ViewState>('connect')
const summary = ref<StatsSummary | null>(null)
const handles = ref<AdminHandle[]>([])
const handleQuery = ref('')
const sortKey = ref<SortKey>('claimed')
const sortDir = ref<SortDir>('desc')
const sortColumns = [
  { key: 'handle', label: 'Handle' },
  { key: 'owner', label: 'Owner' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'transaction', label: 'Transaction' },
] as const
const connectLabel = computed(() =>
  getDesktopHubAddress() ? 'Sign to view stats' : 'Connect wallet',
)

function defaultDirFor(key: SortKey): SortDir {
  return key === 'claimed' || key === 'transaction' ? 'desc' : 'asc'
}

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sortKey.value = key
  sortDir.value = defaultDirFor(key)
}

function compareHandles(a: AdminHandle, b: AdminHandle): number {
  const dir = sortDir.value === 'asc' ? 1 : -1
  if (sortKey.value === 'claimed') {
    const aUnknown = a.claimed_at <= 0
    const bUnknown = b.claimed_at <= 0
    if (aUnknown && bUnknown) return a.handle.localeCompare(b.handle)
    if (aUnknown) return 1
    if (bUnknown) return -1
    return (a.claimed_at - b.claimed_at) * dir
  }
  const field =
    sortKey.value === 'handle' ? a.handle
    : sortKey.value === 'owner' ? a.address
    : a.tx_hash
  const other =
    sortKey.value === 'handle' ? b.handle
    : sortKey.value === 'owner' ? b.address
    : b.tx_hash
  return field.localeCompare(other, undefined, { sensitivity: 'base' }) * dir
}

const filteredHandles = computed(() => {
  const query = handleQuery.value.trim().toLowerCase()
  const compactQuery = query.replace(/\s+/g, '')
  let rows = handles.value
  if (query) {
    rows = rows.filter(claim =>
      claim.handle.toLowerCase().includes(query)
      || claim.address.toLowerCase().replace(/\s+/g, '').includes(compactQuery),
    )
  }
  return [...rows].sort(compareHandles)
})

function publicProfileUrl(handle: string): string {
  return `/#/u/${encodeURIComponent(handle)}`
}

function shortHash(hash: string): string {
  return hash.length > 18 ? `${hash.slice(0, 9)}…${hash.slice(-7)}` : hash
}

function claimDate(timestamp: number): string {
  if (timestamp <= 0) return 'Unknown'
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

async function load() {
  state.value = 'loading'
  try {
    const [nextSummary, nextHandles] = await Promise.all([fetchStats(), fetchAdminHandles()])
    summary.value = nextSummary
    handles.value = nextHandles
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
      <p>Daily unique wallets, app opens, and claimed handles.</p>
    </header>

    <div v-if="state === 'connect'" class="hint">
      <button type="button" class="nq-button" data-connect @click="onConnect">{{ connectLabel }}</button>
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
        <div class="total-card">
          <span class="total-value" data-handles-total>{{ summary.unique_handles }}</span>
          <span class="total-label">Claimed handles</span>
        </div>
      </div>

      <AdminStatsChart :days="summary.days" />

      <details class="daily-table-disclosure" data-daily-table>
        <summary>View daily table</summary>
        <div class="daily-table-wrap">
          <table class="stats-table">
            <thead>
              <tr><th>Day</th><th>Wallets</th><th>Opens</th><th>Handles claimed</th></tr>
            </thead>
            <tbody>
              <tr v-for="d in [...summary.days].reverse()" :key="d.day" data-day-row>
                <td>{{ d.day }}</td>
                <td>{{ d.wallets }}</td>
                <td>{{ d.opens }}</td>
                <td data-handles>{{ d.handles }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <section class="handle-directory" aria-labelledby="handle-directory-heading">
        <div class="directory-heading">
          <div>
            <h2 id="handle-directory-heading">Current handles ({{ handles.length }})</h2>
            <p>Current winning claims from the on-chain registry.</p>
          </div>
          <input
            v-if="handles.length"
            v-model="handleQuery"
            class="directory-search"
            type="search"
            placeholder="Search handle or wallet"
            aria-label="Search current handles"
            data-handle-search
          >
        </div>

        <p v-if="!handles.length" class="directory-empty">No handles are currently claimed.</p>
        <p v-else-if="!filteredHandles.length" class="directory-empty">No matching handles.</p>

        <div v-else class="directory-table-wrap">
          <table class="stats-table directory-table">
            <thead>
              <tr>
                <th
                  v-for="col in sortColumns"
                  :key="col.key"
                  :aria-sort="sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'"
                >
                  <button
                    type="button"
                    class="sort-button"
                    :data-sort="col.key"
                    @click="setSort(col.key)"
                  >
                    {{ col.label }}
                    <span v-if="sortKey === col.key" class="sort-indicator" aria-hidden="true">
                      {{ sortDir === 'asc' ? '↑' : '↓' }}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="claim in filteredHandles" :key="claim.handle" data-handle-row>
                <td>
                  <a
                    :href="publicProfileUrl(claim.handle)"
                    :data-handle-profile="claim.handle"
                  >@{{ claim.handle }}</a>
                </td>
                <td>
                  <span :title="claim.address" :data-handle-address="claim.handle">
                    {{ shortAddress(claim.address) }}
                  </span>
                </td>
                <td>{{ claimDate(claim.claimed_at) }}</td>
                <td>
                  <a
                    :href="transactionExplorerUrl(claim.tx_hash)"
                    target="_blank"
                    rel="noopener noreferrer"
                    :title="claim.tx_hash"
                    :data-handle-tx="claim.handle"
                  >{{ shortHash(claim.tx_hash) }}</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 88px; max-width: 720px; margin: 0 auto; }
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 4px; }
.header p { margin: 0 0 14px; color: var(--text-2); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; margin: 24px 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
.total-card { padding: 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--card); box-shadow: var(--shadow); text-align: center; }
.total-value { display: block; font-size: 22px; font-weight: 700; }
.total-label { display: block; margin-top: 4px; color: var(--text-2); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.stats-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.stats-table th, .stats-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; }
.stats-table th { color: var(--text-2); font-weight: 700; text-transform: uppercase; font-size: 11px; }
.daily-table-disclosure { margin: 4px 0 0; }
.daily-table-disclosure summary { width: fit-content; min-height: 40px; display: flex; align-items: center; color: var(--primary); font-size: 13px; font-weight: 700; cursor: pointer; }
.daily-table-disclosure summary:hover { text-decoration: underline; }
.daily-table-disclosure summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.daily-table-wrap { overflow-x: auto; padding-top: 4px; }
.handle-directory { margin-top: 30px; }
.directory-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.directory-heading h2 { margin: 0; font-size: 18px; }
.directory-heading p { margin: 4px 0 0; color: var(--text-2); font-size: 13px; }
.directory-search { min-height: 40px; width: min(240px, 100%); padding: 8px 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); color: var(--text); font: inherit; }
.directory-search:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.directory-empty { margin: 18px 0; color: var(--text-2); font-size: 14px; }
.directory-table-wrap { overflow-x: auto; }
.directory-table { min-width: 620px; }
.directory-table a { color: var(--primary); font-weight: 600; text-decoration: none; }
.directory-table a:hover { text-decoration: underline; }
.sort-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
}
.sort-button:hover { color: var(--text); }
.sort-button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 4px;
}
.sort-indicator { font-size: 11px; opacity: 0.85; }
@media (max-width: 560px) {
  .directory-heading { align-items: stretch; flex-direction: column; }
  .directory-search { width: 100%; }
}
</style>
