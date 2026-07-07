<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { parseRequestLink, Currency } from '@nimiq/utils/request-link-encoding'
import { useProfilesStore } from '../stores/profiles'
import Identicon from '../components/Identicon.vue'
import QrScanner from '../components/QrScanner.vue'
import TagChips from '../components/TagChips.vue'
import type { ProfileType } from '../types/profile'

const route = useRoute()
const router = useRouter()
const store = useProfilesStore()

const editId = route.params.id as string | undefined
const name = ref('')
const address = ref('')
const notes = ref('')
const tags = ref<string[]>([])
const favorite = ref(false)
const type = ref<ProfileType>('person')
const scanning = ref(false)
const error = ref('')

onMounted(async () => {
  await store.load()
  if (editId) {
    const p = store.getById(editId)
    if (!p) return router.replace('/')
    name.value = p.name
    address.value = p.address
    notes.value = p.notes
    tags.value = [...p.tags]
    favorite.value = p.favorite
    type.value = p.type
  }
})

const addressValid = computed(() => ValidationUtils.isValidAddress(address.value))

function onScan(text: string) {
  scanning.value = false
  if (ValidationUtils.isValidAddress(text)) {
    address.value = text
    return
  }
  try {
    const parsed = parseRequestLink(text, { currencies: [Currency.NIM] })
    if (parsed?.recipient) address.value = parsed.recipient
  } catch {
    error.value = 'QR code does not contain a Nimiq address'
  }
}

async function save() {
  error.value = ''
  try {
    if (editId) {
      await store.update(editId, {
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: tags.value, favorite: favorite.value, type: type.value,
      })
      router.back()
    } else {
      const p = await store.add({
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: tags.value, favorite: favorite.value, type: type.value,
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
          <input v-model="address" required placeholder="NQ…" spellcheck="false" autocapitalize="characters" />
          <button type="button" class="scan-btn" aria-label="Scan QR" @click="scanning = !scanning">▣</button>
        </div>
      </label>

      <QrScanner v-if="scanning" @scan="onScan" @error="scanning = false; error = 'Camera unavailable — paste the address instead.'" />

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
.form-header h1 { font-size: 22px; margin: 0; }
.back { background: none; border: none; color: var(--nq-light-blue); font-size: 16px; padding: 8px; cursor: pointer; }
.form { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.avatar-preview { display: flex; justify-content: center; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 13px; font-weight: 700; color: var(--text-2); }
.field input, .field select, .field textarea {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg); color: var(--text);
}
.address-row { display: flex; gap: 8px; }
.address-row input { flex: 1; }
.scan-btn {
  width: 44px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg); color: var(--text); font-size: 20px; cursor: pointer;
}
.favorite-row { display: flex; align-items: center; gap: 8px; min-height: 44px; font-weight: 600; }
.error { color: var(--nq-red); font-size: 14px; margin: 0; }
.primary {
  height: 48px; border: none; border-radius: 24px; cursor: pointer;
  font-weight: 700; font-size: 16px; color: #fff;
  background: linear-gradient(135deg, var(--nq-gold-dark), var(--nq-gold));
}
.primary:disabled { opacity: 0.5; cursor: default; }
</style>
