<script setup lang="ts">
defineProps<{ icon: string; title: string; hint?: string }>()
</script>

<template>
  <div class="empty">
    <div class="empty-icon">{{ icon }}</div>
    <div class="empty-title">{{ title }}</div>
    <div v-if="hint" class="empty-hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.empty { text-align: center; padding: 48px 24px; color: var(--text-2); }
.empty-icon { font-size: 40px; margin-bottom: 12px; }
.empty-title { font-weight: 700; color: var(--text); }
.empty-hint { font-size: 14px; margin-top: 4px; }
</style>
