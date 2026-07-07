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
.qr { border-radius: 12px; background: #fff; padding: 8px; display: block; margin: 0 auto; }
</style>
