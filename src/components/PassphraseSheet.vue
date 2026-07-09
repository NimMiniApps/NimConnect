<script setup lang="ts">
import { ref } from 'vue'
import ActionSheet from './ActionSheet.vue'

const props = defineProps<{
  open: boolean
  title?: string
  confirm?: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [passphrase: string]
}>()

const passphrase = ref('')
const confirmPass = ref('')
const error = ref('')

function close() {
  passphrase.value = ''
  confirmPass.value = ''
  error.value = ''
  emit('close')
}

function submit() {
  error.value = ''
  if (!passphrase.value) {
    error.value = 'Enter a passphrase.'
    return
  }
  if (props.confirm && passphrase.value !== confirmPass.value) {
    error.value = 'Passphrases do not match.'
    return
  }
  emit('submit', passphrase.value)
  close()
}
</script>

<template>
  <ActionSheet :open="open" :title="title ?? 'Backup passphrase'" @close="close">
    <p class="hint">Your contacts are encrypted with this passphrase. We never store it.</p>
    <label class="field">
      <span>Passphrase</span>
      <input v-model="passphrase" type="password" autocomplete="new-password" />
    </label>
    <label v-if="confirm" class="field">
      <span>Confirm passphrase</span>
      <input v-model="confirmPass" type="password" autocomplete="new-password" />
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <button type="button" class="primary" @click="submit">Continue</button>
    <button type="button" class="secondary" @click="close">Cancel</button>
  </ActionSheet>
</template>

<style scoped>
.hint { color: var(--text-2); font-size: 14px; margin: 0 0 12px; line-height: 1.4; }
.field { display: block; margin-bottom: 12px; }
.field span { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-2); }
.field input {
  width: 100%; font: inherit; padding: 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.error { color: var(--nq-red); font-size: 14px; margin: 0 0 8px; }
.primary, .secondary {
  display: block; width: 100%; min-height: 44px; margin-top: 8px;
  border: none; border-radius: var(--nimiq-radius-pill); font: inherit; font-weight: 700; cursor: pointer;
}
.primary { background: var(--nimiq-gold-bg); color: var(--nimiq-white); }
.secondary { background: none; color: var(--text-2); }
</style>
