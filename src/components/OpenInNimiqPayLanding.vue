<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import PublicStoreLinks from './PublicStoreLinks.vue'
import PublicSurface from './PublicSurface.vue'
import { NIMPAY_OPEN_URL } from '../config/host-app'
import {
  handleForAddress,
  parsePublicLookupQuery,
  resolveHandle,
} from '../services/handles'

const router = useRouter()
const lookupQuery = ref('')
const lookupError = ref<string | null>(null)
const lookupPending = ref(false)

async function submitLookup() {
  lookupError.value = null
  const parsed = parsePublicLookupQuery(lookupQuery.value)
  if (parsed.kind === 'invalid') {
    lookupError.value = 'Enter an @handle or Nimiq address'
    return
  }
  lookupPending.value = true
  try {
    const claim = parsed.kind === 'handle'
      ? await resolveHandle(parsed.handle)
      : await handleForAddress(parsed.address)
    if (!claim) {
      lookupError.value = 'No public @handle found'
      return
    }
    await router.push(`/u/${claim.handle}`)
  } catch {
    lookupError.value = 'Lookup failed — try again'
  } finally {
    lookupPending.value = false
  }
}

const emit = defineEmits<{ continue: [] }>()
const props = withDefaults(defineProps<{ allowBrowserContinue?: boolean; openUrl?: string }>(), {
  allowBrowserContinue: true,
})

const openUrl = computed(() => props.openUrl || NIMPAY_OPEN_URL)

const iconUrl = `${import.meta.env.BASE_URL}icon.svg`
</script>

<template>
  <PublicSurface context="NimConnect">
    <template #identity>
      <img class="handoff__logo" :src="iconUrl" alt="" width="96" height="96" />
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
          <strong>profile share</strong> links — open one of those to pay or view a contact —
          or to look up public <strong>@handles</strong>.
          For everything else, use <strong>Nimiq Pay</strong> on your phone.
        </template>
      </p>
    </template>

    <template #primary>
      <a class="nq-button" :href="openUrl">Open in Nimiq Pay</a>
    </template>

    <template #secondary>
      <form
        v-if="allowBrowserContinue === false"
        class="handoff__lookup"
        data-public-lookup
        @submit.prevent="submitLookup"
      >
        <label class="handoff__lookup-label" for="public-lookup-input">
          Look up a public profile
        </label>
        <input
          id="public-lookup-input"
          class="handoff__lookup-input"
          v-model="lookupQuery"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="@handle or Nimiq address"
          :disabled="lookupPending"
        />
        <button type="submit" class="nq-button" :disabled="lookupPending">Look up</button>
        <p v-if="lookupError" class="handoff__lookup-error" role="status">{{ lookupError }}</p>
      </form>
    </template>

    <template #tertiary>
      <PublicStoreLinks detailed />
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

.handoff__body strong { color: var(--text); font-weight: 800; }

.handoff__lookup {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
}

.handoff__lookup-label {
  color: var(--text-2);
  font-size: 0.875rem;
  font-weight: 600;
}

.handoff__lookup-input {
  appearance: none;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  box-shadow: inset 0 1px 2px rgb(31 35 72 / 0.04);
  box-sizing: border-box;
  color: var(--text);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  min-height: 3rem;
  padding: 0.75rem 1rem;
  width: 100%;
}

.handoff__lookup-input::placeholder {
  color: var(--text-2);
  font-weight: 500;
}

.handoff__lookup-input:hover:not(:disabled) {
  border-color: var(--text-2);
}

.handoff__lookup-input:focus {
  border-color: var(--nq-light-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nq-light-blue) 12%, transparent);
}

.handoff__lookup-error {
  color: var(--nimiq-red);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
}
</style>
