<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  subtitle?: string
  prominentTitle?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const dragY = ref(0)
const dragging = ref(false)
let startY = 0
let previousBodyOverflow = ''
let previousHtmlOverflow = ''

const sheetStyle = computed(() => ({
  transform: dragY.value ? `translateY(${dragY.value}px)` : undefined,
}))

watch(() => props.open, open => {
  dragY.value = 0
  dragging.value = false
  if (open) lockPageScroll()
  else unlockPageScroll()
}, { immediate: true })

onBeforeUnmount(unlockPageScroll)

function lockPageScroll() {
  previousBodyOverflow = document.body.style.overflow
  previousHtmlOverflow = document.documentElement.style.overflow
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
}

function unlockPageScroll() {
  document.body.style.overflow = previousBodyOverflow
  document.documentElement.style.overflow = previousHtmlOverflow
}

function close() {
  dragY.value = 0
  dragging.value = false
  emit('close')
}

function onPointerDown(event: PointerEvent) {
  dragging.value = true
  startY = event.clientY
  dragY.value = 0
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  dragY.value = Math.max(0, event.clientY - startY)
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  dragging.value = false
  if (dragY.value > 90) close()
  else dragY.value = 0
}
</script>

<template>
  <teleport to="body">
    <transition name="sheet">
      <div v-if="open" class="backdrop" @click.self="close" @touchmove.self.prevent>
        <div class="sheet card" :class="{ dragging }" :style="sheetStyle">
          <button
            type="button"
            class="sheet-handle"
            aria-label="Close sheet"
            @click="close"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <span class="sheet-bar" />
          </button>
          <header class="sheet-head">
            <h2 :class="{ 'sheet-title--prominent': prominentTitle }">{{ title }}</h2>
            <p v-if="subtitle" class="sheet-subtitle">{{ subtitle }}</p>
          </header>
          <slot />
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: var(--text-40);
  display: flex; align-items: flex-end; justify-content: center;
  overscroll-behavior: contain;
  touch-action: none;
}
.sheet {
  width: 100%; max-width: 560px;
  border-radius: 24px 24px 0 0;
  padding: 0 24px calc(24px + env(safe-area-inset-bottom));
  max-height: 80dvh; overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  will-change: transform;
}
.sheet.dragging { transition: none !important; }
.sheet-handle {
  width: 100%;
  min-height: 32px;
  padding: 8px 0 4px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  cursor: grab;
  touch-action: none;
}
.sheet-handle:active { cursor: grabbing; }
.sheet-bar { width: 40px; height: 4px; border-radius: 2px; background: var(--text-20); }
.sheet-head { margin: 12px 0 16px; }
.sheet h2 { font-size: 20px; line-height: 1.2; margin: 0; }
.sheet h2.sheet-title--prominent {
  font-size: 28px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.sheet-subtitle {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.35;
  color: var(--text-2);
}
.sheet-enter-active, .sheet-leave-active { transition: opacity var(--movement-duration) var(--nimiq-ease); }
.sheet-enter-active .sheet, .sheet-leave-active .sheet {
  transition: transform var(--movement-duration) var(--nimiq-ease);
}
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(100%); }
@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active, .sheet-leave-active,
  .sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: none; }
}
</style>
