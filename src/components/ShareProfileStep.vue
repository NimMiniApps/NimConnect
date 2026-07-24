<script setup lang="ts">
import { ref } from 'vue'
import { shareOrCopy } from '../services/share'
import { markPublicProfileShared } from '../services/identity-setup'

const props = defineProps<{ publicUrl: string }>()
const emit = defineEmits<{ complete: []; defer: [] }>()

const sharing = ref(false)

async function share() {
  if (!props.publicUrl || sharing.value) return
  sharing.value = true
  try {
    await shareOrCopy(props.publicUrl, 'My NimConnect profile')
    markPublicProfileShared()
    emit('complete')
  } finally {
    sharing.value = false
  }
}
</script>

<template>
  <div class="share-step">
    <h2 class="title">Share your public profile</h2>
    <p class="hint">Anyone with this link can see your profile and pay you — no wallet address needed.</p>
    <p class="url">{{ publicUrl }}</p>
    <button type="button" class="primary" :disabled="sharing || !publicUrl" @click="share">
      {{ sharing ? 'Sharing…' : 'Share profile' }}
    </button>
    <button type="button" class="skip" :disabled="sharing" @click="emit('defer')">Skip for now</button>
  </div>
</template>

<style scoped>
.title { margin: 0 0 8px; font-size: 20px; font-weight: 800; color: var(--text); }
.hint { margin: 0 0 16px; font-size: 14px; color: var(--text-2); line-height: 1.4; }
.url {
  margin: 0 0 20px; padding: 12px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); color: var(--nq-light-blue); font-size: 13px; font-weight: 600; overflow-wrap: anywhere;
}
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; cursor: default; }
.skip {
  background: none; border: none; min-height: 44px; width: 100%; margin-top: 8px;
  font: inherit; font-weight: 600; color: var(--text-2); cursor: pointer;
}
.skip:disabled { opacity: 0.5; cursor: default; }
</style>
