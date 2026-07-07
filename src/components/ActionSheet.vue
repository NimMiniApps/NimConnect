<script setup lang="ts">
defineProps<{ open: boolean; title: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <teleport to="body">
    <transition name="sheet">
      <div v-if="open" class="backdrop" @click.self="$emit('close')">
        <div class="sheet card">
          <div class="sheet-bar" />
          <h2>{{ title }}</h2>
          <slot />
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(31, 35, 72, 0.4);
  display: flex; align-items: flex-end; justify-content: center;
}
.sheet {
  width: 100%; max-width: 560px;
  border-radius: var(--radius) var(--radius) 0 0;
  padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
  max-height: 80dvh; overflow-y: auto;
}
.sheet-bar { width: 36px; height: 4px; border-radius: 2px; background: var(--border); margin: 8px auto 4px; }
.sheet h2 { font-size: 18px; margin: 12px 0; }
.sheet-enter-active, .sheet-leave-active { transition: opacity 0.2s ease; }
.sheet-enter-active .sheet, .sheet-leave-active .sheet { transition: transform 0.2s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-from .sheet, .sheet-leave-to .sheet { transform: translateY(100%); }
</style>
