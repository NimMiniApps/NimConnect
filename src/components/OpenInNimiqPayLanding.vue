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
    lookupError.value = 'Lookup failed - try again'
  } finally {
    lookupPending.value = false
  }
}

const emit = defineEmits<{ continue: [] }>()
const props = withDefaults(defineProps<{ allowBrowserContinue?: boolean; openUrl?: string }>(), {
  allowBrowserContinue: true,
})

const openUrl = computed(() => props.openUrl || NIMPAY_OPEN_URL)
const isDesktop = computed(() => props.allowBrowserContinue === false)
const lookupInput = ref<HTMLInputElement | null>(null)

function focusLookup() {
  lookupInput.value?.focus()
}

function openPay() {
  window.location.assign(openUrl.value)
}

function openContactsHint() {
  if (!isDesktop.value) emit('continue')
  else focusLookup()
}

const iconUrl = `${import.meta.env.BASE_URL}brand/nimconnect-icon-192x192.png`
</script>

<template>
  <PublicSurface context="NimConnect">
    <template #identity>
      <a class="handoff__brand-link" href="#/" aria-label="NimConnect home">
        <img class="handoff__logo" :src="iconUrl" alt="" width="80" height="80" />
        <h1>NimConnect</h1>
      </a>
      <p class="handoff__headline">People, not wallet addresses.</p>
      <p class="handoff__tagline">A relationship manager for your wallet.</p>
    </template>

    <template #panel>
      <p class="handoff__body">
        Manage contacts, share public @handles, and receive payments.
        Use <strong>Nimiq Pay</strong> on your phone for the full experience.
      </p>

      <ul class="handoff__features" aria-label="What NimConnect offers">
        <li>
          <button
            type="button"
            class="handoff__feature"
            title="Get your own permanent public payment identity"
            @click="focusLookup"
          >
            <span class="handoff__feature-icon handoff__feature-icon--handle" aria-hidden="true" />
            <span class="handoff__feature-text">
              <span class="handoff__feature-title">Public @handles</span>
              <span class="handoff__feature-copy">Get your own permanent public payment identity.</span>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="handoff__feature"
            title="Share one link or QR to get paid instantly"
            @click="openPay"
          >
            <span class="handoff__feature-icon handoff__feature-icon--pay" aria-hidden="true" />
            <span class="handoff__feature-text">
              <span class="handoff__feature-title">Payment pages</span>
              <span class="handoff__feature-copy">Share one link or QR to get paid instantly.</span>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="handoff__feature"
            title="Save people, not long wallet addresses"
            @click="openContactsHint"
          >
            <span class="handoff__feature-icon handoff__feature-icon--contacts" aria-hidden="true" />
            <span class="handoff__feature-text">
              <span class="handoff__feature-title">Wallet contacts</span>
              <span class="handoff__feature-copy">Save people, not long wallet addresses.</span>
            </span>
          </button>
        </li>
      </ul>

      <form
        v-if="isDesktop"
        class="handoff__lookup"
        data-public-lookup
        @submit.prevent="submitLookup"
      >
        <label class="handoff__lookup-label" for="public-lookup-input">
          Look up a public profile
        </label>
        <div class="handoff__lookup-row">
          <input
            id="public-lookup-input"
            ref="lookupInput"
            class="handoff__lookup-input"
            v-model="lookupQuery"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="@handle or Nimiq address"
            :disabled="lookupPending"
          />
          <button type="submit" class="nq-button light-blue" :disabled="lookupPending">Look up</button>
        </div>
        <p v-if="lookupError" class="handoff__lookup-error" role="status">{{ lookupError }}</p>
      </form>
    </template>

    <template #primary>
      <a class="nq-button" :href="openUrl">Open in Nimiq Pay</a>
    </template>

    <template #tertiary>
      <PublicStoreLinks detailed />
    </template>

    <template #footer>
      <p>Public profiles • Payment pages • Wallet contacts</p>
      <button
        v-if="!isDesktop"
        type="button"
        @click="emit('continue')"
      >
        Continue in browser (contacts &amp; backups only)
      </button>
    </template>
  </PublicSurface>
</template>

<style scoped>
.handoff__brand-link {
  align-items: center;
  color: inherit;
  display: grid;
  gap: 0.5rem;
  justify-items: center;
  text-decoration: none;
}

.handoff__logo {
  border-radius: 22%;
  box-shadow: var(--nimiq-shadow-card);
}

h1 {
  color: var(--text);
  font-size: 1.5rem;
  line-height: 1.15;
  margin: 0;
}

.handoff__headline {
  color: var(--text);
  font-size: 1.5rem;
  font-weight: 800;
  line-height: 1.2;
  margin: 0;
  max-width: 18rem;
}

.handoff__tagline {
  color: var(--text-2);
  font-size: 0.8125rem;
  font-weight: 600;
  margin: 0;
}

.handoff__body {
  color: var(--text-2);
  font-size: 0.9375rem;
  line-height: 1.45;
  margin: 0;
  max-width: 22rem;
}

.handoff__body strong { color: var(--text); font-weight: 800; }

.handoff__features {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  width: 100%;
}

.handoff__features > li {
  margin: 0;
  width: 100%;
}

.handoff__feature {
  align-items: flex-start;
  background: color-mix(in srgb, var(--card) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 0.75rem;
  box-sizing: border-box;
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  text-align: left;
  transition:
    border-color 180ms var(--nimiq-ease),
    transform 180ms var(--nimiq-ease);
  width: 100%;
}

.handoff__feature:hover {
  border-color: color-mix(in srgb, var(--text) 28%, transparent);
  transform: translateY(-2px);
}

.handoff__feature:active {
  transform: translateY(0);
}

.handoff__feature-icon {
  background: color-mix(in srgb, var(--nq-light-blue) 16%, transparent);
  border-radius: 0.5rem;
  color: var(--nq-gold);
  flex: 0 0 auto;
  height: 2rem;
  position: relative;
  width: 2rem;
}

.handoff__feature-icon::before {
  background: currentColor;
  content: '';
  inset: 0.4rem;
  mask: center / contain no-repeat;
  position: absolute;
}

.handoff__feature-icon--handle::before {
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M12 2a5 5 0 1 1 0 10A5 5 0 0 1 12 2zm0 12c4.42 0 8 1.79 8 4v2H4v-2c0-2.21 3.58-4 8-4z'/%3E%3C/svg%3E");
}

.handoff__feature-icon--pay::before {
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M3 5h18v14H3V5zm2 2v10h14V7H5zm2 2h2v2H7V9zm4 0h2v2h-2V9zm4 0h2v2h-2V9zM7 13h2v2H7v-2zm4 0h6v2h-6v-2z'/%3E%3C/svg%3E");
}

.handoff__feature-icon--contacts::before {
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M16 11a4 4 0 1 0-3.46-6A5 5 0 0 0 7 9a4 4 0 0 0-2 7.46V20h2v-2.54A4 4 0 0 0 9 11h7zm-9 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm9 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm-6.5 8A3.5 3.5 0 0 1 12 15.5h6.5A2.5 2.5 0 0 1 21 18v2h-2v-2a.5.5 0 0 0-.5-.5H12a1.5 1.5 0 0 0-1.5 1.5V20h-2v-1z'/%3E%3C/svg%3E");
}

.handoff__feature-text {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}

.handoff__feature-title {
  color: var(--text);
  font-size: 0.875rem;
  font-weight: 800;
}

.handoff__feature-copy {
  color: var(--text-2);
  font-size: 0.75rem;
  line-height: 1.35;
}

.handoff__lookup {
  background: color-mix(in srgb, var(--card) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  margin-bottom: 0.75rem;
  margin-top: 0.25rem;
  padding: 0.875rem;
  text-align: left;
  width: 100%;
}

.handoff__lookup-label {
  color: var(--text);
  font-size: 0.875rem;
  font-weight: 800;
}

.handoff__lookup-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  width: 100%;
}

.handoff__lookup-input {
  appearance: none;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  box-shadow: inset 0 1px 2px rgb(31 35 72 / 0.04);
  box-sizing: border-box;
  color: var(--text);
  flex: 1 1 10rem;
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  min-height: 3rem;
  min-width: 0;
  padding: 0.75rem 1rem;
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

.handoff__lookup-row .nq-button {
  flex: 0 0 auto;
  min-height: 3rem;
}

.handoff__lookup-error {
  color: var(--nimiq-red);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
}
</style>
