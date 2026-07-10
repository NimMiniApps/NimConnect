<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { parsePaymentRequest } from '../services/links'
import { decodeSharedProfile, parseProfileShare, type SharedProfile } from '../services/profile-share'
import { useProfilesStore } from '../stores/profiles'
import Identicon from '../components/Identicon.vue'
import QrScanner from '../components/QrScanner.vue'
import TagChips from '../components/TagChips.vue'
import type { ProfileType } from '../types/profile'

const route = useRoute()
const router = useRouter()
const store = useProfilesStore()

const editId = route.params.id as string | undefined
const isSelf = ref(false)
const name = ref('')
const address = ref('')
const notes = ref('')
const bio = ref('')
const website = ref('')
const github = ref('')
const x = ref('')
const tags = ref<string[]>([])
const favorite = ref(false)
const type = ref<ProfileType>('person')
const scanning = ref(false)
const error = ref('')

function applySharedProfile(shared: SharedProfile) {
  address.value = shared.address
  name.value = shared.name
  type.value = shared.type
  bio.value = shared.bio ?? ''
  website.value = shared.website ?? ''
  github.value = shared.github ?? ''
  x.value = shared.x ?? ''
  tags.value = [...shared.tags]
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
    tags.value = [...p.tags]
    favorite.value = p.favorite
    type.value = p.type
    isSelf.value = p.isSelf
  } else {
    applyShareFromQuery()
  }
})

watch(() => [route.query.address, route.query.p], applyShareFromQuery)

const addressValid = computed(() => ValidationUtils.isValidAddress(address.value))

function onScan(text: string) {
  scanning.value = false
  const shared = parseProfileShare(text)
  if (shared) {
    applySharedProfile(shared)
    return
  }
  const parsed = parsePaymentRequest(text)
  if (parsed?.recipient) {
    address.value = parsed.recipient
    return
  }
  error.value = 'QR code does not contain a Nimiq address or profile'
}

function onScanError(message: string) {
  scanning.value = false
  error.value = message
}

async function save() {
  error.value = ''
  try {
    const identity = {
      bio: bio.value.trim() || undefined,
      website: website.value.trim() || undefined,
      github: github.value.trim() || undefined,
      x: x.value.trim().replace(/^@/, '') || undefined,
    }
    if (editId) {
      await store.update(editId, {
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: tags.value, favorite: favorite.value, type: type.value,
        ...identity,
      })
      router.back()
    } else {
      const p = await store.add({
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: tags.value, favorite: favorite.value, type: type.value,
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
      <h1>{{ editId ? 'Edit Profile' : 'New Contact' }}</h1>
    </header>

    <form class="card form" @submit.prevent="save">
      <div class="avatar-preview">
        <Identicon :address="addressValid ? address : ''" :size="72" />
      </div>

      <label class="field">
        <span>Name</span>
        <input v-model="name" required placeholder="Alice" />
      </label>

      <label class="field">
        <span>Nimiq address</span>
        <div class="address-row">
          <input v-model="address" required placeholder="NQ…" spellcheck="false" autocapitalize="characters" :disabled="isSelf" />
          <button v-if="!isSelf" type="button" class="scan-btn" aria-label="Scan QR" @click="scanning = !scanning">▣</button>
        </div>
        <span v-if="isSelf" class="locked-hint">Your address comes from your connected wallet.</span>
      </label>

      <QrScanner v-if="scanning" @scan="onScan" @error="onScanError" />

      <label class="field">
        <span>Type</span>
        <select v-model="type">
          <option value="person">Person</option>
          <option value="business">Business</option>
          <option value="merchant">Merchant</option>
          <option value="other">Other</option>
        </select>
      </label>

      <label class="field">
        <span>Notes</span>
        <textarea v-model="notes" rows="3" placeholder="Met at Nimiq meetup…" />
      </label>

      <label class="field">
        <span>Bio</span>
        <textarea v-model="bio" rows="2" :placeholder="isSelf ? 'A line about you…' : 'A line about them…'" />
      </label>

      <label class="field">
        <span>Website</span>
        <input v-model="website" type="url" inputmode="url" placeholder="https://…" />
      </label>

      <div class="field-pair">
        <label class="field">
          <span>GitHub</span>
          <input v-model="github" placeholder="username" autocapitalize="none" />
        </label>
        <label class="field">
          <span>X</span>
          <input v-model="x" placeholder="handle" autocapitalize="none" />
        </label>
      </div>

      <div class="field">
        <span>Tags</span>
        <TagChips v-model="tags" :suggestions="store.allTags" />
      </div>

      <label class="favorite-row">
        <input v-model="favorite" type="checkbox" />
        <span>⭐ Favorite</span>
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button type="submit" class="primary" :disabled="!name.trim() || !addressValid">
        {{ editId ? 'Save changes' : 'Add contact' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.form-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.form-header h1 { font-size: 24px; line-height: 1.2; margin: 0; }
.back { background: none; border: none; color: var(--nq-light-blue); font-size: 16px; padding: 8px; cursor: pointer; }
.form { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.avatar-preview { display: flex; justify-content: center; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 13px; font-weight: 700; color: var(--text-2); }
.field input, .field select, .field textarea {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); color: var(--text);
}
.address-row { display: flex; gap: 8px; }
.locked-hint { font-size: 12px; font-weight: 400; color: var(--text-2); }
.field-pair { display: flex; gap: 12px; }
.field-pair .field { flex: 1; min-width: 0; }
.field input:disabled { opacity: 0.6; }
.address-row input { flex: 1; }
.scan-btn {
  width: 44px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); color: var(--text); font-size: 20px; cursor: pointer;
}
.favorite-row { display: flex; align-items: center; gap: 8px; min-height: 44px; font-weight: 600; }
.error { color: var(--nq-red); font-size: 14px; margin: 0; }
.primary {
  height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
