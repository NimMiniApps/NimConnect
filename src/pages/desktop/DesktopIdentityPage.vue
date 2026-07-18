<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { chooseHubAddress, hubSignMessage } from '../../services/hub'
import {
  getDesktopHubAddress,
  setDesktopHubAddress,
  clearDesktopHubAddress,
} from '../../services/desktop-session'
import {
  findMyHandle,
  fetchPublicProfile,
  checkHandle,
  claimHandleViaHub,
  claimOwnerAddress,
  isValidHandle,
  defaultShareSelection,
  shareFromPublished,
  syncPublicProfile,
  saveMyHandle,
  type HandleClaim,
  type ShareSelection,
} from '../../services/handles'
import { makePublicHandleLink, shortAddress } from '../../services/links'
import { copyText } from '../../services/share'
import Identicon from '../../components/Identicon.vue'
import QrCode from '../../components/QrCode.vue'
import TagChips from '../../components/TagChips.vue'
import type { Profile } from '../../types/profile'

const HUB_INSTALL_HINT = 'Install or open a Nimiq Hub compatible wallet'

/** Best-effort mapping of Hub popup rejection to a quieter message than the generic hint. */
function hubErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  if (/cancel/i.test(message)) return 'Canceled — no changes were made.'
  return HUB_INSTALL_HINT
}

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'unknown'

const AVAILABILITY_HINTS: Record<Availability, string> = {
  idle: '3–31 characters (a–z, 0–9, _)',
  checking: 'Checking availability…',
  available: 'Looks available ✓ (the chain has the final say)',
  taken: 'Already claimed',
  reserved: 'Reserved name',
  invalid: '3–31 characters (a–z, 0–9, _)',
  unknown: 'Could not check availability — you can still try to claim',
}

const hubAddress = ref<string | null>(null)
const connecting = ref(false)
const connectError = ref<string | null>(null)
const loadingIdentity = ref(false)

const claim = ref<HandleClaim | null>(null)

const handleInput = ref('')
const availability = ref<Availability>('idle')
const claiming = ref(false)
const claimError = ref<string | null>(null)
let availabilityTimer: ReturnType<typeof setTimeout> | undefined

const name = ref('')
const bio = ref('')
const website = ref('')
const github = ref('')
const x = ref('')
const tags = ref<string[]>([])
const share = ref<ShareSelection>(defaultShareSelection())

const publishing = ref(false)
const publishNote = ref<string | null>(null)
const saveError = ref<string | null>(null)
const copyFeedback = ref<string | null>(null)

const connected = computed(() => !!hubAddress.value)
const hasClaim = computed(() => !!claim.value)
const handleConfirming = computed(() => !!claim.value && !claim.value.block_height)
const shortHubAddress = computed(() => (hubAddress.value ? shortAddress(hubAddress.value) : ''))

const canClaim = computed(() =>
  isValidHandle(handleInput.value.trim().toLowerCase())
  && availability.value !== 'taken'
  && availability.value !== 'reserved'
  && !claiming.value,
)

function resetProfileFields() {
  name.value = ''
  bio.value = ''
  website.value = ''
  github.value = ''
  x.value = ''
  tags.value = []
  share.value = defaultShareSelection()
}

function visibilityOn(key: keyof ShareSelection, hasValue: boolean): boolean {
  return hasValue && !!share.value[key]
}

function toggleVisibility(key: keyof ShareSelection, hasValue: boolean) {
  if (!hasValue) return
  share.value = { ...share.value, [key]: !share.value[key] }
}

async function loadProfileForEditing(c: HandleClaim) {
  try {
    const remote = await fetchPublicProfile(claimOwnerAddress(c))
    const profile = remote?.profile ?? null
    name.value = profile?.display_name ?? ''
    bio.value = profile?.bio ?? ''
    website.value = profile?.website ?? ''
    github.value = profile?.github ?? ''
    x.value = profile?.x ?? ''
    tags.value = profile?.tags ? [...profile.tags] : []
    share.value = shareFromPublished(profile)
  } catch {
    resetProfileFields()
  }
}

async function loadIdentity(addr: string) {
  loadingIdentity.value = true
  connectError.value = null
  try {
    const found = await findMyHandle([addr])
    claim.value = found
    if (found) {
      saveMyHandle([addr], found)
      await loadProfileForEditing(found)
    } else {
      resetProfileFields()
    }
  } catch {
    connectError.value = 'Could not check your identity — try again.'
  } finally {
    loadingIdentity.value = false
  }
}

async function authorize() {
  connectError.value = null
  connecting.value = true
  try {
    const addr = await chooseHubAddress()
    setDesktopHubAddress(addr)
    hubAddress.value = addr
    await loadIdentity(addr)
  } catch (e) {
    connectError.value = hubErrorMessage(e)
  } finally {
    connecting.value = false
  }
}

function disconnect() {
  clearDesktopHubAddress()
  hubAddress.value = null
  claim.value = null
  connectError.value = null
  publishNote.value = null
  saveError.value = null
  handleInput.value = ''
  availability.value = 'idle'
  resetProfileFields()
}

watch(handleInput, (value) => {
  clearTimeout(availabilityTimer)
  claimError.value = null
  const h = value.trim().toLowerCase()
  if (!h) {
    availability.value = 'idle'
    return
  }
  if (!isValidHandle(h)) {
    availability.value = 'invalid'
    return
  }
  availability.value = 'checking'
  availabilityTimer = setTimeout(async () => {
    try {
      const check = await checkHandle(h)
      availability.value = check.available ? 'available' : ((check.reason as Availability) || 'taken')
    } catch {
      availability.value = 'unknown'
    }
  }, 400)
})

async function submitClaim() {
  if (!hubAddress.value || !canClaim.value) return
  claiming.value = true
  claimError.value = null
  const addr = hubAddress.value
  try {
    const h = handleInput.value.trim().toLowerCase()
    const { claim: newClaim, txHash } = await claimHandleViaHub(h, addr)
    claim.value = newClaim ?? {
      handle: h,
      address: addr,
      tx_hash: txHash,
      block_height: 0,
      tx_index: 0,
    }
    resetProfileFields()
  } catch (e) {
    claimError.value = hubErrorMessage(e)
  } finally {
    claiming.value = false
  }
}

function buildProfileForSync(): Profile {
  const now = Date.now()
  const addr = hubAddress.value ?? ''
  return {
    id: addr,
    address: addr,
    name: name.value.trim(),
    type: 'person',
    isSelf: true,
    notes: '',
    tags: [...tags.value],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    bio: bio.value.trim() || undefined,
    website: website.value.trim() || undefined,
    github: github.value.trim() || undefined,
    x: x.value.trim().replace(/^@/, '') || undefined,
  }
}

async function save() {
  if (!hubAddress.value || !claim.value) return
  publishing.value = true
  publishNote.value = null
  saveError.value = null
  const addr = hubAddress.value
  try {
    const result = await syncPublicProfile(
      buildProfileForSync(),
      share.value,
      [addr],
      (msg) => hubSignMessage(msg, addr),
    )
    publishNote.value = result === 'published'
      ? 'Public profile published ✓'
      : result === 'unpublished'
        ? 'Public profile cleared'
        : 'Nothing to publish yet — mark a field public first'
  } catch (e) {
    saveError.value = hubErrorMessage(e)
  } finally {
    publishing.value = false
  }
}

const shareLink = computed(() => (claim.value ? makePublicHandleLink(claim.value.handle) : ''))

async function copyShareLink() {
  if (!shareLink.value) return
  await copyText(shareLink.value)
  copyFeedback.value = 'Link copied ✓'
  window.setTimeout(() => { copyFeedback.value = null }, 2500)
}

const livePreview = computed(() => ({
  handle: claim.value?.handle ?? '',
  name: share.value.name ? name.value.trim() : '',
  bio: share.value.bio ? bio.value.trim() : '',
  website: share.value.website ? website.value.trim() : '',
  github: share.value.github ? github.value.trim() : '',
  x: share.value.x ? x.value.trim().replace(/^@/, '') : '',
  tags: share.value.tags ? tags.value : [],
}))

const livePreviewEmpty = computed(() =>
  !livePreview.value.name
  && !livePreview.value.bio
  && !livePreview.value.website
  && !livePreview.value.github
  && !livePreview.value.x
  && !livePreview.value.tags.length,
)

onMounted(async () => {
  const stored = getDesktopHubAddress()
  if (!stored) return
  hubAddress.value = stored
  await loadIdentity(stored)
})
</script>

<template>
  <section class="desktop-identity" data-desktop-identity>
    <header class="desktop-identity__head">
      <p class="desktop-identity__brand">NimConnect</p>
      <h1 class="desktop-identity__headline">My Identity</h1>
    </header>

    <div v-if="!connected" class="desktop-identity__connect" data-desktop-identity-connect>
      <p class="desktop-identity__connect-copy">
        Authorize with a Nimiq Hub compatible wallet to claim your @handle and manage your
        public profile.
      </p>
      <button
        type="button"
        class="nq-button"
        :disabled="connecting"
        @click="authorize"
      >
        {{ connecting ? 'Opening Nimiq Hub…' : 'Authorize identity' }}
      </button>
      <p v-if="connectError" class="desktop-identity__error" role="alert">{{ connectError }}</p>
    </div>

    <template v-else>
      <div class="desktop-identity__session">
        <Identicon :address="hubAddress ?? ''" :size="40" />
        <div class="desktop-identity__session-info">
          <span class="desktop-identity__session-address">{{ shortHubAddress }}</span>
          <span v-if="claim" class="desktop-identity__session-handle">@{{ claim.handle }}</span>
        </div>
        <div class="desktop-identity__session-actions">
          <button type="button" class="desktop-identity__link-btn" :disabled="connecting" @click="authorize">
            Switch account
          </button>
          <button type="button" class="desktop-identity__link-btn" @click="disconnect">
            Disconnect
          </button>
        </div>
      </div>
      <p v-if="connectError" class="desktop-identity__error" role="alert">{{ connectError }}</p>

      <p v-if="loadingIdentity" class="desktop-identity__hint">Checking your identity…</p>

      <div v-else-if="!hasClaim" class="desktop-identity__claim" data-desktop-identity-claim>
        <h2 class="desktop-identity__section-title">Claim your identity</h2>
        <p class="desktop-identity__connect-copy">
          Pick a permanent @handle. You'll confirm a tiny on-chain transaction in the Nimiq Hub
          popup to authorize the claim — this isn't a payment.
        </p>
        <label class="desktop-identity__field">
          <span class="desktop-identity__field-label">Handle</span>
          <div class="desktop-identity__handle-input">
            <span aria-hidden="true">@</span>
            <input
              v-model="handleInput"
              maxlength="31"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              placeholder="ada"
            />
          </div>
        </label>
        <p
          class="desktop-identity__hint"
          :class="{ good: availability === 'available', bad: availability === 'taken' || availability === 'reserved' }"
        >
          {{ AVAILABILITY_HINTS[availability] }}
        </p>
        <p v-if="claimError" class="desktop-identity__error" role="alert">{{ claimError }}</p>
        <button
          type="button"
          class="nq-button"
          :disabled="!canClaim"
          @click="submitClaim"
        >
          {{ claiming ? 'Waiting for Nimiq Hub…' : 'Authorize your identity' }}
        </button>
      </div>

      <div v-else class="desktop-identity__layout">
        <form class="desktop-identity__form" data-desktop-identity-edit @submit.prevent="save">
          <p v-if="handleConfirming" class="desktop-identity__hint">
            Confirming @{{ claim!.handle }} on-chain — this can take a couple of minutes.
          </p>

          <div class="desktop-identity__field">
            <div class="desktop-identity__field-head">
              <span class="desktop-identity__field-label">Display name</span>
              <button
                type="button"
                class="desktop-identity__visibility"
                :class="visibilityOn('name', !!name.trim()) ? 'is-public' : 'is-private'"
                :aria-pressed="visibilityOn('name', !!name.trim())"
                :disabled="!name.trim()"
                @click="toggleVisibility('name', !!name.trim())"
              >
                {{ visibilityOn('name', !!name.trim()) ? '🌍 Public' : '🔒 Private' }}
              </button>
            </div>
            <input v-model="name" placeholder="Ada" autocomplete="name" />
          </div>

          <div class="desktop-identity__field">
            <div class="desktop-identity__field-head">
              <span class="desktop-identity__field-label">Bio</span>
              <button
                type="button"
                class="desktop-identity__visibility"
                :class="visibilityOn('bio', !!bio.trim()) ? 'is-public' : 'is-private'"
                :aria-pressed="visibilityOn('bio', !!bio.trim())"
                :disabled="!bio.trim()"
                @click="toggleVisibility('bio', !!bio.trim())"
              >
                {{ visibilityOn('bio', !!bio.trim()) ? '🌍 Public' : '🔒 Private' }}
              </button>
            </div>
            <textarea v-model="bio" rows="3" placeholder="A line about you…" />
          </div>

          <div class="desktop-identity__field-pair">
            <div class="desktop-identity__field">
              <div class="desktop-identity__field-head">
                <span class="desktop-identity__field-label">Website</span>
                <button
                  type="button"
                  class="desktop-identity__visibility"
                  :class="visibilityOn('website', !!website.trim()) ? 'is-public' : 'is-private'"
                  :aria-pressed="visibilityOn('website', !!website.trim())"
                  :disabled="!website.trim()"
                  @click="toggleVisibility('website', !!website.trim())"
                >
                  {{ visibilityOn('website', !!website.trim()) ? '🌍 Public' : '🔒 Private' }}
                </button>
              </div>
              <input v-model="website" type="url" inputmode="url" placeholder="https://…" />
            </div>

            <div class="desktop-identity__field">
              <div class="desktop-identity__field-head">
                <span class="desktop-identity__field-label">GitHub</span>
                <button
                  type="button"
                  class="desktop-identity__visibility"
                  :class="visibilityOn('github', !!github.trim()) ? 'is-public' : 'is-private'"
                  :aria-pressed="visibilityOn('github', !!github.trim())"
                  :disabled="!github.trim()"
                  @click="toggleVisibility('github', !!github.trim())"
                >
                  {{ visibilityOn('github', !!github.trim()) ? '🌍 Public' : '🔒 Private' }}
                </button>
              </div>
              <input v-model="github" placeholder="username" autocapitalize="none" />
            </div>
          </div>

          <div class="desktop-identity__field">
            <div class="desktop-identity__field-head">
              <span class="desktop-identity__field-label">X</span>
              <button
                type="button"
                class="desktop-identity__visibility"
                :class="visibilityOn('x', !!x.trim()) ? 'is-public' : 'is-private'"
                :aria-pressed="visibilityOn('x', !!x.trim())"
                :disabled="!x.trim()"
                @click="toggleVisibility('x', !!x.trim())"
              >
                {{ visibilityOn('x', !!x.trim()) ? '🌍 Public' : '🔒 Private' }}
              </button>
            </div>
            <input v-model="x" placeholder="handle" autocapitalize="none" />
          </div>

          <div class="desktop-identity__field">
            <div class="desktop-identity__field-head">
              <span class="desktop-identity__field-label">Tags</span>
              <button
                type="button"
                class="desktop-identity__visibility"
                :class="visibilityOn('tags', tags.length > 0) ? 'is-public' : 'is-private'"
                :aria-pressed="visibilityOn('tags', tags.length > 0)"
                :disabled="!tags.length"
                @click="toggleVisibility('tags', tags.length > 0)"
              >
                {{ visibilityOn('tags', tags.length > 0) ? '🌍 Public' : '🔒 Private' }}
              </button>
            </div>
            <TagChips v-model="tags" :suggestions="[]" />
          </div>

          <p v-if="saveError" class="desktop-identity__error" role="alert">{{ saveError }}</p>
          <p v-if="publishNote" class="desktop-identity__note" role="status">{{ publishNote }}</p>

          <button type="submit" class="nq-button" :disabled="publishing">
            {{ publishing ? 'Publishing…' : 'Save & publish' }}
          </button>
        </form>

        <aside class="desktop-identity__preview" data-desktop-identity-preview aria-label="Live public profile preview">
          <div class="desktop-identity__preview-head">
            <h2 class="desktop-identity__section-title">Live preview</h2>
            <router-link
              v-if="claim && !handleConfirming"
              :to="`/u/${claim.handle}`"
              class="desktop-identity__link-btn"
            >
              View live →
            </router-link>
          </div>
          <div class="desktop-identity__preview-card">
            <Identicon :address="hubAddress ?? ''" :size="64" />
            <p v-if="livePreview.name" class="desktop-identity__preview-name">{{ livePreview.name }}</p>
            <p v-if="claim" class="desktop-identity__preview-handle">@{{ claim.handle }}</p>
            <p v-if="livePreview.bio" class="desktop-identity__preview-bio">{{ livePreview.bio }}</p>
            <div v-if="livePreview.website || livePreview.github || livePreview.x" class="desktop-identity__preview-links">
              <span v-if="livePreview.website" class="desktop-identity__preview-link">🌐 {{ livePreview.website }}</span>
              <span v-if="livePreview.github" class="desktop-identity__preview-link">GitHub/{{ livePreview.github }}</span>
              <span v-if="livePreview.x" class="desktop-identity__preview-link">𝕏 @{{ livePreview.x }}</span>
            </div>
            <div v-if="livePreview.tags.length" class="desktop-identity__preview-tags">
              <span v-for="t in livePreview.tags" :key="t" class="desktop-identity__preview-tag">{{ t }}</span>
            </div>
            <p v-if="livePreviewEmpty" class="desktop-identity__hint">
              Mark a field public to see what others will see.
            </p>
          </div>

          <div v-if="claim && !handleConfirming" class="desktop-identity__share">
            <QrCode :text="shareLink" :size="140" />
            <button type="button" class="desktop-identity__link-btn" @click="copyShareLink">
              {{ copyFeedback ?? 'Copy public link' }}
            </button>
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.desktop-identity {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 960px;
  margin: 0 auto;
}
.desktop-identity__head { display: flex; flex-direction: column; gap: 4px; }
.desktop-identity__brand {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--nq-gold-dark);
}
.desktop-identity__headline {
  margin: 0;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
}

.desktop-identity__connect,
.desktop-identity__claim {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  max-width: 32rem;
  padding: 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.desktop-identity__connect-copy {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-2);
}
.desktop-identity__section-title { margin: 0; font-size: 17px; font-weight: 800; color: var(--text); }

.desktop-identity__session {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.desktop-identity__session-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.desktop-identity__session-address {
  font-family: var(--nimiq-font-family-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.desktop-identity__session-handle { font-size: 13px; font-weight: 800; color: var(--nq-gold-dark); }
.desktop-identity__session-actions { display: flex; gap: 16px; margin-left: auto; }

.desktop-identity__link-btn {
  border: none;
  background: transparent;
  color: var(--nq-light-blue);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  padding: 4px 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.desktop-identity__link-btn:disabled { opacity: 0.5; cursor: default; }

.desktop-identity__hint { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-2); }
.desktop-identity__hint.good { color: var(--nq-green); }
.desktop-identity__hint.bad { color: var(--nq-red); }
.desktop-identity__error { margin: 0; font-size: 14px; font-weight: 600; color: var(--nq-red); }
.desktop-identity__note { margin: 0; font-size: 14px; font-weight: 600; color: var(--nq-green); }

.desktop-identity__field { display: flex; flex-direction: column; gap: 6px; }
.desktop-identity__field-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px;
}
.desktop-identity__field-label { font-size: 13px; font-weight: 700; color: var(--text-2); }
.desktop-identity__field input,
.desktop-identity__field textarea {
  font: inherit;
  padding: 10px 12px;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-input);
  background: var(--bg);
  color: var(--text);
}
.desktop-identity__field-pair { display: flex; gap: 16px; }
.desktop-identity__field-pair .desktop-identity__field { flex: 1; min-width: 0; }

.desktop-identity__handle-input {
  display: flex; align-items: center; gap: 4px; padding: 0 12px; min-height: 48px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); font-size: 17px; font-weight: 700; color: var(--text);
}
.desktop-identity__handle-input input {
  flex: 1; min-width: 0; border: none; background: none; font: inherit; color: inherit; outline: none;
}

.desktop-identity__visibility {
  flex-shrink: 0;
  min-height: 28px; padding: 0 10px;
  border: none; border-radius: var(--nimiq-radius-pill);
  font: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  line-height: 1;
  transition: background var(--attr-duration) var(--nimiq-ease), color var(--attr-duration) var(--nimiq-ease);
}
.desktop-identity__visibility.is-public {
  color: var(--nq-light-blue);
  background: color-mix(in srgb, var(--nq-light-blue) 16%, transparent);
}
.desktop-identity__visibility.is-private {
  color: var(--text-2);
  background: color-mix(in srgb, var(--text) 6%, transparent);
}
.desktop-identity__visibility:disabled { opacity: 0.45; cursor: default; }

.desktop-identity__layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 32px;
  align-items: start;
}
.desktop-identity__form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.desktop-identity__form .nq-button { align-self: flex-start; }

.desktop-identity__preview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  position: sticky;
  top: 24px;
}
.desktop-identity__preview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.desktop-identity__preview-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  text-align: center; padding: 18px 12px;
  border-radius: 12px; background: var(--bg); border: 1px solid var(--border);
  min-height: 140px;
}
.desktop-identity__preview-name { margin: 4px 0 0; font-size: 18px; font-weight: 800; color: var(--text); }
.desktop-identity__preview-handle { margin: 0; font-size: 14px; font-weight: 800; color: var(--nq-gold-dark); }
.desktop-identity__preview-bio { margin: 4px 0 0; font-size: 13px; line-height: 1.4; color: var(--text-2); }
.desktop-identity__preview-links {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 6px;
}
.desktop-identity__preview-link { font-size: 12px; font-weight: 700; color: var(--nq-light-blue); }
.desktop-identity__preview-tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 6px; }
.desktop-identity__preview-tag {
  min-height: 24px; padding: 0 10px; border-radius: var(--nimiq-radius-pill);
  background: color-mix(in srgb, var(--nq-light-blue) 14%, transparent);
  color: var(--nq-light-blue); font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center;
}
.desktop-identity__share {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}

@media (max-width: 900px) {
  .desktop-identity__layout { grid-template-columns: 1fr; }
  .desktop-identity__preview { position: static; }
}
</style>
