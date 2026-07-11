<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ActionSheet from './ActionSheet.vue'
import PassphraseSheet from './PassphraseSheet.vue'
import { useProfilesStore } from '../stores/profiles'
import { createEncryptedBackup, parseEncryptedBackup } from '../services/backup'
import {
  backupPassphraseSet,
  cloudBackupEnabled,
  markLocalBackup,
  markPassphraseSet,
} from '../services/backup-prefs'
import {
  cloudBackupAvailable,
  cloudBackupExists,
  downloadCloudBackup,
  setBackupSession,
  clearBackupSession,
  uploadCloudBackup,
} from '../services/cloud-backup'
import { getMyAddress, insideNimiqPay } from '../services/nimiq'
import { markBackupOnboardingDone } from '../services/onboarding'
import { enableCloudAfterRestore } from '../services/restore'
import type { EncryptedBackup } from '../types/profile'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; complete: []; restored: [] }>()

const store = useProfilesStore()
const passphraseOpen = ref(false)
const passphraseMode = ref<'export' | 'cloud' | 'restore'>('export')
const pendingRestore = ref<EncryptedBackup | null>(null)
const remoteCloudBackup = ref<boolean | null>(null)
const probingCloud = ref(false)
const overwriteConfirm = ref(false)
const message = ref('')
const messageIsError = ref(false)
const busy = ref(false)

const cloudAvailable = computed(() => cloudBackupAvailable() && insideNimiqPay.value)

function setMessage(text: string, isError = false) {
  message.value = text
  messageIsError.value = isError
}

function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function probeCloudBackup() {
  if (!cloudAvailable.value) {
    remoteCloudBackup.value = false
    return
  }
  probingCloud.value = true
  try {
    const address = store.self?.address ?? await getMyAddress()
    if (!address) {
      remoteCloudBackup.value = false
      return
    }
    remoteCloudBackup.value = await cloudBackupExists(address)
  } catch {
    remoteCloudBackup.value = null
    setMessage('Could not check cloud backup — you can still save a local copy.', true)
  } finally {
    probingCloud.value = false
  }
}

watch(() => props.open, (open) => {
  if (!open) {
    remoteCloudBackup.value = null
    overwriteConfirm.value = false
    pendingRestore.value = null
    message.value = ''
    messageIsError.value = false
    return
  }
  void probeCloudBackup()
})

function skip() {
  markBackupOnboardingDone()
  emit('close')
}

function finish() {
  markBackupOnboardingDone()
  emit('complete')
}

function saveEncryptedBackup() {
  overwriteConfirm.value = false
  setMessage('')
  passphraseMode.value = 'export'
  passphraseOpen.value = true
}

function startReplaceCloudBackup() {
  setMessage('')
  overwriteConfirm.value = true
}

function confirmReplaceCloudBackup() {
  overwriteConfirm.value = false
  passphraseMode.value = 'cloud'
  passphraseOpen.value = true
}

function enableCloudBackup() {
  setMessage('')
  passphraseMode.value = 'cloud'
  passphraseOpen.value = true
}

async function restoreFromCloud() {
  overwriteConfirm.value = false
  setMessage('')
  busy.value = true
  try {
    const address = store.self?.address ?? await getMyAddress()
    if (!address) {
      setMessage('Connect your wallet in Nimiq Pay to restore from cloud.', true)
      return
    }
    const file = await downloadCloudBackup(address)
    if (!file) {
      setMessage('No cloud backup found for this wallet.', true)
      remoteCloudBackup.value = false
      return
    }
    pendingRestore.value = file
    passphraseMode.value = 'restore'
    passphraseOpen.value = true
  } catch {
    setMessage('Could not reach cloud backup.', true)
  } finally {
    busy.value = false
  }
}

function cloudErrorMessage(err: unknown): string {
  const text = (err as Error).message
  if (text === 'Not running inside Nimiq Pay') {
    return 'Open NimConnect inside Nimiq Pay to sign cloud backups.'
  }
  if (text.includes('Failed to fetch') || text.includes('NetworkError')) {
    return 'Could not reach the backup API.'
  }
  return text || 'Could not set up backup — try again.'
}

async function onPassphrase(passphrase: string) {
  busy.value = true
  setMessage('')
  try {
    if (passphraseMode.value === 'export') {
      const file = await createEncryptedBackup(passphrase, store.self?.address)
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(JSON.stringify(file, null, 2), `nimconnect-backup-${date}.nimconnect`)
      markPassphraseSet()
      markLocalBackup()
      finish()
      return
    }

    if (passphraseMode.value === 'restore') {
      if (!pendingRestore.value) return
      const doc = await parseEncryptedBackup(pendingRestore.value, passphrase)
      const { added, skipped } = await store.importDocument(doc)
      const address = store.self?.address ?? await getMyAddress()
      if (address) enableCloudAfterRestore(passphrase, address)
      markLocalBackup()
      pendingRestore.value = null
      setMessage(`Restored ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}.`)
      emit('restored')
      return
    }

    const address = store.self?.address ?? await getMyAddress()
    if (!address) {
      setMessage('Connect your wallet in Nimiq Pay to enable cloud backup.', true)
      return
    }
    setBackupSession(passphrase, address)
    cloudBackupEnabled.value = true
    markPassphraseSet()
    await uploadCloudBackup(passphrase, address)
    finish()
  } catch (e) {
    if (passphraseMode.value === 'cloud') {
      clearBackupSession()
      cloudBackupEnabled.value = false
    }
    if (passphraseMode.value === 'restore') {
      setMessage('Wrong passphrase or corrupted backup.', true)
      return
    }
    setMessage(cloudErrorMessage(e), true)
  } finally {
    busy.value = false
  }
}

const passphraseTitle = computed(() => {
  if (passphraseMode.value === 'restore') return 'Enter backup passphrase'
  if (passphraseMode.value === 'cloud') return 'Cloud backup passphrase'
  return 'Choose a backup passphrase'
})
</script>

<template>
  <ActionSheet :open="open" title="Back up your contacts" @close="skip">
    <p v-if="remoteCloudBackup" class="hint">
      A cloud backup already exists for this wallet. Restore it first, or replace it only if you are sure.
    </p>
    <p v-else class="hint">
      Contacts live on this device only. Save an encrypted backup so you can restore them on a new phone.
    </p>

    <template v-if="overwriteConfirm">
      <p class="warn">
        This replaces your existing cloud backup with your current contacts. The old backup cannot be recovered.
      </p>
      <button type="button" class="item danger" :disabled="busy" @click="confirmReplaceCloudBackup">
        Replace cloud backup
      </button>
      <button type="button" class="item" :disabled="busy" @click="overwriteConfirm = false">Cancel</button>
    </template>

    <template v-else>
      <button
        v-if="cloudAvailable && remoteCloudBackup"
        type="button"
        class="item primary"
        :disabled="busy || probingCloud"
        @click="restoreFromCloud"
      >
        Restore from cloud
      </button>
      <button type="button" class="item" :class="{ primary: !remoteCloudBackup }" :disabled="busy" @click="saveEncryptedBackup">
        Save encrypted backup
      </button>
      <button
        v-if="cloudAvailable && remoteCloudBackup"
        type="button"
        class="item warn-action"
        :disabled="busy || probingCloud"
        @click="startReplaceCloudBackup"
      >
        Replace cloud backup…
      </button>
      <button
        v-else-if="cloudAvailable && remoteCloudBackup === false"
        type="button"
        class="item"
        :disabled="busy || probingCloud"
        @click="enableCloudBackup"
      >
        Enable cloud backup
      </button>
      <button type="button" class="item" :disabled="busy" @click="skip">Skip for now</button>
    </template>

    <p v-if="probingCloud" class="status">Checking cloud backup…</p>
    <p v-if="message" class="message" :class="{ error: messageIsError }">{{ message }}</p>
  </ActionSheet>

  <PassphraseSheet
    :open="passphraseOpen"
    :title="passphraseTitle"
    :confirm="passphraseMode === 'cloud' && !backupPassphraseSet"
    @close="passphraseOpen = false"
    @submit="onPassphrase"
  />
</template>

<style scoped>
.hint { color: var(--text-2); font-size: 14px; margin: 0 0 12px; line-height: 1.4; }
.warn {
  margin: 0 0 12px; padding: 12px; border-radius: var(--nimiq-radius-input);
  font-size: 14px; line-height: 1.4; color: var(--nq-red);
  background: #d9443215; border: 1px solid #d9443244;
}
.item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 12px 0; min-height: 44px; font: inherit; font-weight: 600;
  color: var(--text); cursor: pointer; border-bottom: 1px solid var(--border);
}
.item:last-of-type { border-bottom: none; }
.item.primary { color: var(--nq-gold-dark); }
.item.danger, .item.warn-action { color: var(--nq-red); }
.item:disabled { opacity: 0.5; cursor: default; }
.status { color: var(--text-2); font-size: 13px; margin-top: 8px; }
.message { font-size: 14px; margin-top: 8px; color: var(--nq-green); }
.message.error { color: var(--nq-red); }
</style>
