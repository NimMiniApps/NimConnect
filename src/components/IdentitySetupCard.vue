<script setup lang="ts">
defineProps<{ label?: string }>()
const emit = defineEmits<{ resume: []; dismiss: [] }>()
</script>

<template>
  <section class="home-panel resume-banner">
    <button type="button" class="resume-dismiss" aria-label="Dismiss" @click="emit('dismiss')">✕</button>
    <h2 class="resume-title">Finish setting up</h2>
    <p class="resume-sub">{{ label ?? 'A few steps left to get the most out of NimConnect.' }}</p>
    <button type="button" class="resume-cta primary-action" @click="emit('resume')">Continue</button>
  </section>
</template>

<style scoped>
.resume-banner {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.resume-dismiss {
  position: absolute;
  top: 12px;
  right: 12px;
  min-width: 28px;
  min-height: 28px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-2);
  font-size: 13px;
  opacity: 0.7;
}
.resume-title {
  margin: 0;
  padding-right: 28px;
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
}
.resume-sub {
  margin: 0;
  color: var(--text-2);
  font-size: 14px;
}
.resume-cta {
  margin-top: 4px;
  min-height: 44px;
  padding: 0 16px;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-blue);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
}
</style>
