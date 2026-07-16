<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { parsePaymentRequest, shortAddress, makePublicHandleLink } from '../services/links'
import { celebrateOnce } from '../services/delight'
import { decodeSharedProfile, parseProfileShare, type SharedProfile } from '../services/profile-share'
import { useProfilesStore } from '../stores/profiles'
import {
  handlesEnabled,
  findMyHandle,
  fetchPublicProfile,
  syncPublicProfile,
  defaultShareSelection,
  shareFromPublished,
  shareSelectionForProfile,
  parsePublicLookupQuery,
  type ShareSelection,
} from '../services/handles'
import {
  lookupContactPublicIdentity,
  planEmptyPublicImports,
  type ContactPublicSuggestion,
  type PublicImportField,
} from '../services/contact-public-lookup'
import { myAddresses, insideNimiqPay } from '../services/nimiq'
import Identicon from '../components/Identicon.vue'
import QrScanner from '../components/QrScanner.vue'
import TagChips from '../components/TagChips.vue'
import type { ProfileType } from '../types/profile'

const LOOKUP_DEBOUNCE_MS = 350
const BANNER_COLLAPSE_MS = 2500
const SHOW_MORE_KEY = 'nimconnect:profile-form-show-more'

function readShowMorePref(): boolean | null {
  try {
    const v = globalThis.localStorage?.getItem(SHOW_MORE_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* best-effort */ }
  return null
}

function writeShowMorePref(open: boolean) {
  try {
    globalThis.localStorage?.setItem(SHOW_MORE_KEY, open ? '1' : '0')
  } catch { /* best-effort */ }
}

function formatRelativeAgo(ms: number): string {
  const diff = Date.now() - ms
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(ms).toLocaleDateString()
}

function publicVisibleLabel(handle: string): string {
  const link = makePublicHandleLink(handle)
  try {
    const u = new URL(link)
    if (u.hash.includes('/u/')) return `${u.host}/@${handle}`
    return `${u.host}${u.pathname}`.replace(/\/$/, '')
  } catch {
    return `@${handle}`
  }
}

const route = useRoute()
const router = useRouter()
const store = useProfilesStore()

const editId = route.params.id as string | undefined
const isSelf = ref(false)
const hasHandle = ref(false)
const name = ref('')
const address = ref('')
const notes = ref('')
const bio = ref('')
const website = ref('')
const github = ref('')
const x = ref('')
/** Local relationship tags — never mixed visually with imported public tags. */
const tags = ref<string[]>([])
/** Tags imported from a public profile (shown under Public identity). */
const publicTags = ref<string[]>([])
const favorite = ref(false)
const type = ref<ProfileType>('person')
const publicShare = ref<ShareSelection>(defaultShareSelection())
const scanning = ref(false)
const showMore = ref(false)
const error = ref('')
const publishNote = ref<string | null>(null)
const claimedHandle = ref<string | null>(null)
const lookingUp = ref(false)
const lookupIdle = ref(false)
const suggestion = ref<ContactPublicSuggestion | null>(null)
const handlePending = ref(false)
const handleLookupFailed = ref(false)
/** Original values written by public import — used to detect local edits. */
const importedOrigins = ref<Partial<Record<PublicImportField, string>>>({})
const importLabels = ref<string[]>([])
const publicImportDone = ref(false)
const importBannerExpanded = ref(false)
const websiteEditing = ref(false)
const githubEditing = ref(false)
const xEditing = ref(false)
const savedFlash = ref(false)
const baseline = ref('')
const addingPublicTag = ref(false)
const profileUpdatedAt = ref(0)
let lookupTimer: ReturnType<typeof setTimeout> | undefined
let bannerTimer: ReturnType<typeof setTimeout> | undefined
let saveFlashTimer: ReturnType<typeof setTimeout> | undefined
let lookupSeq = 0

function serializeField(field: PublicImportField): string {
  if (field === 'tags') return JSON.stringify(publicTags.value)
  if (field === 'name') return name.value
  if (field === 'bio') return bio.value
  if (field === 'website') return website.value
  if (field === 'github') return github.value
  return x.value
}

function websiteHost(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
    return `${url.host}${path}`
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  }
}

function websiteHref(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return trimmed.includes('://') ? trimmed : `https://${trimmed}`
}

function mergedTags(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...publicTags.value, ...tags.value]) {
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function removePublicTag(tag: string) {
  publicTags.value = publicTags.value.filter(t => t !== tag)
}

const typeOptions: { value: ProfileType; label: string; muted?: boolean }[] = [
  { value: 'person', label: 'Person' },
  { value: 'business', label: 'Business' },
  { value: 'merchant', label: 'Merchant' },
  // Stored as `other` for backwards compatibility; shown as Service.
  { value: 'other', label: 'Service', muted: true },
]

const showPublicToggles = computed(() => isSelf.value && handlesEnabled() && hasHandle.value)
const canPublish = computed(() => insideNimiqPay.value)
const addressTrimmed = computed(() => address.value.trim())
const identityQuery = computed(() => parsePublicLookupQuery(address.value))
const addressValid = computed(() => ValidationUtils.isValidAddress(address.value))
const addressStatus = computed<'empty' | 'invalid' | 'valid' | 'handle'>(() => {
  if (!addressTrimmed.value) return 'empty'
  if (addressValid.value) return 'valid'
  if (identityQuery.value.kind === 'handle') return 'handle'
  return 'invalid'
})
const addressFeedback = computed(() => {
  if (isSelf.value || addressStatus.value === 'empty') return null
  if (addressStatus.value === 'invalid') {
    return { kind: 'bad' as const, text: '⚠ Enter a Nimiq address or @handle' }
  }
  if (addressStatus.value === 'handle') {
    if (lookingUp.value) return { kind: 'muted' as const, text: 'Looking for a public profile…' }
    if (handleLookupFailed.value) {
      return { kind: 'muted' as const, text: 'Couldn’t resolve this @handle — try again or paste an address' }
    }
    return { kind: 'muted' as const, text: 'Resolving @handle…' }
  }
  if (claimedHandle.value) return { kind: 'ok' as const, text: `Resolved @${claimedHandle.value}` }
  return { kind: 'ok' as const, text: '✓ Valid Nimiq address' }
})
const normalizedAddress = computed(() =>
  addressValid.value ? ValidationUtils.normalizeAddress(address.value) : '',
)
const previewName = computed(() => {
  const typed = name.value.trim()
  if (typed) return typed
  if (suggestion.value?.displayName) return suggestion.value.displayName
  return editId ? 'Edit contact' : 'New Contact'
})
const previewAddress = computed(() => {
  if (addressValid.value) return shortAddress(normalizedAddress.value)
  if (addressStatus.value === 'handle') {
    return 'Resolving address…'
  }
  if (name.value.trim() || addressTrimmed.value) return 'Enter a Nimiq address or @handle'
  return editId ? 'Update someone in your relationships' : 'Save someone you want to pay again.'
})
const previewAddressIsMono = computed(() => addressValid.value)
const showImportBanner = computed(() =>
  !isSelf.value && publicImportDone.value && importLabels.value.length > 0,
)
const showNoProfileHint = computed(() =>
  !isSelf.value
  && !lookingUp.value
  && lookupIdle.value
  && addressValid.value
  && !suggestion.value
  && !claimedHandle.value,
)
const hasOptionalContent = computed(() =>
  !!(notes.value.trim() || bio.value.trim() || website.value.trim()
    || github.value.trim() || x.value.trim()
    || publicTags.value.length || tags.value.length || favorite.value),
)
function formSnapshot(): string {
  return JSON.stringify({
    name: name.value,
    notes: notes.value,
    bio: bio.value,
    website: website.value,
    github: github.value,
    x: x.value,
    tags: tags.value,
    publicTags: publicTags.value,
    favorite: favorite.value,
    type: type.value,
    publicShare: publicShare.value,
  })
}

const isDirty = computed(() => !!baseline.value && formSnapshot() !== baseline.value)
const saveLabel = computed(() => {
  if (savedFlash.value) return 'Changes saved ✓'
  if (!editId) return 'Save contact'
  if (!isDirty.value) return 'Saved ✓'
  return 'Save changes'
})
const canSave = computed(() =>
  !!name.value.trim()
  && addressValid.value
  && !handlePending.value
  && (!editId || isDirty.value),
)

function visibilityOn(shareKey: keyof ShareSelection, hasValue: boolean): boolean {
  return hasValue && !!publicShare.value[shareKey]
}

function toggleVisibility(shareKey: keyof ShareSelection, hasValue: boolean) {
  if (!hasValue) return
  publicShare.value = { ...publicShare.value, [shareKey]: !publicShare.value[shareKey] }
}

const importedFromLabel = computed(() =>
  claimedHandle.value ? `@${claimedHandle.value}` : 'public profile',
)
const hasPublicImportOrigins = computed(() => Object.keys(importedOrigins.value).length > 0)
const websiteDisplay = computed(() => websiteHost(website.value))

function fieldProvenance(field: PublicImportField): 'public' | 'modified' | null {
  const origin = importedOrigins.value[field]
  if (origin == null) return null
  return serializeField(field) === origin ? 'public' : 'modified'
}

const nameHint = computed(() => {
  const status = fieldProvenance('name')
  if (status === 'public') return 'Public profile'
  if (status === 'modified') {
    return claimedHandle.value
      ? `Originally imported from @${claimedHandle.value}`
      : 'Locally edited'
  }
  return null
})

const websiteDisplayHref = computed(() => websiteHref(website.value))
const githubHref = computed(() => {
  const user = github.value.trim()
  return user ? `https://github.com/${encodeURIComponent(user)}` : ''
})
const xHref = computed(() => {
  const user = x.value.trim().replace(/^@/, '')
  return user ? `https://x.com/${encodeURIComponent(user)}` : ''
})
const privateTagSuggestions = computed(() =>
  store.allTags.filter(t => !publicTags.value.includes(t) && !tags.value.includes(t)),
)
const publicTagSuggestions = computed(() =>
  store.allTags.filter(t => !publicTags.value.includes(t) && !tags.value.includes(t)),
)

const livePreview = computed(() => {
  const share = publicShare.value
  return {
    handle: claimedHandle.value,
    name: share.name ? name.value.trim() : '',
    bio: share.bio ? bio.value.trim() : '',
    website: share.website ? websiteDisplay.value : '',
    websiteHref: share.website ? websiteDisplayHref.value : '',
    github: share.github ? github.value.trim() : '',
    githubHref: share.github ? githubHref.value : '',
    x: share.x ? x.value.trim().replace(/^@/, '') : '',
    xHref: share.x ? xHref.value : '',
    tags: share.tags ? mergedTags() : [],
  }
})

const livePreviewMeta = computed(() => {
  const handle = claimedHandle.value
  return {
    visibleAt: handle ? publicVisibleLabel(handle) : '',
    lastUpdated: profileUpdatedAt.value ? formatRelativeAgo(profileUpdatedAt.value) : '',
  }
})

const livePreviewEmpty = computed(() =>
  !livePreview.value.name
  && !livePreview.value.bio
  && !livePreview.value.website
  && !livePreview.value.github
  && !livePreview.value.x
  && !livePreview.value.tags.length,
)

const publicIdentitySub = computed(() => {
  if (!hasPublicImportOrigins.value) {
    return isSelf.value
      ? null
      : 'Their public information — edit freely; changes stay on this contact.'
  }
  const fields = Object.keys(importedOrigins.value) as PublicImportField[]
  const stillPublic = fields.some(f => fieldProvenance(f) === 'public')
  return stillPublic
    ? `Imported from ${importedFromLabel.value}`
    : `Originally from ${importedFromLabel.value}`
})

function scheduleBannerCollapse() {
  clearTimeout(bannerTimer)
  importBannerExpanded.value = true
  bannerTimer = setTimeout(() => {
    importBannerExpanded.value = false
  }, BANNER_COLLAPSE_MS)
}

function viewImportedFields() {
  showMore.value = true
  importBannerExpanded.value = true
  scheduleBannerCollapse()
}

function resetLookupUi() {
  lookingUp.value = false
  lookupIdle.value = false
  suggestion.value = null
  handlePending.value = false
  handleLookupFailed.value = false
  claimedHandle.value = null
  importedOrigins.value = {}
  importLabels.value = []
  publicImportDone.value = false
  importBannerExpanded.value = false
  publicTags.value = []
  clearTimeout(bannerTimer)
}

function rememberImportOrigins(fields: PublicImportField[]) {
  const next: Partial<Record<PublicImportField, string>> = {}
  for (const field of fields) next[field] = serializeField(field)
  importedOrigins.value = next
}

function autoImportPublicProfile(s: ContactPublicSuggestion) {
  const plan = planEmptyPublicImports(s, {
    name: name.value,
    bio: bio.value,
    website: website.value,
    github: github.value,
    x: x.value,
    tags: publicTags.value.length ? publicTags.value : tags.value,
  })
  if (plan.patch.name != null) name.value = plan.patch.name
  if (plan.patch.bio != null) bio.value = plan.patch.bio
  if (plan.patch.website != null) website.value = plan.patch.website
  if (plan.patch.github != null) github.value = plan.patch.github
  if (plan.patch.x != null) x.value = plan.patch.x
  if (plan.patch.tags) {
    publicTags.value = plan.patch.tags
    tags.value = tags.value.filter(t => !plan.patch.tags!.includes(t))
  }

  rememberImportOrigins(plan.fields)
  importLabels.value = plan.labels
  publicImportDone.value = true
  claimedHandle.value = s.handle
  scheduleBannerCollapse()

  if (plan.fields.some(f => f === 'bio' || f === 'website' || f === 'github' || f === 'x' || f === 'tags')) {
    showMore.value = true
  }
}

function applySharedProfile(shared: SharedProfile) {
  address.value = shared.address
  name.value = shared.name
  type.value = shared.type
  bio.value = shared.bio ?? ''
  website.value = shared.website ?? ''
  github.value = shared.github ?? ''
  x.value = shared.x ?? ''
  publicTags.value = [...shared.tags]
  tags.value = []

  const fields: PublicImportField[] = []
  const labels = ['Avatar']
  if (shared.name) { fields.push('name'); labels.push('Name') }
  if (shared.bio) { fields.push('bio'); labels.push('Bio') }
  if (shared.website) { fields.push('website'); labels.push('Website') }
  if (shared.github) { fields.push('github'); labels.push('GitHub') }
  if (shared.x) { fields.push('x'); labels.push('X') }
  if (shared.tags.length) { fields.push('tags'); labels.push('Tags') }
  rememberImportOrigins(fields)
  importLabels.value = labels
  publicImportDone.value = true
  scheduleBannerCollapse()
  if (hasOptionalContent.value) showMore.value = true
}

function applyAddressFromQuery() {
  const raw = route.query.address
  if (!raw) return
  const parsed = parsePaymentRequest(String(raw))
  if (parsed?.recipient) address.value = parsed.recipient
}

function applyShareFromQuery() {
  const raw = route.query.p
  if (raw) {
    const shared = decodeSharedProfile(String(raw))
    if (shared) {
      applySharedProfile(shared)
      return
    }
  }
  applyAddressFromQuery()
}

function applyIncomingText(text: string): boolean {
  const shared = parseProfileShare(text)
  if (shared) {
    applySharedProfile(shared)
    return true
  }
  const trimmed = text.trim()
  if (parsePublicLookupQuery(trimmed).kind === 'handle') {
    address.value = trimmed.startsWith('@') ? trimmed : `@${trimmed}`
    return true
  }
  const parsed = parsePaymentRequest(text)
  if (parsed?.recipient) {
    address.value = parsed.recipient
    return true
  }
  return false
}

async function loadPublicSharePrefs(profileId: string) {
  if (!handlesEnabled()) return
  const p = store.getById(profileId)
  if (!p?.isSelf) return
  const wallets = myAddresses(p.address)
  const claim = await findMyHandle(wallets)
  hasHandle.value = !!claim
  if (claim?.handle) claimedHandle.value = claim.handle
  if (!hasHandle.value) return
  if (p.publicShare) {
    publicShare.value = { ...p.publicShare }
    return
  }
  const remote = await fetchPublicProfile(p.address)
  publicShare.value = remote?.profile
    ? shareFromPublished(remote.profile)
    : shareSelectionForProfile(p)
}

async function runPublicLookup(raw: string) {
  const seq = ++lookupSeq
  const parsed = parsePublicLookupQuery(raw)
  if (parsed.kind === 'invalid') {
    resetLookupUi()
    return
  }

  lookingUp.value = true
  lookupIdle.value = false
  handleLookupFailed.value = false
  if (parsed.kind === 'handle') {
    handlePending.value = true
    suggestion.value = null
    publicImportDone.value = false
  }

  try {
    const result = await lookupContactPublicIdentity(raw)
    if (seq !== lookupSeq) return

    if (result.status === 'found') {
      suggestion.value = result.suggestion
      claimedHandle.value = result.suggestion.handle
      handlePending.value = false
      handleLookupFailed.value = false
      if (parsed.kind === 'handle' || !addressValid.value) {
        // Replace @handle input with the authoritative address after resolve.
        address.value = result.suggestion.address
      }
      autoImportPublicProfile(result.suggestion)
      return
    }

    suggestion.value = null
    claimedHandle.value = null
    importedOrigins.value = {}
    importLabels.value = []
    publicImportDone.value = false
    importBannerExpanded.value = false
    if (parsed.kind === 'handle') {
      handlePending.value = false
      handleLookupFailed.value = true
    } else {
      handlePending.value = false
      handleLookupFailed.value = false
    }
  } finally {
    if (seq === lookupSeq) {
      lookingUp.value = false
      lookupIdle.value = true
    }
  }
}

function schedulePublicLookup(raw: string) {
  clearTimeout(lookupTimer)
  const parsed = parsePublicLookupQuery(raw)
  if (parsed.kind === 'invalid') {
    resetLookupUi()
    return
  }
  if (parsed.kind === 'handle') {
    handlePending.value = true
    handleLookupFailed.value = false
    lookingUp.value = true
    lookupIdle.value = false
  } else {
    handlePending.value = false
    handleLookupFailed.value = false
    lookingUp.value = true
    lookupIdle.value = false
  }
  lookupTimer = setTimeout(() => {
    void runPublicLookup(raw)
  }, LOOKUP_DEBOUNCE_MS)
}

onMounted(async () => {
  await store.load()
  if (editId) {
    const p = store.getById(editId)
    if (!p) return router.replace('/')
    name.value = p.name
    address.value = p.address
    notes.value = p.notes
    bio.value = p.bio ?? ''
    website.value = p.website ?? ''
    github.value = p.github ?? ''
    x.value = p.x ?? ''
    favorite.value = p.favorite
    type.value = p.type
    claimedHandle.value = p.handle ?? null
    isSelf.value = p.isSelf
    profileUpdatedAt.value = p.updatedAt || p.createdAt
    if (p.isSelf) {
      publicTags.value = [...p.tags]
      tags.value = []
    } else {
      tags.value = [...p.tags]
    }
    const showMorePref = readShowMorePref()
    if (showMorePref != null) showMore.value = showMorePref
    else if (hasOptionalContent.value || p.isSelf) showMore.value = true
    if (p.isSelf) await loadPublicSharePrefs(editId)
    baseline.value = formSnapshot()
  } else {
    applyShareFromQuery()
    const showMorePref = readShowMorePref()
    if (showMorePref != null) showMore.value = showMorePref
    else if (hasOptionalContent.value) showMore.value = true
  }
})

onUnmounted(() => {
  clearTimeout(lookupTimer)
  clearTimeout(bannerTimer)
  clearTimeout(saveFlashTimer)
  lookupSeq += 1
})

watch(showMore, (open) => writeShowMorePref(open))

watch(() => [route.query.address, route.query.p], applyShareFromQuery)

watch(addressTrimmed, (raw) => {
  if (isSelf.value) return
  if (!raw) {
    resetLookupUi()
    return
  }
  // Avoid re-entry when a @handle resolve writes the authoritative address back.
  if (
    suggestion.value
    && ValidationUtils.isValidAddress(raw)
    && ValidationUtils.normalizeAddress(raw) === suggestion.value.address
    && claimedHandle.value === suggestion.value.handle
  ) {
    lookingUp.value = false
    lookupIdle.value = true
    handlePending.value = false
    return
  }
  schedulePublicLookup(raw)
})

function onScan(text: string) {
  scanning.value = false
  if (!applyIncomingText(text)) {
    error.value = 'QR code does not contain a Nimiq address, @handle, or profile'
  }
}

async function pasteAddress() {
  error.value = ''
  try {
    const text = await navigator.clipboard?.readText()
    if (!text?.trim()) {
      error.value = 'Clipboard is empty'
      return
    }
    if (!applyIncomingText(text)) {
      error.value = 'Clipboard does not contain a Nimiq address, @handle, or profile'
    }
  } catch {
    error.value = 'Could not read clipboard — paste into the address field instead.'
  }
}

async function save() {
  error.value = ''
  publishNote.value = null
  try {
    const identity = {
      bio: bio.value.trim() || undefined,
      website: website.value.trim() || undefined,
      github: github.value.trim() || undefined,
      x: x.value.trim().replace(/^@/, '') || undefined,
    }
    const sharePatch = showPublicToggles.value ? { publicShare: { ...publicShare.value } } : {}
    if (editId) {
      await store.update(editId, {
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: mergedTags(), favorite: favorite.value, type: type.value,
        handle: claimedHandle.value ?? undefined,
        ...identity,
        ...sharePatch,
      })
      if (showPublicToggles.value && canPublish.value) {
        const updated = store.getById(editId)!
        try {
          const result = await syncPublicProfile(updated, publicShare.value, myAddresses(updated.address))
          if (result === 'published') {
            publishNote.value = 'Public page updated'
            celebrateOnce('first-public-profile')
          }
          if (result === 'unpublished') publishNote.value = 'Public page cleared'
        } catch (e) {
          error.value = `Saved locally, but public page sync failed: ${(e as Error).message}`
          return
        }
      } else if (showPublicToggles.value && !canPublish.value) {
        publishNote.value = 'Saved — open in Nimiq Pay to update your public page'
      }
      profileUpdatedAt.value = Date.now()
      baseline.value = formSnapshot()
      savedFlash.value = true
      clearTimeout(saveFlashTimer)
      saveFlashTimer = setTimeout(() => {
        savedFlash.value = false
      }, 1600)
    } else {
      const p = await store.add({
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: mergedTags(), favorite: favorite.value, type: type.value,
        ...(claimedHandle.value ? { handle: claimedHandle.value } : {}),
        ...identity,
      })
      router.replace(`/profile/${p.id}`)
    }
  } catch (e) {
    error.value = (e as Error).message === 'duplicate-address'
      ? 'You already have a contact with this address.'
      : 'Please enter a valid Nimiq address (NQ…).'
  }
}
</script>

<template>
  <div class="page">
    <header class="form-header">
      <button type="button" class="back" @click="router.back()">‹ Back</button>
    </header>

    <section class="hero" aria-live="polite">
      <Identicon :address="addressValid ? normalizedAddress : ''" :size="88" />
      <h1>{{ previewName }}</h1>
      <p v-if="claimedHandle" class="hero-handle">@{{ claimedHandle }}</p>
      <p v-if="claimedHandle && suggestion?.verified" class="hero-verified">✓ Verified</p>
      <p class="hero-meta" :class="{ mono: previewAddressIsMono }">{{ previewAddress }}</p>
    </section>

    <section
      v-if="showPublicToggles"
      class="live-preview"
      aria-labelledby="live-preview-heading"
    >
      <div class="live-preview-head">
        <h2 id="live-preview-heading">Your public profile</h2>
        <router-link
          v-if="livePreview.handle"
          :to="`/u/${livePreview.handle}`"
          class="live-preview-open"
        >
          Open live →
        </router-link>
      </div>
      <div class="live-preview-card">
        <Identicon :address="addressValid ? normalizedAddress : ''" :size="56" />
        <Transition name="preview-fade">
          <p v-if="livePreview.name" key="name" class="live-name">{{ livePreview.name }}</p>
        </Transition>
        <p v-if="livePreview.handle" class="live-handle">@{{ livePreview.handle }}</p>
        <div v-if="livePreview.handle" class="live-status-row">
          <span class="live-status-chip chip-verified">✓ Verified</span>
          <span class="live-status-chip chip-live">🌍 Public profile</span>
        </div>
        <Transition name="preview-fade">
          <p v-if="livePreview.bio" key="bio" class="live-bio">{{ livePreview.bio }}</p>
        </Transition>
        <div class="live-links-slot">
          <Transition name="preview-fade">
            <span v-if="livePreview.website" key="website" class="live-link">🌐 {{ livePreview.website }}</span>
          </Transition>
          <Transition name="preview-fade">
            <span v-if="livePreview.github" key="github" class="live-link">GitHub/{{ livePreview.github }}</span>
          </Transition>
          <Transition name="preview-fade">
            <span v-if="livePreview.x" key="x" class="live-link">𝕏 @{{ livePreview.x }}</span>
          </Transition>
        </div>
        <Transition name="preview-fade">
          <div v-if="livePreview.tags.length" key="tags" class="live-tags">
            <span v-for="t in livePreview.tags" :key="t" class="live-tag">{{ t }}</span>
          </div>
        </Transition>
        <Transition name="preview-fade">
          <p v-if="livePreviewEmpty" key="empty" class="live-empty">
            Toggle fields on below to see what others will see.
          </p>
        </Transition>
      </div>
      <div v-if="livePreviewMeta.visibleAt || livePreviewMeta.lastUpdated" class="live-meta-block">
        <p v-if="livePreviewMeta.visibleAt" class="live-meta">
          Visible at <span class="live-meta-url">{{ livePreviewMeta.visibleAt }}</span>
        </p>
        <p v-if="livePreviewMeta.lastUpdated" class="live-meta subtle">
          Last updated {{ livePreviewMeta.lastUpdated }}
        </p>
      </div>
    </section>

    <form class="form" @submit.prevent="save">
      <div v-if="showPublicToggles" class="public-intro">
        <p class="public-intro-title">Public Identity</p>
        <p class="public-intro-copy">
          Choose what appears on your public profile. Private notes and relationship details never leave your device.
        </p>
      </div>

      <section class="essentials" aria-label="Identity">
        <div class="field">
          <div class="field-head">
            <span class="field-label">Name</span>
            <button
              v-if="showPublicToggles"
              type="button"
              class="visibility-toggle"
              :class="visibilityOn('name', !!name.trim()) ? 'is-public' : 'is-private'"
              :aria-pressed="visibilityOn('name', !!name.trim())"
              :disabled="!name.trim()"
              :title="visibilityOn('name', !!name.trim()) ? 'Tap to make private' : 'Tap to make public'"
              @click="toggleVisibility('name', !!name.trim())"
            >
              {{ visibilityOn('name', !!name.trim()) ? '🌍 Public' : '🔒 Private' }}
            </button>
          </div>
          <input v-model="name" required placeholder="Alice" autocomplete="name" />
          <p v-if="nameHint" class="field-hint" :class="fieldProvenance('name') ?? undefined">
            {{ nameHint }}
          </p>
        </div>

        <div class="field">
          <span class="field-label">Address</span>
          <input
            v-model="address"
            required
            class="address-input"
            placeholder="NQ… or @handle"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            :disabled="isSelf"
          />
          <div v-if="!isSelf" class="address-actions">
            <button type="button" class="addr-action" @click="scanning = !scanning">
              <span aria-hidden="true">📷</span> Scan QR
            </button>
            <button type="button" class="addr-action" @click="pasteAddress">
              <span aria-hidden="true">📋</span> Paste
            </button>
          </div>
          <p v-if="isSelf" class="locked-hint">Your address comes from your connected wallet.</p>
          <template v-else>
            <p
              v-if="lookingUp && addressStatus !== 'invalid'"
              class="addr-status muted"
            >Looking for a public profile…</p>
            <div
              v-else-if="showImportBanner"
              class="import-banner"
              :class="{ compact: !importBannerExpanded }"
              role="status"
            >
              <template v-if="importBannerExpanded">
                <p class="import-title">✓ Public profile imported</p>
                <p class="import-copy">
                  Public information was added automatically. Your private notes remain private.
                </p>
                <p class="import-fields">{{ importLabels.join(' · ') }}</p>
              </template>
              <template v-else>
                <p class="import-title">✓ Public profile imported</p>
                <button type="button" class="import-view" @click="viewImportedFields">
                  View imported fields
                </button>
              </template>
            </div>
            <p v-else-if="showNoProfileHint" class="addr-status muted">No public profile found</p>
            <p
              v-else-if="addressFeedback"
              class="addr-status"
              :class="addressFeedback.kind"
            >{{ addressFeedback.text }}</p>
          </template>
        </div>

        <QrScanner v-if="scanning" @scan="onScan" />

        <fieldset class="field type-field">
          <legend class="field-label">Type</legend>
          <div class="type-chips" role="radiogroup" aria-label="Contact type">
            <button
              v-for="opt in typeOptions"
              :key="opt.value"
              type="button"
              class="type-chip"
              role="radio"
              :aria-checked="type === opt.value"
              :class="{ active: type === opt.value, muted: opt.muted }"
              @click="type = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </fieldset>
      </section>

      <button
        type="button"
        class="more-toggle"
        :aria-expanded="showMore"
        @click="showMore = !showMore"
      >
        {{ showMore ? 'Hide extra details' : 'More details (optional)' }}
      </button>

      <div
        class="more-wrap"
        :class="{ open: showMore }"
        :aria-hidden="!showMore"
        :inert="!showMore || undefined"
      >
        <div class="more-inner">
          <section class="more" aria-label="Additional information">
            <header class="identity-block">
              <p class="section-split">Public identity</p>
              <p v-if="publicIdentitySub" class="section-sub">{{ publicIdentitySub }}</p>
            </header>

            <div class="field">
              <div class="field-head">
                <span class="field-label">Bio</span>
                <button
                  v-if="showPublicToggles"
                  type="button"
                  class="visibility-toggle"
                  :class="visibilityOn('bio', !!bio.trim()) ? 'is-public' : 'is-private'"
                  :aria-pressed="visibilityOn('bio', !!bio.trim())"
                  :disabled="!bio.trim()"
                  :title="visibilityOn('bio', !!bio.trim()) ? 'Tap to make private' : 'Tap to make public'"
                  @click="toggleVisibility('bio', !!bio.trim())"
                >
                  {{ visibilityOn('bio', !!bio.trim()) ? '🌍 Public' : '🔒 Private' }}
                </button>
              </div>
              <textarea v-model="bio" rows="2" :placeholder="isSelf ? 'A line about you…' : 'A line about them…'" />
              <p v-if="fieldProvenance('bio') === 'modified'" class="field-hint modified">Locally edited</p>
            </div>

            <div class="field">
              <div class="field-head">
                <span class="field-label">Website</span>
                <button
                  v-if="showPublicToggles"
                  type="button"
                  class="visibility-toggle"
                  :class="visibilityOn('website', !!website.trim()) ? 'is-public' : 'is-private'"
                  :aria-pressed="visibilityOn('website', !!website.trim())"
                  :disabled="!website.trim()"
                  :title="visibilityOn('website', !!website.trim()) ? 'Tap to make private' : 'Tap to make public'"
                  @click="toggleVisibility('website', !!website.trim())"
                >
                  {{ visibilityOn('website', !!website.trim()) ? '🌍 Public' : '🔒 Private' }}
                </button>
              </div>
              <template v-if="isSelf">
                <input
                  v-model="website"
                  type="url"
                  inputmode="url"
                  placeholder="https://…"
                />
              </template>
              <template v-else>
                <div v-if="!websiteEditing && websiteDisplay" class="link-row">
                  <a
                    class="ext-link"
                    :href="websiteDisplayHref"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ websiteDisplay }} <span aria-hidden="true">↗</span>
                  </a>
                  <button type="button" class="edit-link" @click="websiteEditing = true">Edit</button>
                </div>
                <input
                  v-else
                  v-model="website"
                  type="url"
                  inputmode="url"
                  placeholder="https://…"
                  @focus="websiteEditing = true"
                  @blur="websiteEditing = false"
                />
              </template>
              <p v-if="fieldProvenance('website') === 'modified'" class="field-hint modified">Locally edited</p>
            </div>

            <div class="field-pair">
              <div class="field">
                <div class="field-head">
                  <span class="field-label">GitHub</span>
                  <button
                    v-if="showPublicToggles"
                    type="button"
                    class="visibility-toggle"
                    :class="visibilityOn('github', !!github.trim()) ? 'is-public' : 'is-private'"
                    :aria-pressed="visibilityOn('github', !!github.trim())"
                    :disabled="!github.trim()"
                    :title="visibilityOn('github', !!github.trim()) ? 'Tap to make private' : 'Tap to make public'"
                    @click="toggleVisibility('github', !!github.trim())"
                  >
                    {{ visibilityOn('github', !!github.trim()) ? '🌍 Public' : '🔒 Private' }}
                  </button>
                </div>
                <template v-if="isSelf">
                  <input
                    v-model="github"
                    placeholder="username"
                    autocapitalize="none"
                  />
                </template>
                <template v-else>
                  <div v-if="!githubEditing && github.trim()" class="link-row">
                    <a
                      class="ext-link"
                      :href="githubHref"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      github.com/{{ github.trim() }} <span aria-hidden="true">↗</span>
                    </a>
                    <button type="button" class="edit-link" @click="githubEditing = true">Edit</button>
                  </div>
                  <input
                    v-else
                    v-model="github"
                    placeholder="username"
                    autocapitalize="none"
                    @focus="githubEditing = true"
                    @blur="githubEditing = false"
                  />
                </template>
                <p v-if="fieldProvenance('github') === 'modified'" class="field-hint modified">Locally edited</p>
              </div>
              <div class="field">
                <div class="field-head">
                  <span class="field-label">X</span>
                  <button
                    v-if="showPublicToggles"
                    type="button"
                    class="visibility-toggle"
                    :class="visibilityOn('x', !!x.trim()) ? 'is-public' : 'is-private'"
                    :aria-pressed="visibilityOn('x', !!x.trim())"
                    :disabled="!x.trim()"
                    :title="visibilityOn('x', !!x.trim()) ? 'Tap to make private' : 'Tap to make public'"
                    @click="toggleVisibility('x', !!x.trim())"
                  >
                    {{ visibilityOn('x', !!x.trim()) ? '🌍 Public' : '🔒 Private' }}
                  </button>
                </div>
                <template v-if="isSelf">
                  <input
                    v-model="x"
                    placeholder="handle"
                    autocapitalize="none"
                  />
                </template>
                <template v-else>
                  <div v-if="!xEditing && x.trim()" class="link-row">
                    <a
                      class="ext-link"
                      :href="xHref"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      x.com/{{ x.trim().replace(/^@/, '') }} <span aria-hidden="true">↗</span>
                    </a>
                    <button type="button" class="edit-link" @click="xEditing = true">Edit</button>
                  </div>
                  <input
                    v-else
                    v-model="x"
                    placeholder="handle"
                    autocapitalize="none"
                    @focus="xEditing = true"
                    @blur="xEditing = false"
                  />
                </template>
                <p v-if="fieldProvenance('x') === 'modified'" class="field-hint modified">Locally edited</p>
              </div>
            </div>

            <div v-if="publicTags.length || showPublicToggles || !isSelf" class="field">
              <div class="field-head">
                <span class="field-label">Public tags</span>
                <button
                  v-if="showPublicToggles"
                  type="button"
                  class="visibility-toggle"
                  :class="visibilityOn('tags', mergedTags().length > 0) ? 'is-public' : 'is-private'"
                  :aria-pressed="visibilityOn('tags', mergedTags().length > 0)"
                  :disabled="!mergedTags().length"
                  :title="visibilityOn('tags', mergedTags().length > 0) ? 'Tap to make private' : 'Tap to make public'"
                  @click="toggleVisibility('tags', mergedTags().length > 0)"
                >
                  {{ visibilityOn('tags', mergedTags().length > 0) ? '🌍 Public' : '🔒 Private' }}
                </button>
              </div>
              <template v-if="showPublicToggles">
                <div v-if="publicTags.length || addingPublicTag" class="public-tags-editor">
                  <TagChips v-model="publicTags" :suggestions="publicTagSuggestions" />
                </div>
                <div v-else class="tags-empty">
                  <p class="tags-empty-title">No public tags yet.</p>
                  <p class="tags-empty-copy">Tags help others understand who you are.</p>
                  <button type="button" class="add-tag-btn" @click="addingPublicTag = true">
                    Add tag
                  </button>
                </div>
              </template>
              <template v-else>
                <div v-if="publicTags.length" class="chips public-chips">
                  <button
                    v-for="t in publicTags"
                    :key="t"
                    type="button"
                    class="chip public-chip"
                    :title="`Remove ${t}`"
                    @click="removePublicTag(t)"
                  >
                    {{ t }} ✕
                  </button>
                </div>
                <p v-else class="locked-hint">No public tags on this profile.</p>
              </template>
              <p v-if="fieldProvenance('tags') === 'modified'" class="field-hint modified">Locally edited</p>
            </div>

            <header class="identity-block">
              <p class="section-split">Private relationship</p>
              <p class="section-sub private-sub">Only on this device — never imported from a public profile.</p>
            </header>

            <label class="field field-private">
              <span>Notes <span class="private-tag">Private</span></span>
              <textarea v-model="notes" rows="3" placeholder="Met at Amsterdam meetup…" />
            </label>

            <div class="field">
              <span class="field-label">Private tags</span>
              <TagChips v-model="tags" :suggestions="privateTagSuggestions" />
            </div>

            <button
              type="button"
              class="favorite-btn"
              :class="{ on: favorite }"
              :aria-pressed="favorite"
              @click="favorite = !favorite"
            >
              <span
                class="favorite-star"
                :class="{ 'star-pop': favorite }"
                aria-hidden="true"
              >{{ favorite ? '⭐' : '☆' }}</span>
              {{ favorite ? 'Marked as favorite' : 'Mark as favorite' }}
            </button>
          </section>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="publishNote" class="note">{{ publishNote }}</p>

      <div class="save-bar">
        <button
          type="submit"
          class="nq-button save-btn"
          :class="{
            ready: canSave && (!editId || isDirty),
            saved: savedFlash || (!!editId && !isDirty && !savedFlash && !!baseline),
          }"
          :disabled="!canSave || savedFlash"
        >
          {{ saveLabel }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.page {
  padding: 12px 16px 0;
  padding-bottom: calc(88px + env(safe-area-inset-bottom));
}
.form-header { display: flex; align-items: center; margin-bottom: 4px; }
.back {
  background: none; border: none; color: var(--nq-light-blue);
  font-size: 16px; font-weight: 600; padding: 8px 0; cursor: pointer;
}

.hero {
  display: flex; flex-direction: column; align-items: center;
  text-align: center; gap: 6px; padding: 12px 8px 20px;
}
.hero h1 {
  margin: 0; font-size: 28px; line-height: 1.15; letter-spacing: -0.02em;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hero-handle {
  margin: 0; font-size: 16px; font-weight: 800; color: var(--nq-light-blue);
  letter-spacing: 0.01em;
}
.hero-verified {
  margin: 0; font-size: 12px; font-weight: 700; color: var(--nq-green);
}
.hero-meta {
  margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-2);
  max-width: 100%; word-break: break-word;
}
.hero-meta.mono { font-family: var(--nimiq-font-family-mono); }

.form { display: flex; flex-direction: column; gap: 16px; }
.essentials, .more {
  display: flex; flex-direction: column; gap: 14px;
  padding: 16px; background: var(--card); border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.section-label {
  margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--text-2);
}
.public-intro {
  margin: 0; padding: 12px 14px; border-radius: 12px;
  background: var(--card); border: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 4px;
}
.public-intro-title {
  margin: 0; font-size: 14px; font-weight: 800; color: var(--text);
}
.public-intro-copy {
  margin: 0; font-size: 13px; line-height: 1.45; color: var(--text-2);
}
.live-preview {
  margin: 0 0 16px;
  padding: 14px 16px;
  background: var(--card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.live-preview-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 12px;
}
.live-preview-head h2 {
  margin: 0; font-size: 15px; font-weight: 800;
}
.live-preview-open {
  font-size: 13px; font-weight: 700; color: var(--nq-light-blue); text-decoration: none;
}
.live-preview-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  text-align: center; padding: 14px 10px;
  border-radius: 12px; background: var(--bg); border: 1px solid var(--border);
  min-height: 120px;
}
.live-name { margin: 0; font-size: 18px; font-weight: 800; }
.live-handle { margin: 0; font-size: 14px; font-weight: 800; color: var(--nq-gold-dark); }
.live-status-row {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 2px;
}
.live-status-chip {
  display: inline-flex; align-items: center; gap: 4px;
  min-height: 24px; padding: 0 10px; border-radius: var(--nimiq-radius-pill);
  font-size: 11px; font-weight: 800; line-height: 1;
}
.live-status-chip.chip-verified {
  color: var(--nq-green);
  background: color-mix(in srgb, var(--nq-green) 18%, transparent);
}
.live-status-chip.chip-live {
  color: var(--nq-light-blue);
  background: color-mix(in srgb, var(--nq-light-blue) 16%, transparent);
}
.live-bio { margin: 4px 0 0; font-size: 13px; line-height: 1.4; color: var(--text-2); max-width: 28em; }
.live-links-slot {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
  margin-top: 4px; min-height: 0;
}
.live-link {
  font-size: 12px; font-weight: 700; color: var(--nq-light-blue);
}
.live-tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 6px; }
.live-tag {
  min-height: 24px; padding: 0 10px; border-radius: var(--nimiq-radius-pill);
  background: color-mix(in srgb, var(--nq-light-blue) 14%, transparent);
  color: var(--nq-light-blue); font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center;
}
.live-empty { margin: 8px 0 0; font-size: 13px; color: var(--text-2); line-height: 1.4; }
.live-meta-block {
  display: flex; flex-direction: column; gap: 2px; margin-top: 10px;
}
.live-meta {
  margin: 0; font-size: 12px; font-weight: 600; color: var(--text-2); line-height: 1.4;
}
.live-meta.subtle { font-weight: 500; }
.live-meta-url { color: var(--nq-light-blue); font-weight: 700; word-break: break-all; }

.preview-fade-enter-active,
.preview-fade-leave-active {
  transition:
    opacity var(--movement-duration) var(--nimiq-ease),
    transform var(--movement-duration) var(--nimiq-ease);
}
.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
@media (prefers-reduced-motion: reduce) {
  .preview-fade-enter-active,
  .preview-fade-leave-active { transition: none; }
}

.field { display: flex; flex-direction: column; gap: 6px; }
.field-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px;
}
.field > span, .field-label, .type-field legend {
  font-size: 13px; font-weight: 700; color: var(--text-2); padding: 0;
}
.visibility-toggle {
  flex-shrink: 0;
  min-height: 28px; padding: 0 10px;
  border: none; border-radius: var(--nimiq-radius-pill);
  font: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  line-height: 1;
  transition:
    background var(--attr-duration) var(--nimiq-ease),
    color var(--attr-duration) var(--nimiq-ease),
    transform var(--attr-duration) var(--nimiq-ease);
}
.visibility-toggle.is-public {
  color: var(--nq-light-blue);
  background: color-mix(in srgb, var(--nq-light-blue) 16%, transparent);
}
.visibility-toggle.is-private {
  color: var(--text-2);
  background: color-mix(in srgb, var(--text) 6%, transparent);
}
.visibility-toggle:not(:disabled):active { transform: scale(0.96); }
.visibility-toggle:disabled { opacity: 0.45; cursor: default; }
.visibility-toggle:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 2px; }
.type-field { border: none; margin: 0; min-width: 0; }
.field input, .field textarea {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); color: var(--text);
}
.address-input { font-family: var(--nimiq-font-family-mono); font-size: 14px; }
.field input:disabled { opacity: 0.6; }
.locked-hint { font-size: 12px; font-weight: 400; color: var(--text-2); }
.tags-empty {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  padding: 12px; border-radius: 12px; border: 1px dashed var(--border); background: var(--bg);
}
.tags-empty-title { margin: 0; font-size: 14px; font-weight: 800; }
.tags-empty-copy { margin: 0 0 6px; font-size: 13px; line-height: 1.4; color: var(--text-2); }
.add-tag-btn {
  min-height: 36px; padding: 0 14px;
  border: none; border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-light-blue-bg); color: var(--nimiq-white);
  font: inherit; font-size: 13px; font-weight: 700; cursor: pointer;
}

.address-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.addr-action {
  min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); color: var(--text); font-weight: 700; font-size: 14px; cursor: pointer;
}
.addr-action:active { transform: scale(0.98); }
.addr-status { margin: 0; font-size: 13px; font-weight: 600; }
.addr-status.ok { color: var(--nq-green); }
.addr-status.bad { color: var(--nq-red); }
.addr-status.muted { color: var(--text-2); font-weight: 500; }

.import-banner {
  display: flex; flex-direction: column; gap: 4px;
  margin: 0; padding: 12px; border-radius: 12px;
  background: color-mix(in srgb, var(--nq-green) 10%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--nq-green) 28%, var(--border));
  transition: padding var(--attr-duration) var(--nimiq-ease);
}
.import-banner.compact {
  flex-direction: row; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 12px;
}
.import-title { margin: 0; font-size: 13px; font-weight: 800; color: var(--nq-green); }
.import-copy { margin: 0; font-size: 12px; line-height: 1.4; color: var(--text-2); }
.import-fields { margin: 0; font-size: 12px; font-weight: 700; color: var(--text); }
.import-view {
  border: none; background: transparent; color: var(--nq-light-blue);
  font-weight: 700; font-size: 13px; cursor: pointer; padding: 0; white-space: nowrap;
}

.field-hint {
  margin: 0; font-size: 12px; font-weight: 600; color: var(--nq-light-blue);
}
.field-hint.public { color: var(--nq-light-blue); }
.field-hint.modified { color: var(--text-2); font-weight: 500; }
.link-row {
  display: flex; align-items: center; gap: 10px; min-height: 44px;
  padding: 0 4px 0 12px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg);
}
.ext-link {
  flex: 1; min-width: 0; color: var(--nq-light-blue); font-weight: 700;
  text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ext-link:hover { text-decoration: underline; }
.edit-link {
  flex-shrink: 0; border: none; background: transparent;
  color: var(--text-2); font-weight: 700; font-size: 13px; cursor: pointer; padding: 8px;
}
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill);
  padding: 6px 12px; min-height: 32px; font-weight: 600; cursor: pointer;
}
.public-chip {
  background: color-mix(in srgb, var(--nq-light-blue) 14%, var(--bg));
  color: var(--nq-light-blue); border-color: color-mix(in srgb, var(--nq-light-blue) 35%, var(--border));
}

.identity-block { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.section-split {
  margin: 0; font-size: 11px; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--text-2);
}
.section-sub { margin: 0; font-size: 12px; line-height: 1.35; color: var(--nq-light-blue); font-weight: 600; }
.section-sub.private-sub { color: var(--text-2); font-weight: 500; }
.field-private textarea { border-style: dashed; }
.private-tag {
  display: inline-block; margin-left: 6px; padding: 1px 7px;
  border-radius: var(--nimiq-radius-pill); font-size: 11px; font-weight: 800;
  letter-spacing: 0.02em; text-transform: uppercase;
  color: var(--text-2); background: var(--bg); border: 1px solid var(--border);
  vertical-align: middle;
}

.type-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.type-chip {
  min-height: 40px; padding: 8px 14px; border-radius: var(--nimiq-radius-pill);
  border: 1px solid var(--border); background: var(--bg); color: var(--text-2);
  font-weight: 700; font-size: 14px; cursor: pointer;
  transition:
    background var(--attr-duration) var(--nimiq-ease),
    color var(--attr-duration) var(--nimiq-ease),
    opacity var(--attr-duration) var(--nimiq-ease);
}
.type-chip.muted:not(.active) {
  opacity: 0.55;
  font-weight: 600;
  color: var(--text-40, var(--text-2));
}
.type-chip.active {
  background: var(--nimiq-blue-bg); color: var(--nimiq-white); border-color: transparent; opacity: 1;
}

.more-toggle {
  align-self: stretch; min-height: 44px; border: none; background: transparent;
  color: var(--nq-light-blue); font-weight: 700; font-size: 15px; cursor: pointer;
  padding: 4px 0;
}
.more-wrap {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
  transition:
    grid-template-rows var(--movement-duration) var(--nimiq-ease),
    opacity var(--attr-duration) var(--nimiq-ease);
}
.more-wrap.open {
  grid-template-rows: 1fr;
  opacity: 1;
  pointer-events: auto;
}
.more-inner { overflow: hidden; min-height: 0; }
.field-pair { display: flex; gap: 12px; }
.field-pair .field { flex: 1; min-width: 0; }
.favorite-btn {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  min-height: 48px; width: 100%; padding: 0 16px;
  border: 1px dashed var(--border); border-radius: var(--nimiq-radius-pill);
  background: var(--bg); color: var(--text-2); font-weight: 700; font-size: 15px; cursor: pointer;
  transition:
    background var(--attr-duration) var(--nimiq-ease),
    border-color var(--attr-duration) var(--nimiq-ease),
    color var(--attr-duration) var(--nimiq-ease),
    transform var(--attr-duration) var(--nimiq-ease);
}
.favorite-btn:active { transform: scale(0.98); }
.favorite-btn.on {
  border-style: solid;
  border-color: transparent;
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-blue);
}
.favorite-star { font-size: 18px; line-height: 1; }
.error { color: var(--nq-red); font-size: 14px; margin: 0; }
.note { color: var(--nq-green); font-size: 13px; font-weight: 600; margin: 0; }

.save-bar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  width: min(100dvw, 560px);
  bottom: calc(var(--nav-h) + env(safe-area-inset-bottom));
  padding: 12px 16px;
  background: linear-gradient(to top, var(--bg) 72%, transparent);
  z-index: 40;
  pointer-events: none;
}
.save-bar > * { pointer-events: auto; }
.save-btn {
  width: 100%;
  transition:
    opacity var(--movement-duration) var(--nimiq-ease),
    filter var(--movement-duration) var(--nimiq-ease),
    transform var(--movement-duration) var(--nimiq-ease),
    box-shadow var(--movement-duration) var(--nimiq-ease),
    background var(--attr-duration) var(--nimiq-ease);
}
.save-btn:disabled {
  opacity: 0.38;
  filter: grayscale(0.45);
  box-shadow: none;
  transform: none;
}
.save-btn.ready:not(:disabled) {
  opacity: 1;
  filter: none;
  box-shadow: 0 6px 18px rgba(233, 178, 19, 0.35);
}
.save-btn.saved {
  opacity: 1;
  filter: none;
  background: var(--nimiq-green-bg);
  color: var(--nimiq-white);
  box-shadow: 0 6px 18px rgba(33, 188, 165, 0.35);
}
.save-btn.saved:disabled {
  opacity: 1;
  filter: none;
}

@media (prefers-reduced-motion: reduce) {
  .more-wrap,
  .save-btn,
  .type-chip,
  .favorite-btn {
    transition: none;
  }
}
</style>
