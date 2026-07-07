<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import QrScanner from 'qr-scanner'

const emit = defineEmits<{ scan: [text: string]; error: [] }>()
const video = ref<HTMLVideoElement>()
let scanner: QrScanner | null = null

onMounted(async () => {
  try {
    scanner = new QrScanner(
      video.value!,
      result => emit('scan', result.data),
      { returnDetailedScanResult: true, highlightScanRegion: true },
    )
    await scanner.start()
  } catch {
    emit('error')
  }
})

onBeforeUnmount(() => {
  scanner?.destroy()
})
</script>

<template>
  <video ref="video" class="scanner" />
</template>

<style scoped>
.scanner { width: 100%; border-radius: var(--radius); background: #000; aspect-ratio: 1; object-fit: cover; }
</style>
