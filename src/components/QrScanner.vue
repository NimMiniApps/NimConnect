<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick } from 'vue'
import QrScanner from 'qr-scanner'

const emit = defineEmits<{ scan: [text: string]; error: [message: string] }>()
const video = ref<HTMLVideoElement>()
const status = ref<'loading' | 'active' | 'error'>('loading')
const statusMessage = ref('')
let scanner: QrScanner | null = null

function cameraError(message: string) {
  status.value = 'error'
  statusMessage.value = message
  emit('error', message)
}

onMounted(async () => {
  await nextTick()
  const el = video.value
  if (!el) {
    cameraError('Camera preview failed to load.')
    return
  }

  if (!window.isSecureContext) {
    cameraError('Camera requires HTTPS. Use the live site or paste the link below.')
    return
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError('Camera not supported here — paste the link instead.')
    return
  }

  el.playsInline = true
  el.setAttribute('playsinline', 'true')
  el.setAttribute('webkit-playsinline', 'true')
  el.muted = true
  el.autoplay = true

  try {
    scanner = new QrScanner(
      el,
      result => emit('scan', result.data),
      {
        returnDetailedScanResult: true,
        highlightScanRegion: true,
        preferredCamera: 'environment',
        maxScansPerSecond: 12,
      },
    )
    await scanner.start()
    status.value = 'active'
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      cameraError('Camera permission denied. Allow camera access in settings, or paste the link below.')
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      cameraError('No camera found — paste the link instead.')
    } else if (name === 'NotReadableError') {
      cameraError('Camera is in use by another app — close it and try again, or paste the link.')
    } else {
      cameraError('Camera unavailable — paste the link instead.')
    }
  }
})

onBeforeUnmount(() => {
  scanner?.destroy()
  scanner = null
})
</script>

<template>
  <div class="wrap">
    <video ref="video" class="scanner" :class="{ hidden: status !== 'active' }" />
    <p v-if="status === 'loading'" class="status">Starting camera… allow access if prompted.</p>
    <p v-if="status === 'error'" class="status err">{{ statusMessage }}</p>
  </div>
</template>

<style scoped>
.wrap { position: relative; }
.scanner {
  width: 100%;
  border-radius: var(--radius);
  background: #000;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
.scanner.hidden { visibility: hidden; position: absolute; inset: 0; height: 0; overflow: hidden; }
.status {
  margin: 0;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text-2);
  font-size: 14px;
  text-align: center;
}
.status.err { color: var(--nq-red); }
</style>
