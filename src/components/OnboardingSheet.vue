<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import ActionSheet from './ActionSheet.vue'
import Identicon from './Identicon.vue'
import { useProfilesStore } from '../stores/profiles'
import { markOnboardingDone } from '../services/onboarding'
import type { ProfileType } from '../types/profile'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; complete: [] }>()

const store = useProfilesStore()
const name = ref('')
const type = ref<ProfileType>('person')
const bio = ref('')
const website = ref('')
const github = ref('')
const x = ref('')
const showLinks = ref(false)
const saving = ref(false)
const error = ref('')

const address = computed(() => store.self?.address ?? '')

watch(() => props.open, (open) => {
  if (!open) return
  const self = store.self
  name.value = self?.name === 'Me' ? '' : (self?.name ?? '')
  type.value = self?.type ?? 'person'
  bio.value = self?.bio ?? ''
  website.value = self?.website ?? ''
  github.value = self?.github ?? ''
  x.value = self?.x ?? ''
  showLinks.value = !!(website.value || github.value || x.value)
  error.value = ''
})

function skip() {
  markOnboardingDone()
  emit('close')
}

async function save() {
  const self = store.self
  if (!self) return
  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = 'Please enter your name.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await store.update(self.id, {
      name: trimmed,
      type: type.value,
      bio: bio.value.trim() || undefined,
      website: website.value.trim() || undefined,
      github: github.value.trim() || undefined,
      x: x.value.trim().replace(/^@/, '') || undefined,
    })
    markOnboardingDone()
    emit('complete')
  } catch {
    error.value = 'Could not save your profile — try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ActionSheet :open="open" title="Set up your profile" @close="skip">
    <p class="hint">Add a name so friends know who sent a request or split bill.</p>

    <form class="form" @submit.prevent="save">
      <div class="avatar-preview">
        <Identicon :address="address" :size="72" />
      </div>

      <label class="field">
        <span>Name</span>
        <input v-model="name" required placeholder="Your name" autofocus />
      </label>

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
        <span>Bio <span class="optional">(optional)</span></span>
        <textarea v-model="bio" rows="2" placeholder="A line about you…" />
      </label>

      <button type="button" class="toggle-links" @click="showLinks = !showLinks">
        {{ showLinks ? 'Hide links' : 'Add links (optional)' }}
      </button>

      <template v-if="showLinks">
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
      </template>

      <p v-if="error" class="error">{{ error }}</p>

      <button type="submit" class="primary" :disabled="saving || !name.trim()">
        {{ saving ? 'Saving…' : 'Continue' }}
      </button>
      <button type="button" class="skip" :disabled="saving" @click="skip">Skip for now</button>
    </form>
  </ActionSheet>
</template>

<style scoped>
.hint { color: var(--text-2); font-size: 14px; margin: 0 0 16px; line-height: 1.4; }
.form { display: flex; flex-direction: column; gap: 14px; }
.avatar-preview { display: flex; justify-content: center; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 13px; font-weight: 700; color: var(--text-2); }
.optional { font-weight: 400; }
.field input, .field select, .field textarea {
  font: inherit; padding: 10px 12px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); color: var(--text);
}
.field-pair { display: flex; gap: 12px; }
.field-pair .field { flex: 1; min-width: 0; }
.toggle-links {
  background: none; border: none; padding: 0; min-height: 44px;
  font: inherit; font-weight: 600; color: var(--nq-light-blue); cursor: pointer; text-align: left;
}
.error { color: var(--nq-red); font-size: 14px; margin: 0; }
.primary {
  height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; cursor: default; }
.skip {
  background: none; border: none; min-height: 44px;
  font: inherit; font-weight: 600; color: var(--text-2); cursor: pointer;
}
.skip:disabled { opacity: 0.5; cursor: default; }
</style>
