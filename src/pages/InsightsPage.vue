<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useProfilesStore } from '../stores/profiles'
import { fetchInsights, monthInsights, type InsightsData } from '../services/insights'
import { resolveMyAddresses } from '../services/nimiq'
import { getRates, nimToFiat, type NimRates } from '../services/rates'
import { preferredCurrency } from '../services/prefs'
import EmptyState from '../components/EmptyState.vue'

const profilesStore = useProfilesStore()
const data = ref<InsightsData | null>(null)
const error = ref(false)
const rates = ref<NimRates | null>(null)

const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth())

onMounted(async () => {
  await profilesStore.load()
  getRates().then(r => (rates.value = r))
  if (!profilesStore.self) return
  try {
    data.value = await fetchInsights(await resolveMyAddresses(profilesStore.self.address))
  } catch {
    error.value = true
  }
})

const stats = computed(() =>
  data.value ? monthInsights(data.value.txs, profilesStore.profiles, year.value, month.value) : null,
)

const monthLabel = computed(() =>
  new Date(year.value, month.value, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
)

const isCurrentMonth = computed(() =>
  year.value === now.getFullYear() && month.value === now.getMonth(),
)

/** Months before the coverage boundary would show silently incomplete data — block them. */
const atCoverageFloor = computed(() => {
  if (!data.value?.coverageFrom) return false
  const prevMonthEnd = new Date(year.value, month.value, 1).getTime()
  return prevMonthEnd <= data.value.coverageFrom
})

const coverageNote = computed(() => {
  if (!data.value?.coverageFrom) return null
  return `History before ${new Date(data.value.coverageFrom).toLocaleDateString()} is not available.`
})

function shift(delta: number) {
  const d = new Date(year.value, month.value + delta, 1)
  year.value = d.getFullYear()
  month.value = d.getMonth()
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })

function fiatApprox(nim: number): string | null {
  if (preferredCurrency.value === 'NIM' || !rates.value || !nim) return null
  const amount = nimToFiat(nim, preferredCurrency.value, rates.value)
  if (amount == null) return null
  return `≈ ${amount.toLocaleString(undefined, { style: 'currency', currency: preferredCurrency.value })}`
}

const maxTagVolume = computed(() =>
  Math.max(1, ...(stats.value?.tags.map(t => t.sentNim + t.receivedNim) ?? [])),
)

function contactLabel(c: { name: string | null }): string {
  return c.name ?? 'Others (unknown addresses)'
}
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Insights</h1>
      <p>Where your NIM goes, by contact and tag.</p>
    </header>

    <p v-if="!profilesStore.self" class="hint">Connect inside Nimiq Pay to see your spending insights.</p>
    <p v-else-if="error" class="hint">Insights are unavailable right now.</p>
    <p v-else-if="!stats" class="hint">Loading…</p>

    <template v-else>
      <div class="month-nav">
        <button type="button" class="month-btn" :disabled="atCoverageFloor" @click="shift(-1)">‹</button>
        <span class="month-label">{{ monthLabel }}</span>
        <button type="button" class="month-btn" :disabled="isCurrentMonth" @click="shift(1)">›</button>
      </div>

      <div class="totals">
        <div class="total-card out">
          <span class="total-value">−{{ fmt(stats.sentNim) }}</span>
          <span class="total-label">NIM sent</span>
          <span v-if="fiatApprox(stats.sentNim)" class="total-fiat">{{ fiatApprox(stats.sentNim) }}</span>
        </div>
        <div class="total-card in">
          <span class="total-value">+{{ fmt(stats.receivedNim) }}</span>
          <span class="total-label">NIM received</span>
          <span v-if="fiatApprox(stats.receivedNim)" class="total-fiat">{{ fiatApprox(stats.receivedNim) }}</span>
        </div>
      </div>

      <EmptyState
        v-if="!stats.contacts.length"
        icon="📊"
        title="No activity this month"
        hint="Payments you send and receive show up here."
      />

      <template v-else>
        <section class="section">
          <h2>Top contacts</h2>
          <ul class="rows">
            <li v-for="c in stats.contacts.slice(0, 5)" :key="c.profileId ?? 'others'" class="row">
              <router-link v-if="c.profileId" :to="`/profile/${c.profileId}`" class="row-name">{{ contactLabel(c) }}</router-link>
              <span v-else class="row-name plain">{{ contactLabel(c) }}</span>
              <span class="row-amounts">
                <span v-if="c.sentNim" class="out">−{{ fmt(c.sentNim) }}</span>
                <span v-if="c.receivedNim" class="in">+{{ fmt(c.receivedNim) }}</span>
              </span>
            </li>
          </ul>
        </section>

        <section v-if="stats.tags.length" class="section">
          <h2>By tag</h2>
          <p class="tag-note">Contacts with several tags count under each — bars overlap.</p>
          <ul class="rows">
            <li v-for="t in stats.tags" :key="t.tag" class="tag-row">
              <span class="row-name plain">{{ t.tag }}</span>
              <span class="row-amounts">
                <span v-if="t.sentNim" class="out">−{{ fmt(t.sentNim) }}</span>
                <span v-if="t.receivedNim" class="in">+{{ fmt(t.receivedNim) }}</span>
              </span>
              <span class="tag-bar"><span class="tag-fill" :style="{ width: `${((t.sentNim + t.receivedNim) / maxTagVolume) * 100}%` }" /></span>
            </li>
          </ul>
        </section>
      </template>

      <p v-if="coverageNote" class="hint coverage">{{ coverageNote }}</p>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 88px; max-width: 100%; }
.header h1 { font-size: 24px; line-height: 1.2; margin: 8px 0 4px; }
.header p { margin: 0 0 14px; color: var(--text-2); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; margin: 24px 0; }
.hint.coverage { font-size: 12px; margin: 16px 0 0; }
.month-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.month-label { font-weight: 800; font-size: 15px; }
.month-btn {
  min-width: 44px; min-height: 44px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill);
  background: var(--card); color: var(--nq-light-blue); font-size: 18px; cursor: pointer;
}
.month-btn:disabled { opacity: 0.4; cursor: default; }
.totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
.total-card {
  padding: 14px; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--card); box-shadow: var(--shadow);
}
.total-value { display: block; font-size: 22px; font-weight: 700; }
.total-card.out .total-value { color: var(--nq-gold-dark); }
.total-card.in .total-value { color: var(--nq-green); }
.total-label { display: block; margin-top: 4px; color: var(--text-2); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.total-fiat { display: block; margin-top: 2px; font-size: 12px; font-weight: 600; color: var(--text-2); }
.section { margin-top: 18px; }
.section h2 { margin: 0 0 8px; font-size: 13px; font-weight: 700; color: var(--text-2); text-transform: uppercase; }
.tag-note { margin: 0 0 8px; font-size: 12px; color: var(--text-2); }
.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.row, .tag-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); }
.row-name { flex: 1; min-width: 0; font-weight: 700; color: var(--nq-light-blue); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-name.plain { color: var(--text); }
.row-amounts { display: flex; gap: 10px; font-weight: 700; font-size: 13px; }
.row-amounts .out { color: var(--nq-gold-dark); }
.row-amounts .in { color: var(--nq-green); }
.tag-bar { flex-basis: 100%; height: 6px; border-radius: 3px; background: var(--text-6); overflow: hidden; }
.tag-fill { display: block; height: 100%; border-radius: 3px; background: var(--nimiq-gold-bg); }
</style>
