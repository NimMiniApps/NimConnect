<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DayStats } from '../services/adminAuth'

type MetricKey = 'opens' | 'wallets' | 'handles'

const props = defineProps<{
  days: DayStats[]
}>()

const metrics: Array<{ key: MetricKey; label: string }> = [
  { key: 'opens', label: 'Opens' },
  { key: 'wallets', label: 'Wallets' },
  { key: 'handles', label: 'Handles' },
]

const chartWidth = 720
const chartHeight = 260
const plotLeft = 44
const plotRight = 704
const plotTop = 22
const plotBottom = 206

const selectedMetric = ref<MetricKey>('opens')
const activeIndex = ref(29)

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseUtcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseUtcDay(day))
}

function formatShortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parseUtcDay(day))
}

const normalizedDays = computed<DayStats[]>(() => {
  if (!props.days.length) return []

  const orderedDays = [...props.days].sort((a, b) => a.day.localeCompare(b.day))
  const newestDay = orderedDays[orderedDays.length - 1]!.day
  const newestDate = parseUtcDay(newestDay)
  const byDay = new Map(props.days.map(day => [day.day, day]))

  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(newestDate)
    date.setUTCDate(newestDate.getUTCDate() - (29 - index))
    const day = utcDay(date)
    return byDay.get(day) ?? { day, wallets: 0, opens: 0, handles: 0 }
  })
})

const metric = computed(() => metrics.find(item => item.key === selectedMetric.value)!)
const maxValue = computed(() =>
  Math.max(1, ...normalizedDays.value.map(day => day[selectedMetric.value])),
)
const points = computed(() =>
  normalizedDays.value.map((day, index) => {
    const value = day[selectedMetric.value]
    const x = plotLeft + (index / Math.max(1, normalizedDays.value.length - 1)) * (plotRight - plotLeft)
    const y = plotBottom - (value / maxValue.value) * (plotBottom - plotTop)
    return { day: day.day, value, x, y }
  }),
)
const linePoints = computed(() => points.value.map(point => `${point.x},${point.y}`).join(' '))
const areaPoints = computed(() =>
  `${plotLeft},${plotBottom} ${linePoints.value} ${plotRight},${plotBottom}`,
)
const labelPoints = computed(() => [0, 7, 14, 21, 29].map(index => points.value[index]).filter(Boolean))
const activePoint = computed(() =>
  points.value[Math.min(activeIndex.value, Math.max(0, points.value.length - 1))],
)

watch(normalizedDays, days => {
  activeIndex.value = Math.max(0, days.length - 1)
})

function selectMetric(key: MetricKey) {
  selectedMetric.value = key
  activeIndex.value = Math.max(0, normalizedDays.value.length - 1)
}
</script>

<template>
  <section class="chart-card" aria-labelledby="admin-chart-heading">
    <div class="chart-head">
      <div>
        <h2 id="admin-chart-heading">Daily trend</h2>
        <p>Latest 30 calendar days</p>
      </div>
      <div class="metric-tabs" role="group" aria-label="Chart metric">
        <button
          v-for="item in metrics"
          :key="item.key"
          type="button"
          :aria-pressed="selectedMetric === item.key"
          :data-chart-metric="item.key"
          @click="selectMetric(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <p v-if="!normalizedDays.length" class="chart-empty" data-chart-empty>No daily stats yet.</p>

    <template v-else>
      <svg
        class="chart"
        :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
        role="img"
        :aria-label="`Daily ${metric.label.toLowerCase()} for the latest 30 calendar days`"
        data-chart
      >
        <defs>
          <linearGradient id="admin-stats-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--primary)" stop-opacity=".28" />
            <stop offset="100%" stop-color="var(--primary)" stop-opacity=".02" />
          </linearGradient>
        </defs>

        <line class="chart-guide" :x1="plotLeft" :x2="plotRight" :y1="plotTop" :y2="plotTop" />
        <line class="chart-guide chart-baseline" :x1="plotLeft" :x2="plotRight" :y1="plotBottom" :y2="plotBottom" />
        <text class="axis-value" :x="plotLeft - 8" :y="plotTop + 4" text-anchor="end">{{ maxValue }}</text>
        <text class="axis-value" :x="plotLeft - 8" :y="plotBottom + 4" text-anchor="end">0</text>

        <polygon class="chart-area" :points="areaPoints" />
        <polyline class="chart-line" :points="linePoints" />

        <g v-for="(point, index) in points" :key="point.day">
          <circle
            class="chart-hit"
            :class="{ active: activeIndex === index }"
            :cx="point.x"
            :cy="point.y"
            r="7"
            tabindex="0"
            role="button"
            :aria-label="`${formatDay(point.day)}: ${point.value} ${metric.label.toLowerCase()}`"
            :data-day="point.day"
            :data-value="point.value"
            data-chart-point
            @focus="activeIndex = index"
            @mouseenter="activeIndex = index"
            @click="activeIndex = index"
          >
            <title>{{ formatDay(point.day) }}: {{ point.value }} {{ metric.label.toLowerCase() }}</title>
          </circle>
        </g>

        <text
          v-for="point in labelPoints"
          :key="`label-${point.day}`"
          class="axis-date"
          :x="point.x"
          :y="plotBottom + 28"
          text-anchor="middle"
        >
          {{ formatShortDay(point.day) }}
        </text>
      </svg>

      <p v-if="activePoint" class="chart-tooltip" aria-live="polite" data-chart-tooltip>
        <strong>{{ formatDay(activePoint.day) }}</strong>
        <span>{{ activePoint.value }} {{ metric.label.toLowerCase() }}</span>
      </p>
    </template>
  </section>
</template>

<style scoped>
.chart-card { margin: 0 0 18px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); box-shadow: var(--shadow); }
.chart-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.chart-head h2 { margin: 0; font-size: 18px; }
.chart-head p { margin: 3px 0 0; color: var(--text-2); font-size: 12px; }
.metric-tabs { display: inline-grid; grid-template-columns: repeat(3, 1fr); padding: 3px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); }
.metric-tabs button { min-height: 40px; padding: 6px 12px; border: 0; border-radius: 7px; background: transparent; color: var(--text-2); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.metric-tabs button[aria-pressed="true"] { background: var(--primary); color: white; }
.metric-tabs button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.chart { display: block; width: 100%; height: auto; overflow: visible; color: var(--primary); }
.chart-guide { stroke: var(--border); stroke-width: 1; stroke-dasharray: 4 5; }
.chart-baseline { stroke-dasharray: none; }
.chart-area { fill: url(#admin-stats-area); }
.chart-line { fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.chart-hit { fill: var(--card); stroke: currentColor; stroke-width: 3; cursor: pointer; vector-effect: non-scaling-stroke; }
.chart-hit.active, .chart-hit:focus { fill: currentColor; outline: none; }
.axis-value, .axis-date { fill: var(--text-2); font-size: 11px; }
.chart-tooltip { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -4px 2px 0 42px; color: var(--text-2); font-size: 13px; }
.chart-tooltip strong { color: var(--text); }
.chart-empty { margin: 30px 0; color: var(--text-2); text-align: center; font-size: 14px; }
@media (max-width: 560px) {
  .chart-head { align-items: stretch; flex-direction: column; }
  .metric-tabs { width: 100%; }
  .chart-tooltip { margin-left: 0; }
}
</style>
