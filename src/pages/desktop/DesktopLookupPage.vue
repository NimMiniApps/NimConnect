<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import Identicon from '../../components/Identicon.vue'
import QrCode from '../../components/QrCode.vue'
import {
  claimOwnerAddress,
  checkHandle,
  fetchPublicProfile,
  handleForAddress,
  parsePublicLookupQuery,
  resolveHandle,
  type HandleClaim,
  type PublicProfile,
} from '../../services/handles'
import { makeRequestLink } from '../../services/links'

const EXAMPLES = [
  { label: '@maestro', value: '@maestro' },
  { label: '@demo', value: '@demo' },
  { label: 'NQ26…9YDF', value: 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF' },
]

const FINDS = [
  'Public profile',
  'Payment page',
  'Verified handle',
  'Website',
  'GitHub',
]

type MatchedBy = 'handle' | 'address'

const query = ref('')
const error = ref<string | null>(null)
const pending = ref(false)
const result = ref<{
  claim: HandleClaim
  profile: PublicProfile | null
  matchedBy: MatchedBy
} | null>(null)
const claimableHandle = ref<string | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)

function clearLookup() {
  query.value = ''
  error.value = null
  result.value = null
  claimableHandle.value = null
  pending.value = false
}

watch(query, () => {
  if (pending.value) return
  error.value = null
  result.value = null
  claimableHandle.value = null
})

function useExample(value: string) {
  query.value = value
  error.value = null
  result.value = null
  claimableHandle.value = null
  void nextTick(() => inputEl.value?.focus())
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    clearLookup()
    inputEl.value?.focus()
  }
}

async function submitLookup() {
  error.value = null
  result.value = null
  claimableHandle.value = null

  const parsed = parsePublicLookupQuery(query.value)
  if (parsed.kind === 'invalid') {
    error.value = 'Enter an @handle or Nimiq address'
    return
  }

  pending.value = true
  try {
    const matchedBy: MatchedBy = parsed.kind === 'handle' ? 'handle' : 'address'
    const claim = matchedBy === 'handle'
      ? await resolveHandle(parsed.handle)
      : await handleForAddress(parsed.address)

    if (!claim) {
      error.value = "We couldn't find that public identity. Check the @handle or wallet address and try again."
      if (matchedBy === 'handle') {
        try {
          const check = await checkHandle(parsed.handle)
          if (check.available) claimableHandle.value = parsed.handle
        } catch { /* keep the not-found message */ }
      }
      return
    }

    const owner = claimOwnerAddress(claim)
    const published = await fetchPublicProfile(owner)
    result.value = {
      claim,
      profile: published?.profile ?? null,
      matchedBy,
    }
  } catch {
    error.value = 'Lookup failed — try again'
  } finally {
    pending.value = false
  }
}

onMounted(() => {
  inputEl.value?.focus()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="desktop-lookup" data-desktop-lookup-page>
    <section class="desktop-lookup__hero">
      <p class="desktop-lookup__brand">NimConnect</p>
      <h1 class="desktop-lookup__headline">Find a public profile.</h1>
      <p class="desktop-lookup__subtext">
        Find any public Nimiq identity by @handle or wallet address.
      </p>
      <p class="desktop-lookup__support">
        View public profiles, payment pages and verified identities.
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
          <div class="desktop-lookup__field">
            <span class="desktop-lookup__search-icon" aria-hidden="true" />
            <input
              id="desktop-lookup-input"
              ref="inputEl"
              v-model="query"
              class="desktop-lookup__input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="@maestro or NQ26…"
              :disabled="pending"
            />
          </div>
          <RouterLink
            v-if="result && !pending"
            class="nq-button"
            :to="`/u/${result.claim.handle}`"
          >
            View full profile
          </RouterLink>
          <button
            v-else
            type="submit"
            class="nq-button"
            :disabled="pending"
            :aria-busy="pending"
          >
            <span
              v-if="pending"
              class="desktop-lookup__spinner"
              aria-hidden="true"
            />
            <span>{{ pending ? 'Looking up…' : 'Look up' }}</span>
          </button>
        </div>

        <div v-if="error" class="desktop-lookup__error" role="status">
          <p>{{ error }}</p>
          <RouterLink
            v-if="claimableHandle"
            class="desktop-lookup__claim"
            to="/me"
          >
            Claim @{{ claimableHandle }} →
          </RouterLink>
        </div>

        <ul class="desktop-lookup__finds" aria-label="What a lookup can return">
          <li v-for="item in FINDS" :key="item">
            <span aria-hidden="true">✓</span>
            {{ item }}
          </li>
        </ul>
      </form>
    </section>

    <div class="desktop-lookup__stage" aria-live="polite">
      <div
        v-if="pending"
        class="desktop-lookup__skeleton"
        data-desktop-lookup-skeleton
      >
        <div class="desktop-lookup__skeleton-top">
          <span class="desktop-lookup__skeleton-avatar" />
          <span class="desktop-lookup__skeleton-lines">
            <span />
            <span />
          </span>
        </div>
        <span class="desktop-lookup__skeleton-block" />
        <span class="desktop-lookup__skeleton-block desktop-lookup__skeleton-block--short" />
      </div>

      <Transition name="desktop-lookup-result">
        <article
          v-if="result"
          class="desktop-lookup__result"
          data-desktop-lookup-result
        >
          <p class="desktop-lookup__matched">
            Found by {{ result.matchedBy === 'handle' ? '@handle' : 'wallet address' }}
          </p>
          <div class="desktop-lookup__result-top">
            <Identicon :address="claimOwnerAddress(result.claim)" :size="74" />
            <div>
              <p class="desktop-lookup__result-handle">@{{ result.claim.handle }}</p>
              <p class="desktop-lookup__result-badge">Verified on-chain</p>
              <p class="desktop-lookup__result-url">/@{{ result.claim.handle }}</p>
            </div>
            <div class="desktop-lookup__result-pay" title="Payment page available">
              <QrCode
                :text="makeRequestLink(claimOwnerAddress(result.claim))"
                :size="56"
              />
            </div>
          </div>
          <h2 v-if="result.profile?.display_name" class="desktop-lookup__result-name">
            {{ result.profile.display_name }}
          </h2>
          <p v-if="result.profile?.bio" class="desktop-lookup__result-bio">
            {{ result.profile.bio }}
          </p>
          <ul
            v-if="result.profile?.website || result.profile?.github || result.profile?.tags?.length"
            class="desktop-lookup__result-meta"
          >
            <li v-if="result.profile?.website" class="desktop-lookup__result-meta-link">
              {{ result.profile.website.replace(/^https?:\/\//, '') }}
            </li>
            <li v-if="result.profile?.github" class="desktop-lookup__result-meta-link">
              github.com/{{ result.profile.github.replace(/^@/, '') }}
            </li>
            <li v-for="tag in result.profile?.tags ?? []" :key="tag">{{ tag }}</li>
          </ul>
          <RouterLink
            class="nq-button desktop-lookup__result-cta"
            :to="`/u/${result.claim.handle}`"
          >
            View full profile
          </RouterLink>
        </article>
      </Transition>

      <section
        v-if="!result && !pending"
        class="desktop-lookup__examples"
        aria-label="Example lookups"
      >
        <h2>Try searching for</h2>
        <div class="desktop-lookup__example-row">
          <button
            v-for="example in EXAMPLES"
            :key="example.label"
            type="button"
            class="desktop-lookup__example"
            @click="useExample(example.value)"
          >
            {{ example.label }}
          </button>
        </div>
        <p>Examples fill the search box so you can try the flow immediately.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.desktop-lookup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 16px 48px;
  text-align: center;
}

.desktop-lookup__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.desktop-lookup__brand {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--nq-gold-dark);
}

.desktop-lookup__headline {
  margin: 0;
  font-size: clamp(2.2rem, 4vw, 2.75rem);
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: -0.02em;
  color: var(--text);
}

.desktop-lookup__subtext {
  margin: 0;
  max-width: 28rem;
  font-size: 18px;
  line-height: 1.55;
  color: var(--text-2);
  font-weight: 600;
}

.desktop-lookup__support {
  margin: 0;
  max-width: 28rem;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-2);
}

.desktop-lookup__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 34rem;
  margin-top: 8px;
  padding: 22px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--card) 98%, var(--nq-gold)),
      var(--card)
    );
  border: 1px solid var(--border);
  border-radius: 1.125rem;
  box-shadow:
    0 16px 40px color-mix(in srgb, var(--text) 10%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--nimiq-white) 5%, transparent);
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
  align-items: stretch;
  gap: 10px;
}

.desktop-lookup__field {
  position: relative;
  flex: 1 1 14rem;
  min-width: 0;
}

.desktop-lookup__search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  width: 18px;
  height: 18px;
  transform: translateY(-50%);
  background: center / contain no-repeat
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23e5a212' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 1;
}

.desktop-lookup__input {
  appearance: none;
  width: 100%;
  min-height: 56px;
  padding: 0 18px 0 44px;
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.95rem;
  box-sizing: border-box;
  transition:
    border-color var(--attr-duration) var(--nimiq-ease),
    box-shadow var(--attr-duration) var(--nimiq-ease);
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
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nq-light-blue) 14%, transparent);
}

.desktop-lookup__row .nq-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 56px;
}

.desktop-lookup__spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, currentColor 35%, transparent);
  border-top-color: currentColor;
  animation: desktop-lookup-spin 0.7s linear infinite;
}

@keyframes desktop-lookup-spin {
  to { transform: rotate(360deg); }
}

.desktop-lookup__error {
  display: grid;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--nimiq-red);
}

.desktop-lookup__error p {
  margin: 0;
}

.desktop-lookup__claim {
  color: var(--nq-gold-dark);
  font-weight: 800;
  text-decoration: none;
}

.desktop-lookup__claim:hover {
  text-decoration: underline;
}

.desktop-lookup__finds {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.desktop-lookup__finds li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: var(--nimiq-radius-pill);
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 55%, var(--card));
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.desktop-lookup__finds span {
  color: var(--nimiq-green);
}

.desktop-lookup__stage {
  width: 100%;
  max-width: 34rem;
  min-height: 10rem;
}

.desktop-lookup__skeleton,
.desktop-lookup__result,
.desktop-lookup__examples {
  width: 100%;
}

.desktop-lookup__skeleton {
  display: grid;
  gap: 14px;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: 1.125rem;
  background: var(--card);
}

.desktop-lookup__skeleton-top {
  display: flex;
  align-items: center;
  gap: 14px;
}

.desktop-lookup__skeleton-avatar,
.desktop-lookup__skeleton-lines span,
.desktop-lookup__skeleton-block {
  display: block;
  border-radius: 10px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--border) 70%, transparent),
    color-mix(in srgb, var(--text) 8%, var(--border)),
    color-mix(in srgb, var(--border) 70%, transparent)
  );
  background-size: 200% 100%;
  animation: desktop-lookup-shimmer 1.2s linear infinite;
}

.desktop-lookup__skeleton-avatar {
  width: 74px;
  height: 74px;
  border-radius: 50%;
}

.desktop-lookup__skeleton-lines {
  display: grid;
  gap: 8px;
  flex: 1;
}

.desktop-lookup__skeleton-lines span:first-child {
  width: 40%;
  height: 14px;
}

.desktop-lookup__skeleton-lines span:last-child {
  width: 55%;
  height: 12px;
}

.desktop-lookup__skeleton-block {
  width: 72%;
  height: 14px;
}

.desktop-lookup__skeleton-block--short {
  width: 48%;
}

@keyframes desktop-lookup-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.desktop-lookup__result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 20px 22px;
  border: 1px solid var(--border);
  border-radius: 1.125rem;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, var(--nq-gold)) 0%, var(--card) 45%);
  box-shadow: 0 16px 40px color-mix(in srgb, var(--text) 10%, transparent);
  text-align: left;
}

.desktop-lookup__matched {
  margin: 0;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-2);
}

.desktop-lookup__result-top {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
  width: 100%;
}

.desktop-lookup__result-handle {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--nq-gold-dark);
}

.desktop-lookup__result-badge {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 800;
  color: var(--nimiq-green);
}

.desktop-lookup__result-url {
  margin: 4px 0 0;
  font-family: var(--nimiq-font-family-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-2);
}

.desktop-lookup__result-pay {
  padding: 4px;
  border-radius: 10px;
  background: var(--nimiq-white);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--text) 10%, transparent);
}

.desktop-lookup__result-pay :deep(.qr) {
  padding: 0;
  border-radius: 6px;
}

.desktop-lookup__result-name {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
}

.desktop-lookup__result-bio {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--text-2);
}

.desktop-lookup__result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.desktop-lookup__result-meta li {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 6px 10px;
  border-radius: var(--nimiq-radius-pill);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.desktop-lookup__result-meta-link {
  font-family: var(--nimiq-font-family-mono);
  color: var(--text-2);
}

.desktop-lookup__result-cta {
  margin-top: 2px;
  text-decoration: none;
}

.desktop-lookup__examples {
  display: grid;
  gap: 12px;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--card) 88%, transparent);
}

.desktop-lookup__examples h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text);
}

.desktop-lookup__examples > p {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

.desktop-lookup__example-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.desktop-lookup__example {
  appearance: none;
  padding: 10px 14px;
  border-radius: var(--nimiq-radius-pill);
  border: 1px solid color-mix(in srgb, var(--nq-gold-dark) 35%, var(--border));
  background: color-mix(in srgb, var(--nq-gold) 10%, var(--card));
  color: var(--nq-gold-dark);
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition:
    transform var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease);
}

.desktop-lookup__example:hover {
  transform: translateY(-1px);
  border-color: var(--nq-gold-dark);
}

.desktop-lookup-result-enter-active,
.desktop-lookup-result-leave-active {
  transition:
    opacity var(--movement-duration) var(--nimiq-ease),
    transform var(--movement-duration) var(--nimiq-ease);
}

.desktop-lookup-result-enter-from,
.desktop-lookup-result-leave-to {
  opacity: 0;
  transform: translateY(14px);
}

@media (max-width: 560px) {
  .desktop-lookup__row {
    flex-direction: column;
  }

  .desktop-lookup__row .nq-button {
    width: 100%;
  }

  .desktop-lookup__result-top {
    grid-template-columns: auto 1fr;
  }

  .desktop-lookup__result-pay {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .desktop-lookup__spinner,
  .desktop-lookup__skeleton-avatar,
  .desktop-lookup__skeleton-lines span,
  .desktop-lookup__skeleton-block {
    animation: none;
  }

  .desktop-lookup-result-enter-active,
  .desktop-lookup-result-leave-active {
    transition: none;
  }
}
</style>
