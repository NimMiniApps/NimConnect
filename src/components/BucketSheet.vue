<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import type { Bucket, Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { useBucketsStore, bucketMessage, bucketTotalNim } from '../stores/buckets'
import { makeRequestLink, makePaymentShareLink, shortAddress } from '../services/links'
import { receiveAddress } from '../services/nimiq'
import { sendPaymentRequest, inboxAvailable } from '../services/inbox'
import { shareOrCopy } from '../services/share'
import { celebrateOnce } from '../services/delight'
import ActionSheet from './ActionSheet.vue'
import QrCode from './QrCode.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'
import Identicon from './Identicon.vue'

const props = defineProps<{ open: boolean; bucket: Bucket | null; startInviting?: boolean }>()
const emit = defineEmits<{ close: []; openBucket: [id: string] }>()

const store = useProfilesStore()
const bucketsStore = useBucketsStore()

// Create form state
const name = ref('')
const goal = ref<number | null>(null)
const fiat = ref<{ amount: number; currency: string } | null>(null)
const goalInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const creating = ref(false)
const createdBucket = ref<Bucket | null>(null)

// Detail state
const shareFeedback = ref<'copied' | 'shared' | null>(null)
const sharing = ref(false)
const manualAmount = ref<number | null>(null)
const manualNote = ref('')
const manualInput = ref<InstanceType<typeof CurrencyAmountInput>>()

// Inbox invite state
const selected = ref<Set<string>>(new Set())
const filter = ref('')
const sendingId = ref<string | null>(null)
const sentIds = ref<Set<string>>(new Set())
const sendErrors = ref<Record<string, string>>({})
const sendingAll = ref(false)
const inviteSentNotice = ref<string | null>(null)
const inviteExpanded = ref(true)
const shareExpanded = ref(false)
const managementExpanded = ref(false)
const advancedExpanded = ref(false)
const editing = ref(false)
const editName = ref('')
const editGoal = ref<number | null>(null)
const editFiat = ref<{ amount: number; currency: string } | null>(null)
const editGoalInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const savingEdit = ref(false)

onMounted(() => store.load())

watch(() => props.open, (open) => {
  if (!open) {
    createdBucket.value = null
    shareExpanded.value = false
    managementExpanded.value = false
    advancedExpanded.value = false
    inviteSentNotice.value = null
    return
  }
  void store.load()
  selected.value = new Set()
  filter.value = ''
  sentIds.value = new Set()
  sendErrors.value = {}
  inviteSentNotice.value = null
})

watch(() => props.bucket?.id, () => {
  inviteExpanded.value = true
  shareExpanded.value = false
  managementExpanded.value = false
  advancedExpanded.value = false
  editing.value = false
  inviteSentNotice.value = null
}, { immediate: true })

watch(() => props.bucket?.contributions.length ?? 0, (count) => {
  if (count > 0) advancedExpanded.value = false
})

watch([() => props.startInviting, () => props.bucket?.id], ([startInviting]) => {
  if (startInviting && props.bucket) inviteExpanded.value = true
})

watch(editing, async (open) => {
  if (!open || !props.bucket) return
  editName.value = props.bucket.name
  editGoal.value = props.bucket.goalNim
  editFiat.value = props.bucket.fiatGoal && props.bucket.fiatCurrency
    ? { amount: props.bucket.fiatGoal, currency: props.bucket.fiatCurrency }
    : null
  await nextTick()
  editGoalInput.value?.setNim(props.bucket.goalNim)
})

const inviteable = computed(() => store.sortedContacts.filter(p => p.type === 'person'))

const participants = computed(() =>
  inviteable.value.filter(p => selected.value.has(p.id)),
)

const pickable = computed(() =>
  store.search(filter.value).filter(p => p.type === 'person' && !selected.value.has(p.id)),
)

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

const title = computed(() => {
  if (props.bucket) return props.bucket.name
  if (createdBucket.value) return 'Bucket ready'
  return 'Trip bucket'
})
const sheetTitleProminent = computed(() => !!props.bucket && !editing.value)
const totalNim = computed(() => (props.bucket ? bucketTotalNim(props.bucket) : 0))
const createdProgressLabel = computed(() => {
  const b = createdBucket.value
  if (!b) return ''
  if (b.fiatGoal && b.fiatCurrency) {
    const zero = (0).toLocaleString(undefined, { style: 'currency', currency: b.fiatCurrency })
    const goal = b.fiatGoal.toLocaleString(undefined, { style: 'currency', currency: b.fiatCurrency })
    return `${zero} / ${goal} collected`
  }
  const goal = b.goalNim.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return `0 / ${goal} NIM collected`
})
const shareLabel = computed(() => {
  if (shareFeedback.value === 'copied') return 'Copied!'
  if (shareFeedback.value === 'shared') return 'Shared!'
  return 'Share link'
})
const detailShareLabel = computed(() => {
  if (sharing.value) return 'Sharing…'
  if (shareFeedback.value === 'copied') return 'Copied!'
  if (shareFeedback.value === 'shared') return 'Shared!'
  return 'Share bucket'
})
const inviteContactsLabel = computed(() => {
  const n = inviteable.value.length
  if (!n) return 'Send to NimConnect contacts'
  return `Send to NimConnect contacts · ${n}`
})
const progress = computed(() =>
  props.bucket ? Math.min(100, (totalNim.value / props.bucket.goalNim) * 100) : 0,
)
const goalReached = computed(() =>
  props.bucket ? totalNim.value >= props.bucket.goalNim : false,
)
const contributions = computed(() =>
  props.bucket ? [...props.bucket.contributions].sort((a, b) => b.at - a.at) : [],
)

function formatFiat(amount: number, currency: string): string {
  return amount.toLocaleString(undefined, { style: 'currency', currency })
}

const detailHeroProgress = computed(() => {
  const b = props.bucket
  if (!b) return { primary: '', goal: '', approx: '' }
  if (b.fiatGoal && b.fiatCurrency) {
    const collected = b.goalNim > 0 ? (totalNim.value / b.goalNim) * b.fiatGoal : 0
    return {
      primary: `${formatFiat(collected, b.fiatCurrency)} / ${formatFiat(b.fiatGoal, b.fiatCurrency)}`,
      goal: formatFiat(b.fiatGoal, b.fiatCurrency),
      approx: `≈ ${b.goalNim.toLocaleString(undefined, { maximumFractionDigits: 2 })} NIM`,
    }
  }
  return {
    primary: `${totalNim.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${b.goalNim.toLocaleString(undefined, { maximumFractionDigits: 2 })} NIM`,
    goal: `${b.goalNim.toLocaleString(undefined, { maximumFractionDigits: 2 })} NIM`,
    approx: '',
  }
})

function contributionAmountLabel(c: Bucket['contributions'][number]): string {
  const b = props.bucket
  if (b?.fiatGoal && b.fiatCurrency && b.goalNim > 0) {
    const fiat = (c.amountNim / b.goalNim) * b.fiatGoal
    return formatFiat(fiat, b.fiatCurrency)
  }
  return `+${c.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 })} NIM`
}

const myAddress = computed(() =>
  store.self ? (receiveAddress(store.self.address) ?? store.self.address) : null,
)
const qrLink = computed(() =>
  (props.bucket ?? createdBucket.value) && myAddress.value
    ? makeRequestLink(myAddress.value, undefined, bucketMessage(props.bucket ?? createdBucket.value!))
    : null,
)

function contributorLabel(c: Bucket['contributions'][number]): string {
  if (c.note) return c.note
  if (c.sender) return store.getByAddress(c.sender)?.name ?? shortAddress(c.sender)
  return 'Manual entry'
}

async function create() {
  if (!goal.value || !name.value.trim()) return
  creating.value = true
  try {
    createdBucket.value = await bucketsStore.create({
      name: name.value,
      goalNim: goal.value,
      fiatGoal: fiat.value?.amount,
      fiatCurrency: fiat.value?.currency,
    })
    name.value = ''
    goal.value = null
    fiat.value = null
    goalInput.value?.reset()
  } finally {
    creating.value = false
  }
}

async function share() {
  const bucket = props.bucket ?? createdBucket.value
  if (!bucket || !myAddress.value || sharing.value) return
  sharing.value = true
  try {
    const link = makePaymentShareLink(myAddress.value, undefined, bucketMessage(bucket))
    const result = await shareOrCopy(link, bucket.name)
    shareFeedback.value = result
    setTimeout(() => (shareFeedback.value = null), 1500)
  } finally {
    sharing.value = false
  }
}

function inviteFriends() {
  const id = createdBucket.value?.id
  if (!id) return
  createdBucket.value = null
  emit('openBucket', id)
}

function bucketPayload(): string | null {
  if (!props.bucket || !store.self) return null
  return makeRequestLink(store.self.address, undefined, bucketMessage(props.bucket))
}

async function sendToInbox(p: Profile) {
  if (!props.bucket || !store.self) return
  const payload = bucketPayload()
  if (!payload) return
  sendingId.value = p.id
  const nextErrors = { ...sendErrors.value }
  delete nextErrors[p.id]
  sendErrors.value = nextErrors
  try {
    await sendPaymentRequest({
      recipient: p.address,
      payload,
      objectId: props.bucket.id,
      sender: store.self.address,
    })
    sentIds.value = new Set([...sentIds.value, p.id])
    await store.touchInteraction(p.id)
  } catch (e) {
    sendErrors.value = {
      ...sendErrors.value,
      [p.id]: e instanceof Error ? e.message : 'Sending failed',
    }
  } finally {
    sendingId.value = null
  }
}

async function sendToSelected() {
  if (!participants.value.length || sendingAll.value) return
  const targets = participants.value.filter(p => !sentIds.value.has(p.id))
  if (!targets.length) return
  sendingAll.value = true
  inviteSentNotice.value = null
  try {
    for (const p of targets) await sendToInbox(p)
    const sent = targets.filter(p => sentIds.value.has(p.id)).length
    if (sent) {
      inviteSentNotice.value = `✓ Requests sent to ${sent} contact${sent === 1 ? '' : 's'}`
      selected.value = new Set([...selected.value].filter(id => !sentIds.value.has(id)))
      setTimeout(() => {
        if (inviteSentNotice.value?.startsWith('✓')) inviteSentNotice.value = null
      }, 3200)
    }
  } finally {
    sendingAll.value = false
  }
}

async function saveEdit() {
  if (!props.bucket || !editGoal.value || !editName.value.trim()) return
  savingEdit.value = true
  try {
    await bucketsStore.update(props.bucket.id, {
      name: editName.value,
      goalNim: editGoal.value,
      fiatGoal: editFiat.value?.amount,
      fiatCurrency: editFiat.value?.currency,
    })
    editing.value = false
  } finally {
    savingEdit.value = false
  }
}

async function addManual() {
  if (!props.bucket || !manualAmount.value) return
  await bucketsStore.addManualContribution(props.bucket.id, {
    amountNim: manualAmount.value,
    note: manualNote.value,
  })
  manualAmount.value = null
  manualNote.value = ''
  manualInput.value?.reset()
}

async function markBucketStatus() {
  if (!props.bucket) return
  const next = props.bucket.status === 'active' ? 'completed' : 'active'
  await bucketsStore.setStatus(props.bucket.id, next)
  if (next === 'completed') celebrateOnce('first-bucket-complete')
}

async function removeBucket() {
  if (!props.bucket) return
  await bucketsStore.remove(props.bucket.id)
  emit('close')
}

function close() {
  createdBucket.value = null
  shareExpanded.value = false
  managementExpanded.value = false
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" :title="title" :prominent-title="sheetTitleProminent" @close="close">
    <!-- Create mode -->
    <form v-if="!bucket && !createdBucket" class="new-bucket" @submit.prevent="create">
      <p class="lead">Collect money for a shared trip.</p>
      <div class="new-fields">
        <input v-model="name" maxlength="48" placeholder="Trip name, e.g. Barcelona 2026" />
        <CurrencyAmountInput
          ref="goalInput"
          placeholder="Goal amount"
          @update:model-value="goal = $event"
          @fiat="fiat = $event"
        />
      </div>
      <button type="submit" class="primary" :disabled="!goal || !name.trim() || creating">
        Create bucket
      </button>
      <p class="hint">
        Friends pay through your share link — contributions are detected automatically.
      </p>
    </form>

    <!-- Setup complete: keep the first share focused before showing management. -->
    <template v-else-if="createdBucket">
      <div class="ready-summary">
        <span class="ready-celebrate" aria-hidden="true">✓</span>
        <p class="ready-eyebrow">Bucket ready</p>
        <h3 class="ready-name">{{ createdBucket.name }}</h3>
        <div class="ready-progress">
          <p class="ready-progress-label">{{ createdProgressLabel }}</p>
          <div class="ready-progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">
            <div class="ready-progress-fill" style="width: 0%" />
          </div>
        </div>
        <p class="hint">
          Share this QR or link. Payments made through it are automatically added to this bucket.
        </p>
      </div>
      <button v-if="store.self" type="button" class="primary ready-share" @click="share">
        {{ shareLabel }}
      </button>
      <button
        v-if="store.self && inboxAvailable()"
        type="button"
        class="secondary ready-invite"
        @click="inviteFriends"
      >
        {{ inviteContactsLabel }}
      </button>
      <QrCode v-if="qrLink" class="ready-qr" :text="qrLink" :size="180" />
      <button type="button" class="secondary ready-done" @click="close">Skip for now</button>
    </template>

    <!-- Detail mode: dashboard for one bucket -->
    <template v-else-if="bucket">
      <section class="detail-hero">
        <template v-if="!editing">
          <p class="detail-type">🏖 Shared Trip</p>
          <p class="detail-collected-label">Collected</p>
          <p class="detail-progress">{{ detailHeroProgress.primary }}</p>
          <div
            class="progress-bar detail-progress-bar"
            role="progressbar"
            :aria-valuenow="Math.round(progress)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${Math.round(progress)} percent collected`"
          >
            <div class="progress-fill" :style="{ width: `${Math.max(progress, 0)}%` }" />
          </div>
          <div class="progress-meta">
            <span>{{ Math.round(progress) }}%</span>
            <span>Goal {{ detailHeroProgress.goal }}</span>
          </div>
          <p v-if="detailHeroProgress.approx" class="detail-approx">{{ detailHeroProgress.approx }}</p>
          <p v-if="bucket.status === 'active' && goalReached" class="goal-reached-hint">
            Goal reached{{ totalNim > bucket.goalNim ? ' (and then some)' : '' }} — open Bucket settings to raise the goal.
          </p>
        </template>
        <form v-else class="edit-form" @submit.prevent="saveEdit">
          <p class="edit-label">Edit bucket</p>
          <div class="new-fields">
            <input v-model="editName" maxlength="48" placeholder="Trip name" />
            <CurrencyAmountInput
              ref="editGoalInput"
              placeholder="Goal amount"
              @update:model-value="editGoal = $event"
              @fiat="editFiat = $event"
            />
          </div>
          <div class="edit-actions">
            <button type="submit" class="primary" :disabled="!editGoal || !editName.trim() || savingEdit">
              {{ savingEdit ? 'Saving…' : 'Save' }}
            </button>
            <button type="button" class="secondary" @click="editing = false">Cancel</button>
          </div>
          <p class="edit-note">Share links update with the new name — the bucket tag stays the same.</p>
        </form>
      </section>

      <p v-if="!store.self" class="hint">Connect inside Nimiq Pay first — contributions are paid to your address.</p>

      <div v-if="bucket.status === 'active' && store.self && !editing" class="detail-actions">
        <button type="button" class="primary detail-share" :disabled="sharing" @click="share">
          {{ detailShareLabel }}
        </button>
        <button type="button" class="secondary" @click="shareExpanded = !shareExpanded">
          {{ shareExpanded ? 'Hide QR' : 'Show QR' }}
        </button>
      </div>

      <Transition name="reveal">
        <div v-if="bucket.status === 'active' && store.self && !editing && shareExpanded" class="reveal-block">
          <QrCode v-if="qrLink" class="detail-qr" :text="qrLink" :size="180" />
          <p class="pay-hint">Contributor: tap Scan in the bottom bar and scan this QR — don't edit the message.</p>
        </div>
      </Transition>

      <section
        v-if="bucket.status === 'active' && store.self && inboxAvailable() && !editing"
        class="detail-card invite-card"
      >
        <button type="button" class="card-head" @click="inviteExpanded = !inviteExpanded">
          <span class="card-title">Invite NimConnect contacts</span>
          <span class="card-toggle">{{ inviteExpanded ? 'Hide' : 'Show' }}</span>
        </button>
        <Transition name="reveal">
          <div v-if="inviteExpanded" class="reveal-block">
            <p class="invite-hint">They get a request in NimConnect — any amount, tagged for this bucket.</p>
            <input
              v-if="inviteable.length"
              v-model="filter"
              type="search"
              class="filter-input"
              placeholder="Search contacts…"
            />
            <div class="invite-list">
              <label v-for="p in participants" :key="p.id" class="person-row selected">
                <input type="checkbox" class="person-check" checked @change="toggle(p.id)" />
                <Identicon :address="p.address" :size="44" />
                <span class="person-name">{{ p.name }}</span>
                <span v-if="sentIds.has(p.id)" class="sent-mark" aria-label="Sent">✓</span>
                <span v-else-if="sendErrors[p.id]" class="send-err-mark">!</span>
              </label>
              <label v-for="p in pickable" :key="p.id" class="person-row">
                <input type="checkbox" class="person-check soft-check" @change="toggle(p.id); filter = ''" />
                <Identicon :address="p.address" :size="44" />
                <span class="person-name">{{ p.name }}</span>
              </label>
              <p v-if="filter && pickable.length === 0" class="hint left">No matches.</p>
              <p v-if="store.loaded && inviteable.length === 0" class="hint left">
                Add person contacts first to invite them here.
              </p>
            </div>
            <button
              v-if="participants.length"
              type="button"
              class="primary invite-all"
              :disabled="sendingAll || !!sendingId"
              @click="sendToSelected"
            >
              {{ sendingAll ? 'Sending…' : `Send requests (${participants.length})` }}
            </button>
            <p v-if="inviteSentNotice" class="invite-sent" role="status">{{ inviteSentNotice }}</p>
            <p v-for="p in participants.filter(x => sendErrors[x.id])" :key="`err-${p.id}`" class="err">
              {{ p.name }}: {{ sendErrors[p.id] }}
            </p>
          </div>
        </Transition>
      </section>

      <section v-if="!editing" class="detail-card">
        <h4 class="card-title static">Recent contributions</h4>
        <p v-if="contributions.length === 0" class="empty-contributions">
          No contributions yet.<br />
          Share your bucket with friends to start collecting toward your goal.
        </p>
        <div v-else class="list">
          <div v-for="c in contributions" :key="c.id" class="contribution">
            <Identicon v-if="c.sender" :address="c.sender" :size="32" />
            <span v-else class="manual-dot">✎</span>
            <span class="who">{{ contributorLabel(c) }}<span class="when"> · {{ new Date(c.at).toLocaleDateString() }}</span></span>
            <span class="amount">{{ contributionAmountLabel(c) }}</span>
          </div>
        </div>
      </section>

      <section v-if="!editing" class="detail-card">
        <button type="button" class="card-head" @click="managementExpanded = !managementExpanded">
          <span class="card-title">Bucket settings</span>
          <span class="card-toggle">{{ managementExpanded ? 'Hide' : 'Show' }}</span>
        </button>
        <Transition name="reveal">
          <div v-if="managementExpanded" class="settings-list reveal-block">
            <button
              v-if="bucket.status === 'active'"
              type="button"
              class="settings-row"
              @click="editing = true"
            >
              <span>✏️ Edit bucket</span>
            </button>
            <button
              type="button"
              class="settings-row"
              @click="markBucketStatus"
            >
              <span>{{ bucket.status === 'active' ? '✅ Mark complete' : '↩ Reopen' }}</span>
            </button>
            <div class="settings-divider" role="separator" />
            <button type="button" class="settings-row settings-danger" @click="removeBucket">
              <span>🗑 Delete bucket</span>
            </button>
          </div>
        </Transition>
      </section>

      <section v-if="bucket.status === 'active' && !editing" class="detail-card advanced-card">
        <button type="button" class="card-head" @click="advancedExpanded = !advancedExpanded">
          <span class="card-title">Advanced</span>
          <span class="card-toggle">{{ advancedExpanded ? '▲' : '▼' }} Add manual contribution</span>
        </button>
        <Transition name="reveal">
          <form v-if="advancedExpanded" class="manual-add reveal-block" @submit.prevent="addManual">
            <p class="manual-label">For cash, or when the payer edited the message:</p>
            <div class="new-fields">
              <CurrencyAmountInput
                ref="manualInput"
                placeholder="Amount"
                @update:model-value="manualAmount = $event"
              />
              <input v-model="manualNote" maxlength="48" placeholder="From whom? (optional)" />
            </div>
            <button type="submit" class="secondary" :disabled="!manualAmount">Add contribution</button>
          </form>
        </Transition>
      </section>
    </template>
  </ActionSheet>
</template>

<style scoped>
.new-bucket, .manual-add { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.manual-add { margin-top: 16px; }
.lead {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-2);
  text-align: center;
  line-height: 1.35;
}
.ready-summary { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 14px; text-align: center; }
.ready-celebrate {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 800;
  color: var(--nimiq-white);
  background: var(--nimiq-green-bg);
  animation: ready-pop 0.45s var(--nimiq-ease) both;
}
@keyframes ready-pop {
  0% { transform: scale(0.6); opacity: 0; }
  70% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.ready-eyebrow {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ready-name {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--text);
}
.ready-progress {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius);
  background: var(--bg);
  border: 1px solid var(--border);
  text-align: left;
}
.ready-progress-label {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}
.ready-progress-bar {
  height: 10px;
  border-radius: 5px;
  background: var(--text-6);
  overflow: hidden;
}
.ready-progress-fill {
  height: 100%;
  border-radius: 5px;
  background: var(--nimiq-gold-bg);
}
.ready-share, .ready-invite, .ready-done { width: 100%; margin-top: 14px; }
.ready-invite { margin-top: 8px; }
.ready-qr { margin: 16px auto 0; display: block; }
.ready-done { margin-top: 12px; }
.manual-label { margin: 0; font-size: 12px; font-weight: 700; color: var(--text-2); }
.new-fields { display: flex; flex-direction: column; gap: 8px; }
.new-fields input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.primary {
  height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-blue);
  background: var(--nimiq-gold-bg);
  transition: transform var(--attr-duration) var(--nimiq-ease), opacity var(--attr-duration) var(--nimiq-ease);
}
.primary:active:not(:disabled) { transform: scale(0.98); }
.primary:disabled { opacity: 0.5; }
.detail-hero {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
  text-align: left;
}
.detail-type {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  opacity: 0.72;
  letter-spacing: 0.02em;
}
.detail-collected-label {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-2);
}
.detail-progress {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}
.progress-bar {
  height: 8px;
  border-radius: 999px;
  background: var(--text-6);
  overflow: hidden;
  margin: 2px 0;
}
.detail-progress-bar {
  height: 8px;
  border-radius: 999px;
  margin: 6px 0 2px;
  background: color-mix(in srgb, var(--text-6) 92%, var(--nq-gold));
}
.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--nimiq-gold-bg);
  transition: width 0.55s var(--nimiq-ease);
  min-width: 0;
}
.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}
.detail-approx { margin: 0; font-size: 12px; color: var(--text-2); font-weight: 600; }
.reveal-enter-active,
.reveal-leave-active {
  transition: opacity var(--movement-duration) var(--nimiq-ease), transform var(--movement-duration) var(--nimiq-ease);
}
.reveal-enter-from,
.reveal-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.reveal-block { display: flex; flex-direction: column; gap: 10px; }
.goal-reached-hint { margin: 0; font-size: 13px; color: var(--nq-green); font-weight: 600; }
.edit-form { display: flex; flex-direction: column; gap: 10px; }
.edit-label { margin: 0; font-size: 13px; font-weight: 700; color: var(--text-2); }
.edit-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.edit-note { margin: 0; font-size: 12px; color: var(--text-2); }
.pay-hint { margin: 8px 0 0; font-size: 12px; color: var(--text-2); text-align: center; }
.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.detail-share { width: 100%; }
.detail-actions .secondary { width: 100%; }
.detail-qr { margin: 0 auto 8px; display: block; }
.secondary {
  min-height: 44px; padding: 0 16px; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
.secondary:disabled { opacity: 0.5; }
.detail-card {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.invite-card { border-color: color-mix(in srgb, var(--nq-light-blue) 22%, var(--border)); }
.card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; padding: 0; border: none; background: none; cursor: pointer; font: inherit; text-align: left;
}
.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
}
.card-title.static { margin-bottom: 2px; }
.card-toggle { font-size: 13px; font-weight: 700; color: var(--nq-light-blue); flex: 0 0 auto; }
.invite-hint { margin: 0; font-size: 13px; color: var(--text-2); text-align: left; }
.invite-list { display: flex; flex-direction: column; gap: 2px; }
.person-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 2px 0;
  cursor: pointer;
}
.person-check {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  accent-color: var(--nq-light-blue);
}
.person-check.soft-check { opacity: 0.28; }
.person-row:hover .person-check.soft-check,
.person-row.selected .person-check { opacity: 1; }
.person-name { flex: 1; font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.invite-sent {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--nq-green) 12%, var(--card));
  color: var(--nq-green);
  font-size: 14px;
  font-weight: 700;
  text-align: left;
}
.filter-input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill); background: var(--card); color: var(--text);
}
.sent-mark {
  flex: 0 0 auto;
  color: var(--nq-green);
  font-weight: 800;
  font-size: 16px;
}
.send-err-mark {
  flex: 0 0 auto;
  color: var(--nq-red);
  font-weight: 800;
}
.invite-all { width: 100%; margin-top: 4px; }
.err { margin: 0; color: var(--nq-red); font-size: 13px; text-align: left; }
.empty-contributions {
  margin: 0;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.45;
  text-align: left;
}
.list { display: flex; flex-direction: column; gap: 8px; }
.contribution {
  display: flex; align-items: center; gap: 10px;
  min-height: 44px; padding: 6px 0;
}
.manual-dot {
  width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--text-6); color: var(--text-2);
}
.who { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { color: var(--text-2); font-weight: 400; font-size: 12px; }
.amount { font-weight: 700; color: var(--nq-green); }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.hint.left { text-align: left; }
.settings-list { display: flex; flex-direction: column; gap: 4px; }
.settings-row {
  display: flex; align-items: center; min-height: 44px; padding: 0 4px;
  border: none; background: none; cursor: pointer; font: inherit; font-weight: 700;
  color: var(--text); text-align: left;
}
.settings-divider {
  height: 1px;
  margin: 14px 0 8px;
  background: var(--border);
}
.settings-danger {
  margin-top: 4px;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--nq-red);
  font-weight: 800;
}
.advanced-card .card-toggle { font-size: 12px; font-weight: 600; color: var(--text-2); }
</style>
