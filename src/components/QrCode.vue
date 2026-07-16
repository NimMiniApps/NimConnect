<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import QRCode from 'qrcode'

const props = withDefaults(defineProps<{ text: string; size?: number }>(), { size: 240 })
const src = ref('')

watchEffect(async () => {
  if (!props.text) return
  src.value = await QRCode.toDataURL(props.text, { width: props.size, margin: 1 })
})
</script>

<template>
  <img v-if="src" :src="src" :width="size" :height="size" alt="QR code" class="qr" />
</template>

<style scoped>
/* Stays white regardless of theme: a light quiet zone keeps the code camera-scannable. */
.qr {
  background: var(--nimiq-white);
  border-radius: 12px;
  display: block;
  height: auto;
  margin: 0 auto;
  max-width: 100%;
  padding: 8px;
}
</style>
