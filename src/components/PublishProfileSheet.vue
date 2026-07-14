<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ActionSheet from './ActionSheet.vue'
import { insideNimiqPay } from '../services/nimiq'
import type { Profile } from '../types/profile'
import {
  publishProfile,
  unpublishProfile,
  type PublicProfile,
  type ShareSelection,
} from '../services/handles'

const props = defineProps<{ open: boolean; profile: Profile; published: PublicProfile | null }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const share = ref<ShareSelection>({
  name: true, bio: false, website: false, github: false, x: false, tags: false,
})
const busy = ref(false)
const error = ref<string | null>(null)
const done = ref<'published' | 'unpublished' | null>(null)

// Pre-check the fields that are already published when (re)opening.
watch(() => props.open, open => {
  if (!open) return
  done.value = null
  error.value = null
  const p = props.published
  share.value = {
    name: true,
    bio: !!p?.bio,
    website: !!p?.website,
    github: !!p?.github,
    x: !!p?.x,
    tags: !!p?.tags?.length,
  }
})

interface FieldRow {
  key: keyof ShareSelection
  label: string
  value: string
}

const fields = computed<FieldRow[]>(() => {
  const rows: FieldRow[] = [{ key: 'name', label: 'Name', value: props.profile.name }]
  if (props.profile.bio) rows.push({ key: 'bio', label: 'Bio', value: props.profile.bio })
  if (props.profile.website) rows.push({ key: 'website', label: 'Website', value: props.profile.website })
  if (props.profile.github) rows.push({ key: 'github', label: 'GitHub', value: props.profile.github })
  if (props.profile.x) rows.push({ key: 'x', label: 'X / Twitter', value: props.profile.x })
  if (props.profile.tags.length) rows.push({ key: 'tags', label: 'Tags', value: props.profile.tags.join(', ') })
  return rows
})

async function doPublish() {
  busy.value = true
  error.value = null
  try {
    await publishProfile(props.profile, share.value)
    done.value = 'published'
    emit('changed')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function doUnpublish() {
  busy.value = true
  error.value = null
  try {
    await unpublishProfile(props.profile.address)
    done.value = 'unpublished'
    emit('changed')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ActionSheet :open="open" title="Public profile" @close="emit('close')">
    <template v-if="insideNimiqPay">
      <template v-if="done">
        <p class="ok">
          {{ done === 'published' ? '✓ Public profile updated.' : '✓ Public profile removed.' }}
        </p>
        <button class="primary" @click="emit('close')">Done</button>
      </template>
      <template v-else>
        <p class="intro">
          Choose what appears on your public page. Only checked fields leave this
          device — everything else stays private. You can unpublish anytime.
        </p>
        <label v-for="field in fields" :key="field.key" class="field">
          <input v-model="share[field.key]" type="checkbox" :disabled="field.key === 'name'" />
          <span class="field-text">
            <strong>{{ field.label }}</strong>
            <small>{{ field.value }}</small>
          </span>
        </label>
        <p v-if="error" class="err">{{ error }}</p>
        <button class="primary" :disabled="busy" @click="doPublish">
          {{ busy ? 'Waiting for signature…' : published ? 'Update public profile' : 'Publish' }}
        </button>
        <button v-if="published" class="danger-link" :disabled="busy" @click="doUnpublish">
          Unpublish — remove my public profile
        </button>
      </template>
    </template>
    <p v-else class="hint">Open NimConnect inside Nimiq Pay to manage your public profile.</p>
  </ActionSheet>
</template>

<style scoped>
.intro { margin: 0 0 12px; font-size: 14px; color: var(--text-2); line-height: 1.5; }
.field {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 0;
  border-bottom: 1px solid var(--border); cursor: pointer;
}
.field input { width: 20px; height: 20px; margin-top: 2px; accent-color: var(--nq-gold); }
.field-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.field-text strong { font-size: 14px; color: var(--text); }
.field-text small {
  font-size: 13px; color: var(--text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ok { color: var(--nq-green); font-weight: 700; }
.err { color: var(--nq-red); font-size: 14px; }
.hint { color: var(--text-2); font-size: 14px; text-align: center; }
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); margin-top: 16px;
  background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; }
.danger-link {
  width: 100%; padding: 12px; margin-top: 4px; border: none; background: none; cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--nq-red);
  text-decoration: underline; text-underline-offset: 3px;
}
</style>
