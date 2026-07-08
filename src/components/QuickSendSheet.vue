<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useProfilesStore } from '../stores/profiles'
import { getProvider, MESSAGE_MAX_BYTES, messageBytes, sendNim } from '../services/nimiq'
import ActionSheet from './ActionSheet.vue'
import CurrencyAmountInput from './CurrencyAmountInput.vue'
import Identicon from './Identicon.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useProfilesStore()
const insidePay = ref(false)
const query = ref('')
const selectedId = ref<string | null>(null)
const amount = ref<number | null>(null)
const amountInput = ref<InstanceType<typeof CurrencyAmountInput>>()
const message = ref('')
const sending = ref(false)
const sendResult = ref<'ok' | string | null>(null)

onMounted(async () => {
  await store.load()
  insidePay.value = (await getProvider()) !== null
})

watch(() => props.open, async open => {
  if (!open) return
  await store.load()
  insidePay.value = (await getProvider()) !== null
})

const contacts = computed(() => store.search(query.value))
const selected = computed(() => selectedId.value ? store.getById(selectedId.value) : null)
const messageTooLong = computed(() => messageBytes(message.value) > MESSAGE_MAX_BYTES)

function choose(id: string) {
  selectedId.value = id
  query.value = ''
  sendResult.value = null
}

async function doSend() {
  if (!selected.value || !amount.value || messageTooLong.value) return
  sending.value = true
  sendResult.value = null
  try {
    await sendNim(selected.value.address, amount.value, message.value)
    await store.touchInteraction(selected.value.id)
    sendResult.value = 'ok'
  } catch (e) {
    sendResult.value = (e as Error).message
  } finally {
    sending.value = false
  }
}

function close() {
  query.value = ''
  selectedId.value = null
  amount.value = null
  amountInput.value?.reset()
  message.value = ''
  sendResult.value = null
  emit('close')
}
</script>

<template>
  <ActionSheet :open="open" title="Send NIM" @close="close">
    <p v-if="!insidePay" class="hint">Open NimConnect inside Nimiq Pay to send NIM directly.</p>

    <template v-else-if="store.contacts.length === 0">
      <p class="hint">Add a contact first, then Send can start from here.</p>
      <router-link to="/add" class="primary-link" @click="close">Add contact</router-link>
    </template>

    <template v-else>
      <div v-if="!selected" class="picker">
        <input v-model="query" type="search" class="search" placeholder="Search contacts…" />
        <button
          v-for="contact in contacts"
          :key="contact.id"
          type="button"
          class="contact-row"
          @click="choose(contact.id)"
        >
          <Identicon :address="contact.address" :size="36" />
          <span>{{ contact.name }}</span>
        </button>
        <p v-if="contacts.length === 0" class="hint">No matching contacts.</p>
      </div>

      <template v-else>
        <button type="button" class="selected" @click="selectedId = null">
          <Identicon :address="selected.address" :size="40" />
          <span>
            Send to {{ selected.name }}
            <small>Tap to change</small>
          </span>
        </button>

        <label class="field">
          Amount
          <CurrencyAmountInput ref="amountInput" placeholder="0.00" @update:model-value="amount = $event" />
        </label>

        <label class="field">
          Message
          <input v-model="message" maxlength="64" placeholder="Thanks!" />
          <span v-if="messageTooLong" class="err">Too long — max {{ MESSAGE_MAX_BYTES }} bytes.</span>
        </label>

        <p v-if="sendResult === 'ok'" class="ok">Sent to {{ selected.name }}</p>
        <p v-else-if="sendResult" class="err">{{ sendResult }}</p>

        <button
          v-if="sendResult === 'ok'"
          type="button"
          class="primary"
          @click="close"
        >
          Done
        </button>
        <button
          v-else
          type="button"
          class="primary"
          :disabled="!amount || sending || messageTooLong"
          @click="doSend"
        >
          {{ sending ? 'Waiting for confirmation…' : 'Send NIM' }}
        </button>
      </template>
    </template>
  </ActionSheet>
</template>

<style scoped>
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.picker { display: flex; flex-direction: column; gap: 8px; }
.search {
  font: inherit;
  min-height: 44px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: var(--bg);
  color: var(--text);
}
.contact-row,
.selected {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  text-align: left;
}
.selected span { display: flex; flex-direction: column; }
.selected small { margin-top: 2px; color: var(--text-2); font-size: 12px; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; font-size: 13px; font-weight: 800; color: var(--text-2); }
.field input {
  font: inherit;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  color: var(--text);
}
.primary,
.primary-link {
  width: 100%;
  min-height: 48px;
  margin-top: 12px;
  border: none;
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
  cursor: pointer;
  font: inherit;
  font-size: 16px;
  font-weight: 800;
  text-decoration: none;
}
.primary:disabled { opacity: 0.5; cursor: default; }
.ok { color: var(--nq-green); font-weight: 800; }
.err { color: var(--nq-red); font-size: 14px; }
</style>
