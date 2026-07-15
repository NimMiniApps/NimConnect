<script setup lang="ts">
import PublicStoreLinks from './PublicStoreLinks.vue'
import PublicSurface from './PublicSurface.vue'
import { NIMPAY_OPEN_URL } from '../config/host-app'

const emit = defineEmits<{ continue: [] }>()
withDefaults(defineProps<{ allowBrowserContinue?: boolean }>(), {
  allowBrowserContinue: true,
})

const iconUrl = `${import.meta.env.BASE_URL}icon.svg`
</script>

<template>
  <PublicSurface context="NimConnect">
    <template #identity>
      <img class="handoff__logo" :src="iconUrl" alt="" width="80" height="80" />
      <h1>NimConnect</h1>
      <p class="handoff__tagline">A relationship manager for your wallet.</p>
    </template>

    <template #panel>
      <p class="handoff__body">
        <template v-if="allowBrowserContinue !== false">
          Send NIM, manage contacts, split bills, and track payments.
          NimConnect is built to run inside <strong>Nimiq Pay</strong> on your phone.
        </template>
        <template v-else>
          On desktop, NimConnect works best for <strong>payment request</strong> and
          <strong>profile share</strong> links — open one of those to pay or view a contact.
          For everything else, use <strong>Nimiq Pay</strong> on your phone.
        </template>
      </p>
    </template>

    <template #primary>
      <a :href="NIMPAY_OPEN_URL">Open in Nimiq Pay</a>
    </template>

    <template #tertiary>
      <PublicStoreLinks />
    </template>

    <template #footer>
      <p>Open with <strong>Nimiq Pay</strong> · <strong>NimConnect</strong></p>
      <button
        v-if="allowBrowserContinue !== false"
        type="button"
        @click="emit('continue')"
      >
        Continue in browser (contacts &amp; backups only)
      </button>
    </template>
  </PublicSurface>
</template>

<style scoped>
.handoff__logo {
  border-radius: 22%;
  box-shadow: var(--nimiq-shadow-card);
}

h1 {
  color: var(--text);
  font-size: 1.75rem;
  line-height: 1.15;
  margin: 0;
}

.handoff__tagline {
  color: var(--text);
  font-size: 1rem;
  font-weight: 700;
  margin: 0;
  opacity: 0.85;
}

.handoff__body {
  color: var(--text-2);
  line-height: 1.5;
  max-width: 21.25rem;
}

.handoff__body strong { color: var(--public-ink); font-weight: 800; }
</style>
