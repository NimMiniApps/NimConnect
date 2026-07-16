<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick, watch } from 'vue'
import QrScanner from 'qr-scanner'

const props = defineProps<{ paused?: boolean }>()
const emit = defineEmits<{ scan: [text: string] }>()
const video = ref<HTMLVideoElement>()
const status = ref<'loading' | 'active' | 'unavailable'>('loading')
const unavailableTitle = ref('Camera unavailable')
const unavailableHint = ref('')
let scanner: QrScanner | null = null

function setUnavailable(title: string, hint: string) {
  status.value = 'unavailable'
  unavailableTitle.value = title
  unavailableHint.value = hint
}

function onPlaying() {
  status.value = 'active'
}

onMounted(async () => {
  await nextTick()
  const el = video.value
  if (!el) {
    setUnavailable('Camera unavailable', 'Preview failed to load. Paste a payment link below.')
    return
  }

  if (!window.isSecureContext) {
    setUnavailable(
      'Camera unavailable',
      'The camera requires HTTPS. Use the live site or paste a payment link below.',
    )
    return
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setUnavailable('Camera unavailable', 'This device can’t use the camera here. Paste a payment link below.')
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
    await el.play().catch(() => {})
    if (el.readyState >= 2) status.value = 'active'
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      setUnavailable(
        'Camera permission needed',
        'Allow camera access in settings, or paste a payment link below.',
      )
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      setUnavailable('No camera found', 'Paste a payment link, @handle or address below.')
    } else if (name === 'NotReadableError') {
      setUnavailable(
        'Camera in use',
        'Close the other app using the camera, or paste a payment link below.',
      )
    } else {
      setUnavailable('Camera unavailable', 'Paste a payment link, @handle or address below.')
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
  <div class="wrap" :class="status">
    <video
      ref="video"
      class="scanner"
      playsinline
      webkit-playsinline
      muted
      autoplay
    />

    <!-- Living viewfinder — always present so the page feels like a camera -->
    <div class="viewfinder" aria-hidden="true">
      <span class="corner tl" />
      <span class="corner tr" />
      <span class="corner bl" />
      <span class="corner br" />
      <span v-if="status !== 'active'" class="scan-line" />
    </div>

    <div v-if="status === 'loading'" class="overlay">
      <p class="overlay-title">Starting camera…</p>
      <p class="overlay-hint">Allow access if prompted</p>
    </div>

    <div v-else-if="status === 'unavailable'" class="overlay empty">
      <div class="qr-mark" aria-hidden="true">
        <span /><span /><span /><span />
        <i class="qr-eye tl" /><i class="qr-eye tr" /><i class="qr-eye bl" />
      </div>
      <p class="overlay-title">{{ unavailableTitle }}</p>
      <p class="overlay-hint">{{ unavailableHint }}</p>
      <ul class="guide">
        <li>Payment requests</li>
        <li>Invoices</li>
        <li>Shared buckets</li>
        <li>Public profiles</li>
        <li>Wallet addresses</li>
      </ul>
    </div>

    <p v-else class="live-hint">Position a QR code inside the frame</p>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius);
  overflow: hidden;
  background: #0b0d1a;
}
.scanner {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: #0b0d1a;
}
.wrap.unavailable .scanner,
.wrap.loading .scanner {
  opacity: 0;
}

.wrap :deep(svg),
.wrap :deep(.scan-region-highlight) {
  border-radius: var(--radius);
}

.viewfinder {
  position: absolute;
  inset: 14%;
  pointer-events: none;
  z-index: 2;
}
.corner {
  position: absolute;
  width: 22px;
  height: 22px;
  border: 3px solid rgba(255, 255, 255, 0.85);
}
.corner.tl { top: 0; left: 0; border-right: none; border-bottom: none; border-radius: 4px 0 0 0; }
.corner.tr { top: 0; right: 0; border-left: none; border-bottom: none; border-radius: 0 4px 0 0; }
.corner.bl { bottom: 0; left: 0; border-right: none; border-top: none; border-radius: 0 0 0 4px; }
.corner.br { bottom: 0; right: 0; border-left: none; border-top: none; border-radius: 0 0 4px 0; }

.scan-line {
  position: absolute;
  left: 8%;
  right: 8%;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, var(--nq-gold), transparent);
  box-shadow: 0 0 12px rgba(233, 178, 19, 0.55);
  animation: scan-sweep 2.2s var(--nimiq-ease) infinite;
}
@keyframes scan-sweep {
  0% { top: 8%; opacity: 0; }
  15% { opacity: 1; }
  85% { opacity: 1; }
  100% { top: 92%; opacity: 0; }
}

.overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 28px 24px;
  background: rgba(11, 13, 26, 0.88);
  color: #fff;
  text-align: center;
  pointer-events: none;
}
.overlay.empty { background: radial-gradient(120% 80% at 50% 40%, #1a2048 0%, #0b0d1a 70%); }
.qr-mark {
  position: relative;
  width: 56px;
  height: 56px;
  margin-bottom: 8px;
  border: 2px solid rgba(244, 244, 245, 0.35);
  border-radius: 10px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  padding: 10px;
}
.qr-mark span {
  border-radius: 2px;
  background: rgba(244, 244, 245, 0.22);
}
.qr-mark span:nth-child(2) { opacity: 0.55; }
.qr-mark span:nth-child(3) { opacity: 0.7; }
.qr-eye {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(233, 178, 19, 0.85);
  border-radius: 2px;
}
.qr-eye.tl { top: 6px; left: 6px; }
.qr-eye.tr { top: 6px; right: 6px; }
.qr-eye.bl { bottom: 6px; left: 6px; }
.overlay-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: #fff;
}
.overlay-hint {
  margin: 0;
  max-width: 260px;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(244, 244, 245, 0.7);
}
.guide {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
.guide li {
  padding: 4px 10px;
  border-radius: var(--nimiq-radius-pill);
  background: rgba(244, 244, 245, 0.08);
  color: rgba(244, 244, 245, 0.75);
  font-size: 11px;
  font-weight: 700;
}

.live-hint {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--nimiq-radius-pill);
  background: rgba(11, 13, 26, 0.55);
  color: rgba(244, 244, 245, 0.85);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  pointer-events: none;
}
</style>
