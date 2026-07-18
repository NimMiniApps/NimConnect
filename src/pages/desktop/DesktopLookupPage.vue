<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  handleForAddress,
  parsePublicLookupQuery,
  resolveHandle,
} from '../../services/handles'

const router = useRouter()
const query = ref('')
const error = ref<string | null>(null)
const pending = ref(false)

async function submitLookup() {
  error.value = null
  const parsed = parsePublicLookupQuery(query.value)
  if (parsed.kind === 'invalid') {
    error.value = 'Enter an @handle or Nimiq address'
    return
  }
  pending.value = true
  try {
    const claim = parsed.kind === 'handle'
      ? await resolveHandle(parsed.handle)
      : await handleForAddress(parsed.address)
    if (!claim) {
      error.value = 'No public @handle found'
      return
    }
    await router.push(`/u/${claim.handle}`)
  } catch {
    error.value = 'Lookup failed — try again'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <section class="desktop-lookup">
    <p class="desktop-lookup__brand">NimConnect</p>
    <h1 class="desktop-lookup__headline">Find a public profile.</h1>
    <p class="desktop-lookup__subtext">
      Look up a claimed @handle or Nimiq address to view its public payment page.
    </p>

    <form
      class="desktop-lookup__form"
      data-desktop-lookup
      @submit.prevent="submitLookup"
    >
      <label class="desktop-lookup__label" for="desktop-lookup-input">
        @handle or Nimiq address
      </label>
      <div class="desktop-lookup__row">
        <input
          id="desktop-lookup-input"
          v-model="query"
          class="desktop-lookup__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="@handle or Nimiq address"
          :disabled="pending"
        />
        <button type="submit" class="nq-button" :disabled="pending">Look up</button>
      </div>
      <p v-if="error" class="desktop-lookup__error" role="status">{{ error }}</p>
    </form>
  </section>
</template>

<style scoped>
.desktop-lookup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  max-width: 640px;
  margin: 0 auto;
  padding: 64px 16px 32px;
  text-align: center;
}
.desktop-lookup__brand {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--nq-gold-dark);
}
.desktop-lookup__headline {
  margin: 0;
  font-size: 40px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--text);
}
.desktop-lookup__subtext {
  margin: 0;
  max-width: 30rem;
  font-size: 17px;
  line-height: 1.5;
  color: var(--text-2);
}
.desktop-lookup__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 26rem;
  margin-top: 12px;
  padding: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 1rem;
  box-shadow: var(--shadow);
  text-align: left;
}
.desktop-lookup__label {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}
.desktop-lookup__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.desktop-lookup__input {
  appearance: none;
  flex: 1 1 12rem;
  min-width: 0;
  min-height: 48px;
  padding: 0 16px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  box-sizing: border-box;
}
.desktop-lookup__input::placeholder {
  color: var(--text-2);
  font-weight: 500;
}
.desktop-lookup__input:hover:not(:disabled) {
  border-color: var(--text-2);
}
.desktop-lookup__input:focus {
  border-color: var(--nq-light-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nq-light-blue) 12%, transparent);
}
.desktop-lookup__row .nq-button {
  flex: 0 0 auto;
}
.desktop-lookup__error {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--nimiq-red);
}
</style>
