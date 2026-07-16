<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{
  address: string
  compact?: boolean
}>(), {
  compact: false,
})

const copied = ref(false)
let resetTimeout: ReturnType<typeof setTimeout> | undefined
let unmounted = false

async function copyAddress() {
  try {
    if (!navigator.clipboard?.writeText) return

    await navigator.clipboard.writeText(props.address)
    if (unmounted) return

    copied.value = true
    if (resetTimeout) clearTimeout(resetTimeout)
    resetTimeout = setTimeout(() => {
      copied.value = false
    }, 2_000)
  } catch {
    // The visible address remains available for manual selection and copying.
  }
}

onBeforeUnmount(() => {
  unmounted = true
  if (resetTimeout) clearTimeout(resetTimeout)
})
</script>

<template>
  <div class="public-address-copy" :class="{ 'public-address-copy--compact': compact }">
    <span class="public-address-copy__address" data-public-address data-selectable="true">{{ address }}</span>
    <button class="public-address-copy__button" type="button" @click="copyAddress">
      {{ copied ? 'Copied ✓' : 'Copy address' }}
    </button>
  </div>
</template>

<style scoped>
.public-address-copy {
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.625rem 0.75rem;
  text-align: left;
  width: 100%;
}

.public-address-copy__address {
  color: var(--text);
  flex: 1 1 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.4;
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: left;
  user-select: all;
}

.public-address-copy__button {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  color: var(--text);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 800;
  min-height: 2.75rem;
  padding: 0.5rem 0.625rem;
}

.public-address-copy--compact {
  padding: 0.5rem;
}

.public-address-copy--compact .public-address-copy__button {
  min-height: 2.75rem;
  padding: 0.375rem 0.5rem;
}
</style>
