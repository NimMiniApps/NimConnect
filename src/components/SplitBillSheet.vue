<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { makeRequestLink, nimToLunas } from '../services/links'
import { splitAmount } from '../utils/split'
import ActionSheet from './ActionSheet.vue'
import Identicon from './Identicon.vue'
import QrCode from './QrCode.vue'

const props = defineProps<{ profile: Profile; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useProfilesStore()

const total = ref<number | null>(null)
const note = ref('')
const includeMe = ref(true)
const selected = ref<Set<string>>(new Set([props.profile.id]))
const shares = ref<Record<string, number>>({})
const expandedId = ref<string | null>(null)
const copiedId = ref<string | null>(null)

const participants = computed(() =>
  store.sortedContacts.filter(p => selected.value.has(p.id)),
)

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

// Recompute equal shares whenever total or the participant set changes;
// manual edits below override until the next recompute.
watch([total, selected, includeMe], () => {
  const n = participants.value.length + (includeMe.value ? 1 : 0)
  if (!total.value || n === 0) {
    shares.value = {}
    return
  }
  const parts = splitAmount(total.value, n)
  const next: Record<string, number> = {}
  // My share (when included) takes the first slot so contacts get the smaller remainders
  participants.value.forEach((p, i) => { next[p.id] = parts[i + (includeMe.value ? 1 : 0)] })
  shares.value = next
})

const contactsSumLunas = computed(() =>
  participants.value.reduce((s, p) => s + nimToLunas(shares.value[p.id] ?? 0), 0),
)
const myShareNim = computed(() => {
  if (!total.value) return 0
  return (nimToLunas(total.value) - contactsSumLunas.value) / 1e5
})
const valid = computed(() => {
  if (!total.value || participants.value.length === 0) return false
  if (participants.value.some(p => !((shares.value[p.id] ?? 0) > 0))) return false
  if (includeMe.value) return myShareNim.value >= 0
  return contactsSumLunas.value === nimToLunas(total.value)
})

function linkFor(p: Profile): string {
  const me = store.self?.name && store.self.name !== 'Me' ? ` to ${store.self.name}` : ''
  return makeRequestLink(
    store.self?.address ?? p.address,
    shares.value[p.id],
    `Split${note.value.trim() ? `: ${note.value.trim()}` : ''}${me}`,
  )
}

async function copyLink(p: Profile) {
  await navigator.clipboard.writeText(linkFor(p))
  copiedId.value = p.id
  setTimeout(() => (copiedId.value = null), 1500)
  await store.touchInteraction(p.id)
}

function close() {
  total.value = null
  note.value = ''
  includeMe.value = true
  selected.value = new Set([props.profile.id])
  expandedId.value = null
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" title="Split a bill" @close="close">
    <p v-if="!store.self" class="hint">Connect inside Nimiq Pay first — split requests are paid to your address.</p>
    <template v-else>
      <label class="amount-label">
        Total (NIM)
        <input v-model.number="total" type="number" min="0.00001" step="any" placeholder="0.00" />
      </label>
      <label class="message-label">
        What for? (optional)
        <input v-model="note" maxlength="40" placeholder="Dinner at Luigi's" />
      </label>

      <div class="who">
        <span class="who-title">Who's in?</span>
        <label class="me-row">
          <input v-model="includeMe" type="checkbox" />
          <span>Include me<template v-if="includeMe && total"> — my share {{ myShareNim }} NIM</template></span>
        </label>
        <label v-for="p in store.sortedContacts" :key="p.id" class="person-row">
          <input type="checkbox" :checked="selected.has(p.id)" @change="toggle(p.id)" />
          <Identicon :address="p.address" :size="32" />
          <span class="person-name">{{ p.name }}</span>
          <input
            v-if="selected.has(p.id) && total"
            class="share-input"
            type="number"
            min="0.00001"
            step="any"
            :value="shares[p.id]"
            @input="shares = { ...shares, [p.id]: Number(($event.target as HTMLInputElement).value) }"
          />
        </label>
      </div>

      <p v-if="total && participants.length && !valid" class="err">
        Shares must be positive and add up to {{ total }} NIM{{ includeMe ? ' (your share covers the rest)' : '' }}.
      </p>

      <template v-if="valid">
        <div class="requests">
          <div v-for="p in participants" :key="p.id" class="request">
            <button type="button" class="request-row" @click="expandedId = expandedId === p.id ? null : p.id">
              <span class="person-name">{{ p.name }}</span>
              <span class="share">{{ shares[p.id] }} NIM</span>
            </button>
            <div v-if="expandedId === p.id" class="request-detail">
              <QrCode :text="linkFor(p)" :size="180" />
              <button type="button" class="secondary" @click="copyLink(p)">
                {{ copiedId === p.id ? 'Copied!' : 'Copy request link' }}
              </button>
            </div>
          </div>
        </div>
        <p class="hint">Show each person their QR, or copy their link into any chat.</p>
      </template>
    </template>
  </ActionSheet>
</template>

<style scoped>
.amount-label, .message-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 12px; }
.amount-label input, .message-label input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text);
}
.amount-label input { font-size: 24px; text-align: center; }
.who { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.who-title { font-size: 13px; font-weight: 700; color: var(--text-2); }
.me-row, .person-row { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.person-name { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.share-input {
  width: 96px; font: inherit; padding: 6px 8px; text-align: right;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text);
}
.requests { display: flex; flex-direction: column; gap: 8px; }
.request-row {
  width: 100%; display: flex; justify-content: space-between; align-items: center;
  min-height: 48px; padding: 0 12px; cursor: pointer;
  border: 1px solid var(--border); border-radius: 12px; background: var(--bg); color: var(--text);
  font: inherit;
}
.share { font-weight: 700; color: var(--nq-gold-dark); }
.request-detail { padding: 12px 0; display: flex; flex-direction: column; gap: 10px; align-items: center; }
.secondary {
  min-height: 44px; padding: 0 20px; border-radius: 22px; cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
</style>
