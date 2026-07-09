<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { loadSampleContacts } from '../services/samples'
import { preferredCurrency, incomingAddress } from '../services/prefs'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { FIAT_CURRENCIES } from '../services/rates'
import { clearHistoryCache } from '../services/history'
import { resetBootstrap } from '../services/wallet-bootstrap'
import { createEncryptedBackup, parseEncryptedBackup } from '../services/backup'
import {
  lastLocalBackupAt, formatBackupAge, markLocalBackup, markPassphraseSet, backupPassphraseSet,
  cloudBackupEnabled, lastCloudSyncAt,
} from '../services/backup-prefs'
import {
  cloudBackupAvailable, downloadCloudBackup, setBackupSession, clearBackupSession,
  uploadCloudBackup,
} from '../services/cloud-backup'
import { getMyAddress, insideNimiqPay } from '../services/nimiq'
import PassphraseSheet from '../components/PassphraseSheet.vue'
import type { EncryptedBackup } from '../types/profile'

const router = useRouter()
const store = useProfilesStore()
const message = ref('')
const confirmReset = ref(false)
const resetting = ref(false)
const showAdvanced = ref(false)
const passphraseOpen = ref(false)
const passphraseConfirm = ref(false)
const passphraseMode = ref<'export' | 'import' | 'cloud-enable' | 'cloud-restore'>('export')
const pendingImport = ref<EncryptedBackup | null>(null)

async function seedSamples() {
  const added = await loadSampleContacts()
  message.value = added
    ? `Added ${added} sample contact${added === 1 ? '' : 's'}.`
    : 'Sample contacts are already in your list.'
}
const fileInput = ref<HTMLInputElement>()

function downloadBlob(content: string, filename: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function requestExport() {
  passphraseMode.value = 'export'
  passphraseConfirm.value = !backupPassphraseSet.value
  passphraseOpen.value = true
}

async function onExportPassphrase(passphrase: string) {
  try {
    const file = await createEncryptedBackup(passphrase, store.self?.address)
    const date = new Date().toISOString().slice(0, 10)
    downloadBlob(JSON.stringify(file, null, 2), `nimconnect-backup-${date}.nimconnect`)
    markPassphraseSet()
    markLocalBackup()
    message.value = 'Encrypted backup saved.'
  } catch {
    message.value = 'Could not create backup.'
  }
}

async function exportPlainJson() {
  const doc = await store.exportDocument()
  const date = new Date().toISOString().slice(0, 10)
  downloadBlob(JSON.stringify(doc, null, 2), `nimconnect-${date}.json`)
  message.value = 'Unencrypted export saved — keep this file private.'
}

function importBackup() {
  fileInput.value?.click()
}

async function importJson(event: Event) {
  message.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const parsed = JSON.parse(await file.text())
    if (parsed.format === 'encrypted-backup') {
      pendingImport.value = parsed as EncryptedBackup
      passphraseMode.value = 'import'
      passphraseConfirm.value = false
      passphraseOpen.value = true
    } else {
      const { added, skipped } = await store.importDocument(parsed)
      message.value = `Imported ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate/invalid` : ''}.`
      markLocalBackup()
    }
  } catch {
    message.value = 'That file is not a valid NimConnect export.'
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function onImportPassphrase(passphrase: string) {
  if (!pendingImport.value) return
  try {
    const doc = await parseEncryptedBackup(pendingImport.value, passphrase)
    const { added, skipped } = await store.importDocument(doc)
    markPassphraseSet()
    markLocalBackup()
    message.value = `Imported ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate/invalid` : ''}.`
    pendingImport.value = null
  } catch {
    message.value = 'Wrong passphrase or corrupted backup.'
  }
}

function onPassphraseSubmit(passphrase: string) {
  if (passphraseMode.value === 'export') onExportPassphrase(passphrase)
  else if (passphraseMode.value === 'import') onImportPassphrase(passphrase)
  else if (passphraseMode.value === 'cloud-enable') onEnableCloud(passphrase)
  else onCloudRestorePassphrase(passphrase)
}

async function onEnableCloud(passphrase: string) {
  const address = store.self?.address ?? await getMyAddress()
  if (!address) {
    message.value = 'Connect your wallet in Nimiq Pay to enable cloud backup.'
    return
  }
  try {
    setBackupSession(passphrase, address)
    cloudBackupEnabled.value = true
    markPassphraseSet()
    await uploadCloudBackup(passphrase, address)
    message.value = 'Cloud backup enabled and synced.'
  } catch (e) {
    clearBackupSession()
    cloudBackupEnabled.value = false
    const err = (e as Error).message
    if (err === 'Not running inside Nimiq Pay') {
      message.value = 'Open NimConnect inside Nimiq Pay to sign cloud backups.'
    } else if (err.includes('Failed to fetch') || err.includes('NetworkError')) {
      message.value = 'Could not reach the backup API. Start it with: docker compose up'
    } else {
      message.value = err || 'Could not enable cloud backup.'
    }
  }
}

async function enableCloudBackup() {
  if (!insideNimiqPay) {
    message.value = 'Open NimConnect inside Nimiq Pay to enable cloud backup.'
    return
  }
  if (!cloudBackupAvailable()) {
    message.value = 'Cloud backup API is not configured yet.'
    return
  }
  passphraseMode.value = 'cloud-enable'
  passphraseConfirm.value = !backupPassphraseSet.value
  passphraseOpen.value = true
}

async function syncCloudNow() {
  const address = store.self?.address ?? await getMyAddress()
  if (!address) {
    message.value = 'Connect your wallet to sync.'
    return
  }
  passphraseMode.value = 'cloud-enable'
  passphraseConfirm.value = false
  passphraseOpen.value = true
}

async function restoreFromCloud() {
  passphraseMode.value = 'cloud-restore'
  passphraseConfirm.value = false
  passphraseOpen.value = true
}

async function onCloudRestorePassphrase(passphrase: string) {
  const address = store.self?.address ?? await getMyAddress()
  if (!address) {
    message.value = 'Connect your wallet to restore from cloud.'
    return
  }
  try {
    const file = await downloadCloudBackup(address)
    if (!file) {
      message.value = 'No cloud backup found for this wallet.'
      return
    }
    const doc = await parseEncryptedBackup(file, passphrase)
    const { added, skipped } = await store.importDocument(doc)
    setBackupSession(passphrase, address)
    markPassphraseSet()
    message.value = `Restored ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''} from cloud.`
  } catch {
    message.value = 'Wrong passphrase or cloud backup unavailable.'
  }
}

function disableCloudBackup() {
  cloudBackupEnabled.value = false
  clearBackupSession()
  message.value = 'Cloud backup disabled.'
}

async function resetApp() {
  if (!confirmReset.value) {
    confirmReset.value = true
    message.value = ''
    return
  }
  resetting.value = true
  confirmReset.value = false
  try {
    await store.resetAll()
    clearHistoryCache()
    resetBootstrap()
    try { globalThis.localStorage?.removeItem('nimconnect:skipped-restore') } catch {}
    message.value = 'All local data deleted.'
    await router.replace('/')
  } catch {
    message.value = 'Could not reset — try again.'
  } finally {
    resetting.value = false
  }
}

function cancelReset() {
  confirmReset.value = false
}
</script>

<template>
  <div class="page">
    <button type="button" class="back" @click="router.back()">‹ Back</button>
    <h1>Settings</h1>

    <div class="card group">
      <h2>Preferences</h2>
      <label class="pref-row">
        <span>Enter amounts in</span>
        <select v-model="preferredCurrency">
          <option value="NIM">NIM</option>
          <option v-for="c in FIAT_CURRENCIES" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <p class="hint">Default currency for splits and invoices — always converted to NIM at the day's rate.</p>
      <label class="pref-row">
        <span>Incoming address</span>
        <input
          v-model="incomingAddress"
          type="text"
          placeholder="NQ…"
          :class="{ invalid: incomingAddress.trim() && !ValidationUtils.isValidAddress(incomingAddress.trim()) }"
        />
      </label>
      <p class="hint">Nimiq Pay receives on a separate address — paste it here so its payments show in Activity.</p>
    </div>

    <div class="card group">
      <h2>Backup</h2>
      <p class="hint">Last backed up: {{ formatBackupAge(lastLocalBackupAt) }}</p>
      <button class="item" @click="requestExport">🔒 Export encrypted backup</button>
      <button class="item" @click="importBackup">⬆ Import backup</button>
      <input ref="fileInput" type="file" accept="application/json,.nimconnect" hidden @change="importJson" />
      <template v-if="cloudBackupAvailable()">
        <p v-if="!insideNimiqPay" class="hint">Cloud backup requires Nimiq Pay to sign with your wallet.</p>
        <p class="hint">
          Cloud: {{ cloudBackupEnabled ? `on · synced ${formatBackupAge(lastCloudSyncAt)}` : 'off' }}
        </p>
        <button v-if="!cloudBackupEnabled" class="item" :disabled="!insideNimiqPay" @click="enableCloudBackup">☁️ Enable cloud backup</button>
        <button v-else class="item" @click="syncCloudNow">☁️ Sync now</button>
        <button class="item" @click="restoreFromCloud">⬇ Restore from cloud</button>
        <button v-if="cloudBackupEnabled" class="item subtle" @click="disableCloudBackup">Disable cloud backup</button>
      </template>
      <button class="item" @click="seedSamples">✨ Add sample contacts</button>
      <button type="button" class="item subtle" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '▾' : '▸' }} Advanced
      </button>
      <button v-if="showAdvanced" class="item warn" @click="exportPlainJson">
        Export unencrypted JSON
      </button>
      <p v-if="message" class="message">{{ message }}</p>
    </div>

    <div class="card group">
      <h2>Data</h2>
      <template v-if="confirmReset">
        <p class="warn">Delete all contacts and local data? This cannot be undone.</p>
        <button type="button" class="item danger" :disabled="resetting" @click="resetApp">
          {{ resetting ? 'Deleting…' : 'Yes, delete everything' }}
        </button>
        <button type="button" class="item" :disabled="resetting" @click="cancelReset">Cancel</button>
      </template>
      <button v-else type="button" class="item danger" @click="resetApp">🗑 Reset app</button>
      <p class="hint">Deletes all contacts and cached history from this device.</p>
    </div>

    <div class="card group">
      <h2>About</h2>
      <p class="about">
        NimConnect — a relationship manager for your wallet.<br />
        Version 0.1.0 · Built for the Nimiq Pay Mini App competition.
      </p>
      <a class="item" href="https://github.com/NimMiniApps/NimConnect" target="_blank" rel="noopener">
        ↗ Source code on GitHub
      </a>
      <p class="about">
        Open source under the MIT license. Built with Vue, Dexie and the official
        Nimiq libraries (@nimiq/mini-app-sdk, @nimiq/utils, @nimiq/identicons) —
        all Apache-2.0/MIT licensed.
      </p>
    </div>

    <PassphraseSheet
      :open="passphraseOpen"
      :title="passphraseMode === 'export' ? 'Set backup passphrase' : passphraseMode === 'import' ? 'Enter backup passphrase' : passphraseMode === 'cloud-restore' ? 'Restore cloud backup' : 'Cloud backup passphrase'"
      :confirm="passphraseConfirm"
      @close="passphraseOpen = false"
      @submit="onPassphraseSubmit"
    />
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.back { background: none; border: none; color: var(--nq-light-blue); font-size: 16px; padding: 8px 8px 12px 0; cursor: pointer; }
h1 { font-size: 24px; line-height: 1.2; margin: 0 0 16px; }
.group { padding: 16px 20px; margin-bottom: 16px; }
.group h2 { font-size: 14px; color: var(--text-2); margin: 0 0 8px; }
.pref-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-weight: 600; }
.pref-row select,
.pref-row input {
  font: inherit; font-weight: 700; padding: 8px 10px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.pref-row input { flex: 1; min-width: 0; }
.pref-row input.invalid { border-color: var(--nq-red); }
.item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 12px 0; min-height: 44px; font: inherit; font-weight: 600;
  color: var(--text); cursor: pointer; border-bottom: 1px solid var(--border);
}
.item:last-of-type { border-bottom: none; }
.item.danger { color: var(--nq-red); }
.item.warn { color: var(--nq-orange, var(--text-2)); }
.item.subtle { color: var(--text-2); font-size: 14px; }
a.item { text-decoration: none; border-bottom: none; display: flex; align-items: center; }
.message { color: var(--nq-green); font-size: 14px; }
.warn { color: var(--nq-red); font-size: 14px; margin: 0 0 8px; line-height: 1.4; }
.hint { color: var(--text-2); font-size: 13px; margin: 4px 0 0; line-height: 1.4; }
.about { color: var(--text-2); font-size: 14px; line-height: 1.6; margin: 0; }
</style>
