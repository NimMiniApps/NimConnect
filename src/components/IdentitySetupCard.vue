<script setup lang="ts">
import { computed } from 'vue'
import type { IdentitySetupResult } from '../services/identity-setup'

const props = defineProps<{
  result: IdentitySetupResult
  publicUrl?: string
  /** Short status line shown above actions (e.g. after share). */
  feedback?: string
}>()

const emit = defineEmits<{
  claim: []
  'add-contact': []
  share: []
  'learn-more': []
  dismiss: []
}>()

const celebrating = computed(() => props.result.celebration === 'claimed')

const title = computed(() =>
  celebrating.value ? `You're now @${props.result.celebrationHandle}` : 'Build your Nimiq identity',
)

type PrimaryAction = 'claim' | 'add-contact' | 'share'
type SecondaryAction = 'learn-more' | 'add-contact' | 'share'

const primary = computed<{ label: string, action: PrimaryAction } | null>(() => {
  if (celebrating.value) return { label: 'Share your public profile', action: 'share' }
  switch (props.result.nextStep) {
    case 'claim-handle': return { label: 'Claim your @handle', action: 'claim' }
    case 'first-contact': return { label: 'Add your first contact', action: 'add-contact' }
    case 'share-profile': return { label: 'Share your public profile', action: 'share' }
    default: return null
  }
})

const secondary = computed<{ label: string, action: SecondaryAction } | null>(() => {
  if (celebrating.value) return { label: 'Add your first contact', action: 'add-contact' }
  switch (props.result.nextStep) {
    case 'claim-handle': return { label: 'Learn more', action: 'learn-more' }
    case 'first-contact': return { label: 'Share your public profile', action: 'share' }
    default: return null
  }
})

function runPrimary() {
  switch (primary.value?.action) {
    case 'claim': emit('claim'); break
    case 'add-contact': emit('add-contact'); break
    case 'share': emit('share'); break
  }
}

function runSecondary() {
  switch (secondary.value?.action) {
    case 'learn-more': emit('learn-more'); break
    case 'add-contact': emit('add-contact'); break
    case 'share': emit('share'); break
  }
}
</script>

<template>
  <section class="home-panel identity-setup-card">
    <button type="button" class="identity-setup-dismiss" aria-label="Dismiss" @click="emit('dismiss')">✕</button>

    <h2 class="identity-setup-title">{{ title }}</h2>
    <p v-if="celebrating && publicUrl" class="identity-setup-url">{{ publicUrl }}</p>

    <ul class="identity-setup-list">
      <li v-for="step in result.steps" :key="step.id" class="identity-setup-item" :class="{ done: step.done }">
        <span class="identity-setup-mark">{{ step.done ? '✓' : '□' }}</span>
        <span class="identity-setup-label">{{ step.label }}</span>
      </li>
    </ul>

    <p v-if="feedback" class="identity-setup-feedback">{{ feedback }}</p>

    <div v-if="primary" class="identity-setup-actions">
      <button type="button" class="identity-setup-primary primary-action" data-primary @click="runPrimary">
        {{ primary.label }}
      </button>
      <button v-if="secondary" type="button" class="identity-setup-secondary" data-secondary @click="runSecondary">
        {{ secondary.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.identity-setup-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.identity-setup-dismiss {
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
.identity-setup-title {
  margin: 0;
  padding-right: 28px;
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
}
.identity-setup-url {
  margin: 0;
  color: var(--nq-light-blue);
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.identity-setup-feedback {
  margin: 0;
  color: var(--nq-green);
  font-size: 13px;
  font-weight: 700;
}
.identity-setup-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.identity-setup-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: var(--text-2);
  font-size: 14px;
  font-weight: 600;
}
.identity-setup-item.done {
  color: var(--text);
}
.identity-setup-mark {
  flex: 0 0 auto;
  width: 18px;
  color: var(--nq-green);
  font-weight: 800;
}
.identity-setup-item:not(.done) .identity-setup-mark {
  color: var(--text-2);
}
.identity-setup-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.identity-setup-primary {
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
.identity-setup-secondary {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--bg);
  color: var(--nq-light-blue);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
}
</style>
