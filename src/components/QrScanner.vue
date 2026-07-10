<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick, watch } from 'vue'
import QrScanner from 'qr-scanner'

const props = defineProps<{ paused?: boolean }>()
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

function onPlaying() {
  status.value = 'active'
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

  el.addEventListener('playing', onPlaying)

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
    // iOS / webviews sometimes need an explicit play() after the stream attaches.
    await el.play().catch(() => {})
    if (el.readyState >= 2) status.value = 'active'
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

watch(() => props.paused, async paused => {
  if (!scanner) return
  if (paused) await scanner.stop()
  else await scanner.start()
})

onBeforeUnmount(() => {
  video.value?.removeEventListener('playing', onPlaying)
  scanner?.destroy()
  scanner = null
})
</script>

<template>
  <div class="wrap">
    <video
      ref="video"
      class="scanner"
      playsinline
      webkit-playsinline
      muted
      autoplay
    />
    <div v-if="status === 'loading'" class="overlay">
      <p>Starting camera… allow access if prompted.</p>
    </div>
    <div v-else-if="status === 'error'" class="overlay error">
      <p>{{ statusMessage }}</p>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
}
.scanner {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #000;
}
/* qr-scanner injects a highlight overlay as a sibling of the video */
.wrap :deep(svg),
.wrap :deep(.scan-region-highlight) {
  border-radius: var(--radius);
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 14px;
  text-align: center;
  pointer-events: none;
}
.overlay p { margin: 0; }
.overlay.error { color: #ffb4b4; background: var(--bg); pointer-events: auto; }
</style>
