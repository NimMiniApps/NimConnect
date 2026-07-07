<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Profile } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { getProvider, sendNim } from '../services/nimiq'
import ActionSheet from './ActionSheet.vue'

const props = defineProps<{ profile: Profile; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const PRESETS = [1, 5, 10, 25]

const store = useProfilesStore()
const insidePay = ref(false)
const amount = ref<number | null>(null)
const message = ref('Thanks! 💛')
const sending = ref(false)
const result = ref<'ok' | string | null>(null)

onMounted(async () => {
  insidePay.value = (await getProvider()) !== null
})

function close() {
  amount.value = null
  message.value = 'Thanks! 💛'
  result.value = null
  emit('close')
}

async function doTip() {
  if (!amount.value) return
  sending.value = true
  result.value = null
  try {
    await sendNim(props.profile.address, amount.value, message.value)
    result.value = 'ok'
    await store.touchInteraction(props.profile.id)
  } catch (e) {
    result.value = (e as Error).message
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <ActionSheet :open="open" :title="`Tip ${profile.name}`" @close="close">
    <template v-if="insidePay">
      <div class="presets">
        <button
          v-for="p in PRESETS"
          :key="p"
          type="button"
          class="preset"
          :class="{ selected: amount === p }"
          @click="amount = p"
        >{{ p }} NIM</button>
      </div>
      <label class="message-label">
        Message
        <input v-model="message" maxlength="64" placeholder="Thanks! 💛" />
      </label>
      <p v-if="result === 'ok'" class="ok">💛 Tipped {{ amount }} NIM to {{ profile.name }}</p>
      <p v-else-if="result" class="err">{{ result }}</p>
      <button v-if="result === 'ok'" class="primary" @click="close">Done</button>
      <button v-else class="primary" :disabled="!amount || sending" @click="doTip">
        {{ sending ? 'Waiting for confirmation…' : amount ? `Tip ${amount} NIM` : 'Pick an amount' }}
      </button>
    </template>
    <p v-else class="hint">Open NimConnect inside Nimiq Pay to send tips.</p>
  </ActionSheet>
</template>

<style scoped>
.presets { display: flex; gap: 8px; margin-bottom: 12px; }
.preset {
  flex: 1; min-height: 48px; border-radius: 12px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  font-weight: 700;
}
.preset.selected {
  border-color: var(--nq-gold);
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
  color: #fff;
}
.message-label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-2); margin-bottom: 12px; }
.message-label input {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text);
}
.primary {
  width: 100%; height: 48px; border: none; border-radius: 24px; cursor: pointer;
  font-weight: 700; font-size: 16px; color: #fff; margin-top: 12px;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
}
.primary:disabled { opacity: 0.5; }
.ok { color: var(--nq-green); font-weight: 700; }
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
</style>
