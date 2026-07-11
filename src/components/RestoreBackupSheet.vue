<script setup lang="ts">
import { computed, ref } from 'vue'
import ActionSheet from './ActionSheet.vue'
import PassphraseSheet from './PassphraseSheet.vue'
import { useProfilesStore } from '../stores/profiles'
import { parseEncryptedBackup } from '../services/backup'
import { markLocalBackup, markPassphraseSet } from '../services/backup-prefs'
import { cloudBackupAvailable, downloadCloudBackup } from '../services/cloud-backup'
import { getMyAddress } from '../services/nimiq'
import { enableCloudAfterRestore } from '../services/restore'
import type { EncryptedBackup } from '../types/profile'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ skipped: []; restored: [] }>()

const store = useProfilesStore()
const fileInput = ref<HTMLInputElement>()
const passphraseOpen = ref(false)
const pendingFile = ref<EncryptedBackup | null>(null)
const message = ref('')
const busy = ref(false)
const cloudAvailable = computed(() => cloudBackupAvailable())
const cloudBusy = ref(false)
const pendingFromCloud = ref(false)

function startFresh() {
  try { globalThis.localStorage?.setItem('nimconnect:skipped-restore', '1') } catch {}
  emit('skipped')
}

function pickFile() {
  fileInput.value?.click()
}

async function onFile(event: Event) {
  message.value = ''
  pendingFromCloud.value = false
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text())
    if (parsed.format === 'encrypted-backup') {
      pendingFile.value = parsed as EncryptedBackup
      passphraseOpen.value = true
    } else {
      const { added, skipped } = await store.importDocument(parsed)
      message.value = `Imported ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`
      markLocalBackup()
      emit('restored')
    }
  } catch {
    message.value = 'That file is not a valid NimConnect backup.'
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function onPassphrase(passphrase: string) {
  if (!pendingFile.value) return
  busy.value = true
  message.value = ''
  try {
    const doc = await parseEncryptedBackup(pendingFile.value, passphrase)
    const { added, skipped } = await store.importDocument(doc)
    if (pendingFromCloud.value) {
      const address = store.self?.address ?? await getMyAddress()
      if (address) enableCloudAfterRestore(passphrase, address)
    } else {
      markPassphraseSet()
    }
    markLocalBackup()
    message.value = `Restored ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`
    pendingFile.value = null
    pendingFromCloud.value = false
    emit('restored')
  } catch {
    message.value = 'Wrong passphrase or corrupted backup.'
  } finally {
    busy.value = false
  }
}

async function restoreFromCloud() {
  cloudBusy.value = true
  message.value = ''
  try {
    const address = await getMyAddress()
    if (!address) {
      message.value = 'Connect your wallet in Nimiq Pay to restore from cloud.'
      return
    }
    const file = await downloadCloudBackup(address)
    if (!file) {
      message.value = 'No cloud backup found for this wallet.'
      return
    }
    pendingFile.value = file
    pendingFromCloud.value = true
    passphraseOpen.value = true
  } catch {
    message.value = 'Could not reach cloud backup.'
  } finally {
    cloudBusy.value = false
  }
}
</script>

<template>
  <ActionSheet :open="open" title="Restore your contacts" @close="startFresh">
    <p class="hint">No contacts found on this device. Restore from an encrypted backup?</p>
    <button type="button" class="item primary" :disabled="busy || cloudBusy" @click="pickFile">
      Choose backup file
    </button>
    <button
      v-if="cloudAvailable"
      type="button"
      class="item"
      :disabled="busy || cloudBusy"
      @click="restoreFromCloud"
    >
      Restore from cloud
    </button>
    <button type="button" class="item" :disabled="busy || cloudBusy" @click.stop="startFresh">Start fresh</button>
    <p v-if="message" class="message">{{ message }}</p>
    <input ref="fileInput" type="file" accept="application/json,.nimconnect" hidden @change="onFile" />
  </ActionSheet>

  <PassphraseSheet
    :open="passphraseOpen"
    title="Enter backup passphrase"
    @close="passphraseOpen = false"
    @submit="onPassphrase"
  />
</template>

<style scoped>
.hint { color: var(--text-2); font-size: 14px; margin: 0 0 12px; line-height: 1.4; }
.item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 12px 0; min-height: 44px; font: inherit; font-weight: 600;
  color: var(--text); cursor: pointer; border-bottom: 1px solid var(--border);
}
.item:last-of-type { border-bottom: none; }
.item.primary { color: var(--nq-gold-dark); }
.item:disabled { opacity: 0.5; cursor: default; }
.message { color: var(--nq-green); font-size: 14px; margin-top: 8px; }
</style>
