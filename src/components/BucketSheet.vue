<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import type { Bucket, Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { useBucketsStore, bucketMessage, bucketTotalNim } from '../stores/buckets'
import { makeRequestLink, makePaymentShareLink, shortAddress } from '../services/links'
import { receiveAddress } from '../services/nimiq'
import { sendPaymentRequest, inboxAvailable } from '../services/inbox'
import { shareOrCopy, canShare } from '../services/share'
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
const copied = ref(false)
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
const inviteExpanded = ref(false)
const shareExpanded = ref(false)
const managementExpanded = ref(false)
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
    return
  }
  void store.load()
  selected.value = new Set()
  filter.value = ''
  sentIds.value = new Set()
  sendErrors.value = {}
})

watch(() => props.bucket?.id, () => {
  inviteExpanded.value = false
  shareExpanded.value = false
  managementExpanded.value = false
  editing.value = false
}, { immediate: true })

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
  return 'New trip bucket'
})
const totalNim = computed(() => (props.bucket ? bucketTotalNim(props.bucket) : 0))
const progress = computed(() =>
  props.bucket ? Math.min(100, (totalNim.value / props.bucket.goalNim) * 100) : 0,
)
const goalReached = computed(() =>
  props.bucket ? totalNim.value >= props.bucket.goalNim : false,
)
const contributions = computed(() =>
  props.bucket ? [...props.bucket.contributions].sort((a, b) => b.at - a.at) : [],
)

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
  if (!bucket || !myAddress.value) return
  const link = makePaymentShareLink(myAddress.value, undefined, bucketMessage(bucket))
  const result = await shareOrCopy(link, bucket.name)
  if (result === 'copied') {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
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
  sendingAll.value = true
  try {
    for (const p of participants.value) {
      if (!sentIds.value.has(p.id)) await sendToInbox(p)
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
  <ActionSheet :open="open" :title="title" @close="close">
    <!-- Create mode -->
    <form v-if="!bucket && !createdBucket" class="new-bucket" @submit.prevent="create">
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
        Friends pay through your share link — contributions carrying the bucket tag are
        detected automatically.
      </p>
    </form>

    <!-- Setup complete: keep the first share focused before showing management. -->
    <template v-else-if="createdBucket">
      <div class="ready-summary">
        <span class="ready-icon" aria-hidden="true">🪣</span>
        <p class="ready-title">{{ createdBucket.name }} is ready.</p>
        <p class="hint">Share this code so contributions are tagged and counted automatically.</p>
      </div>
      <QrCode v-if="qrLink" :text="qrLink" :size="200" />
      <button v-if="store.self" type="button" class="primary ready-share" @click="share">
        {{ copied ? 'Copied!' : canShare() ? 'Share bucket' : 'Copy link' }}
      </button>
      <button
        v-if="store.self && inboxAvailable()"
        type="button"
        class="secondary ready-invite"
        @click="inviteFriends"
      >
        Invite friends in NimConnect
      </button>
      <button type="button" class="secondary ready-done" @click="close">Skip for now</button>
    </template>

    <!-- Detail mode -->
    <template v-else-if="bucket">
      <div class="progress-wrap">
        <template v-if="!editing">
          <div class="progress-head">
            <div class="progress-numbers">
              <strong>{{ totalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</strong>
              <span> / {{ bucket.goalNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM</span>
              <span v-if="bucket.fiatGoal" class="fiat-goal">(goal {{ bucket.fiatGoal }} {{ bucket.fiatCurrency }})</span>
            </div>
          </div>
          <div class="progress-bar" role="progressbar" :aria-valuenow="Math.round(progress)" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-fill" :style="{ width: `${progress}%` }" />
          </div>
          <p v-if="bucket.status === 'active' && goalReached" class="goal-reached-hint">
            Goal reached{{ totalNim > bucket.goalNim ? ' (and then some)' : '' }} — tap Raise goal if you're still collecting.
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
            <button type="submit" class="secondary" :disabled="!editGoal || !editName.trim() || savingEdit">
              {{ savingEdit ? 'Saving…' : 'Save' }}
            </button>
            <button type="button" class="secondary" @click="editing = false">Cancel</button>
          </div>
          <p class="edit-note">Share links update with the new name — the bucket tag stays the same.</p>
        </form>
      </div>

      <p v-if="!store.self" class="hint">Connect inside Nimiq Pay first — contributions are paid to your address.</p>
      <template v-else-if="bucket.status === 'active' && !editing && shareExpanded">
        <QrCode v-if="qrLink" :text="qrLink" :size="180" />
        <p class="pay-hint">Contributor: tap Scan in the bottom bar and scan this QR — don't edit the message.</p>
      </template>

      <div class="detail-actions">
        <button v-if="bucket.status === 'active' && store.self" type="button" class="secondary" @click="share">
          {{ copied ? 'Copied!' : canShare() ? 'Share link' : 'Copy link' }}
        </button>
        <button v-if="bucket.status === 'active' && store.self" type="button" class="secondary" @click="shareExpanded = !shareExpanded">
          {{ shareExpanded ? 'Hide QR' : 'Show QR' }}
        </button>
      </div>

      <section v-if="bucket.status === 'active' && store.self && inboxAvailable()" class="invite-section">
        <button type="button" class="invite-head" @click="inviteExpanded = !inviteExpanded">
          <span class="invite-title">Invite contacts</span>
          <span class="invite-toggle">{{ inviteExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <template v-if="inviteExpanded">
          <p class="invite-hint">They'll get a request in NimConnect — any amount, tagged for this bucket.</p>

          <div class="invite-list">
          <label v-for="p in participants" :key="p.id" class="person-row">
            <input type="checkbox" checked @change="toggle(p.id)" />
            <Identicon :address="p.address" :size="32" />
            <span class="person-name">{{ p.name }}</span>
            <button
              type="button"
              class="send-one"
              :disabled="sendingId === p.id || sendingAll"
              @click="sendToInbox(p)"
            >
              {{ sentIds.has(p.id) ? 'Sent ✓' : sendingId === p.id ? 'Sending…' : sendErrors[p.id] ? 'Retry' : 'Send' }}
            </button>
          </label>

          <input
            v-if="inviteable.length > participants.length"
            v-model="filter"
            type="search"
            class="filter-input"
            placeholder="Search contacts to add…"
          />
          <label v-for="p in pickable" :key="p.id" class="person-row">
            <input type="checkbox" @change="toggle(p.id); filter = ''" />
            <Identicon :address="p.address" :size="32" />
            <span class="person-name">{{ p.name }}</span>
          </label>
          <p v-if="filter && pickable.length === 0" class="hint">No matches.</p>
          <p v-if="store.loaded && inviteable.length === 0" class="hint">
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
            {{ sendingAll ? 'Sending…' : `Send to ${participants.length} contact${participants.length === 1 ? '' : 's'}` }}
          </button>
          <p v-for="p in participants.filter(x => sendErrors[x.id])" :key="`err-${p.id}`" class="err">
            {{ p.name }}: {{ sendErrors[p.id] }}
          </p>
        </template>
        <p v-else-if="contributions.length" class="invite-collapsed-hint">
          {{ contributions.length }} contribution{{ contributions.length === 1 ? '' : 's' }} so far — tap Show to invite more people.
        </p>
      </section>

      <p v-if="contributions.length === 0" class="hint">No contributions yet — share the link to get started.</p>
      <div v-else class="list">
        <div v-for="c in contributions" :key="c.id" class="contribution">
          <Identicon v-if="c.sender" :address="c.sender" :size="32" />
          <span v-else class="manual-dot">✎</span>
          <span class="who">{{ contributorLabel(c) }}<span class="when"> · {{ new Date(c.at).toLocaleDateString() }}</span></span>
          <span class="amount">+{{ c.amountNim.toLocaleString(undefined, { maximumFractionDigits: 2 }) }} NIM</span>
        </div>
      </div>

      <section class="management-section">
        <button type="button" class="management-head" @click="managementExpanded = !managementExpanded">
          <span>Manage bucket</span>
          <span>{{ managementExpanded ? 'Hide' : 'Show' }}</span>
        </button>
        <template v-if="managementExpanded">
          <div class="management-actions">
            <button
              v-if="bucket.status === 'active'"
              type="button"
              class="secondary"
              @click="editing = true"
            >
              {{ goalReached ? 'Raise goal' : 'Edit bucket' }}
            </button>
            <button type="button" class="secondary" @click="bucketsStore.setStatus(bucket.id, bucket.status === 'active' ? 'completed' : 'active')">
              {{ bucket.status === 'active' ? 'Mark complete' : 'Reopen' }}
            </button>
            <button type="button" class="secondary danger" @click="removeBucket">Delete</button>
          </div>
          <form v-if="bucket.status === 'active'" class="manual-add" @submit.prevent="addManual">
            <p class="manual-label">Add a contribution manually (cash, or the payer edited the message):</p>
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
        </template>
      </section>
    </template>
  </ActionSheet>
</template>

<style scoped>
.new-bucket, .manual-add { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.manual-add { margin-top: 16px; }
.ready-summary { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-bottom: 14px; text-align: center; }
.ready-icon { font-size: 40px; line-height: 1; }
.ready-title { margin: 0; font-size: 20px; font-weight: 700; }
.ready-share, .ready-invite, .ready-done { width: 100%; margin-top: 14px; }
.ready-invite, .ready-done { margin-top: 8px; }
.manual-label { margin: 0; font-size: 12px; font-weight: 700; color: var(--text-2); }
.new-fields { display: flex; flex-direction: column; gap: 8px; }
.new-fields input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.primary {
  height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
.progress-wrap { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.progress-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.progress-numbers { font-size: 18px; flex: 1; min-width: 0; }
.progress-numbers span { color: var(--text-2); }
.fiat-goal { font-size: 13px; }
.progress-bar { height: 10px; border-radius: 5px; background: var(--text-6); overflow: hidden; }
.progress-fill { height: 100%; border-radius: 5px; background: var(--nimiq-gold-bg); transition: width 0.3s ease; }
.goal-reached-hint { margin: 0; font-size: 13px; color: var(--nq-green); font-weight: 600; }
.edit-form { display: flex; flex-direction: column; gap: 10px; }
.edit-label { margin: 0; font-size: 13px; font-weight: 700; color: var(--text-2); }
.edit-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.edit-note { margin: 0; font-size: 12px; color: var(--text-2); }
.pay-hint { margin: 8px 0 0; font-size: 12px; color: var(--text-2); text-align: center; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
.secondary {
  min-height: 44px; padding: 0 16px; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700;
}
.secondary:disabled { opacity: 0.5; }
.secondary.danger { color: var(--nq-red); }
.list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.contribution {
  display: flex; align-items: center; gap: 10px;
  min-height: 44px; padding: 6px 12px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg);
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
.invite-section { margin: 16px 0; display: flex; flex-direction: column; gap: 8px; }
.invite-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; padding: 0; border: none; background: none; cursor: pointer; font: inherit; text-align: left;
}
.invite-title { margin: 0; font-size: 13px; font-weight: 700; color: var(--text-2); text-transform: uppercase; }
.invite-toggle { font-size: 12px; font-weight: 700; color: var(--nq-light-blue); flex: 0 0 auto; }
.invite-hint { margin: 0; font-size: 13px; color: var(--text-2); text-align: left; }
.invite-collapsed-hint { margin: 0; font-size: 13px; color: var(--text-2); text-align: left; }
.invite-list { display: flex; flex-direction: column; gap: 4px; }
.person-row { display: flex; align-items: center; gap: 10px; min-height: 44px; }
.person-name { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.filter-input {
  font: inherit; padding: 10px 12px; min-height: 44px; margin: 4px 0;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill); background: var(--bg); color: var(--text);
}
.send-one {
  flex: 0 0 auto; min-height: 36px; padding: 0 12px; border-radius: 18px; cursor: pointer;
  border: 1px solid var(--border); background: var(--card); color: var(--nq-light-blue); font-weight: 700; font-size: 12px;
}
.send-one:disabled { opacity: 0.5; cursor: default; }
.invite-all { width: 100%; margin-top: 4px; }
.err { margin: 0; color: var(--nq-red); font-size: 13px; text-align: left; }
.management-section { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--border); }
.management-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; padding: 0; border: none; background: none; color: var(--text-2);
  cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; text-align: left;
}
.management-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
