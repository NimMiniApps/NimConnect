<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { loadSampleContacts } from '../services/samples'
import { preferredCurrency, incomingAddress } from '../services/prefs'
import { ValidationUtils } from '@nimiq/utils/validation-utils'
import { FIAT_CURRENCIES } from '../services/rates'
import { clearHistoryCache } from '../services/history'
import { clearOnboardingDone, clearBackupOnboardingDone } from '../services/onboarding'
import { afterRestore, enableCloudAfterRestore } from '../services/restore'
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
import { copyText } from '../services/share'
import PassphraseSheet from '../components/PassphraseSheet.vue'
import QrCode from '../components/QrCode.vue'
import type { EncryptedBackup } from '../types/profile'

const router = useRouter()
const store = useProfilesStore()
const message = ref('')
const confirmReset = ref(false)
const resetting = ref(false)
const showAdvanced = ref(false)
const showIncomingQr = ref(false)
const incomingCopyFeedback = ref<string | null>(null)
const passphraseOpen = ref(false)
const passphraseConfirm = ref(false)
const passphraseMode = ref<'export' | 'import' | 'cloud-enable' | 'cloud-restore'>('export')
const pendingImport = ref<EncryptedBackup | null>(null)

const appVersion = __APP_VERSION__
const buildDate = __BUILD_DATE__
const gitCommit = __GIT_COMMIT__

const incomingValid = computed(() =>
  !!incomingAddress.value.trim() && ValidationUtils.isValidAddress(incomingAddress.value.trim()),
)

const cloudStatusLabel = computed(() => (cloudBackupEnabled.value ? 'Enabled' : 'Not enabled'))
const cloudLastBackupLabel = computed(() => formatBackupWhen(lastCloudSyncAt.value))
const localLastBackupLabel = computed(() => formatBackupWhen(lastLocalBackupAt.value))

function formatBackupWhen(ts: number): string {
  if (!ts) return 'Never'
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  const age = formatBackupAge(ts)
  if (age.endsWith('h ago') || age.endsWith('m ago') || age === 'Just now') return age
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`
}

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
      await afterRestore()
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
    await afterRestore()
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
  if (!insideNimiqPay.value) {
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
    enableCloudAfterRestore(passphrase, address)
    message.value = `Restored ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''} from cloud.`
    await afterRestore()
  } catch {
    message.value = 'Wrong passphrase or cloud backup unavailable.'
  }
}

function disableCloudBackup() {
  cloudBackupEnabled.value = false
  clearBackupSession()
  message.value = 'Cloud backup disabled.'
}

async function copyIncomingAddress() {
  if (!incomingValid.value) return
  await copyText(ValidationUtils.normalizeAddress(incomingAddress.value.trim()))
  incomingCopyFeedback.value = 'Copied ✓'
  window.setTimeout(() => { incomingCopyFeedback.value = null }, 2000)
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
    clearOnboardingDone()
    clearBackupOnboardingDone()
    message.value = 'All local data deleted.'
    await router.replace('/')
  } catch {
    message.value = 'Could not erase local data — try again.'
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
        <span>Preferred currency</span>
        <select v-model="preferredCurrency">
          <option value="NIM">NIM</option>
          <option v-for="c in FIAT_CURRENCIES" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <p class="hint">Default currency for splits and invoices — always converted to NIM at the day's rate.</p>

      <div class="incoming-block">
        <label class="pref-row">
          <span>Incoming address</span>
          <input
            v-model="incomingAddress"
            type="text"
            placeholder="NQ…"
            :class="{ invalid: incomingAddress.trim() && !incomingValid }"
          />
        </label>
        <div class="incoming-actions">
          <button
            type="button"
            class="mini-btn"
            :disabled="!incomingValid"
            @click="copyIncomingAddress"
          >
            {{ incomingCopyFeedback ?? 'Copy' }}
          </button>
          <button
            type="button"
            class="mini-btn"
            :disabled="!incomingValid"
            :aria-pressed="showIncomingQr"
            @click="showIncomingQr = !showIncomingQr"
          >
            {{ showIncomingQr ? 'Hide QR' : 'Show QR' }}
          </button>
        </div>
        <div v-if="showIncomingQr && incomingValid" class="incoming-qr">
          <QrCode :text="ValidationUtils.normalizeAddress(incomingAddress.trim())" :size="160" />
        </div>
      </div>
      <p class="hint">Nimiq Pay receives on a separate address — auto-detected when possible, or paste it here for Activity.</p>
    </div>

    <div class="card group privacy">
      <h2>🛡 Privacy &amp; security</h2>
      <ul class="privacy-list">
        <li><span class="privacy-check" aria-hidden="true">✓</span> Contacts stay on this device</li>
        <li><span class="privacy-check" aria-hidden="true">✓</span> Notes are never public</li>
        <li><span class="privacy-check" aria-hidden="true">✓</span> Public profile only shares selected fields</li>
      </ul>
    </div>

    <div class="card group">
      <h2>Backup</h2>

      <template v-if="cloudBackupAvailable()">
        <section class="status-card" aria-label="Cloud backup status">
          <div class="status-card-head">
            <h3>Cloud backup</h3>
            <span
              class="status-badge"
              :class="cloudBackupEnabled ? 'on' : 'off'"
            >{{ cloudStatusLabel }}</span>
          </div>
          <dl class="status-rows">
            <div class="status-row">
              <dt>Status</dt>
              <dd>{{ cloudBackupEnabled ? 'Enabled ✓' : 'Not enabled' }}</dd>
            </div>
            <div class="status-row">
              <dt>Last backup</dt>
              <dd>{{ cloudLastBackupLabel }}</dd>
            </div>
          </dl>
          <p v-if="!insideNimiqPay" class="hint">Cloud backup requires Nimiq Pay to sign with your wallet.</p>
          <div class="status-actions">
            <button
              v-if="!cloudBackupEnabled"
              type="button"
              class="nq-button status-cta"
              :disabled="!insideNimiqPay"
              @click="enableCloudBackup"
            >
              Enable
            </button>
            <button
              v-else
              type="button"
              class="item status-item"
              @click="syncCloudNow"
            >
              ☁️ Sync now
            </button>
            <button type="button" class="item status-item" @click="restoreFromCloud">
              ⬇ Restore from cloud
            </button>
            <button
              v-if="cloudBackupEnabled"
              type="button"
              class="item subtle status-item"
              @click="disableCloudBackup"
            >
              Disable cloud backup
            </button>
          </div>
        </section>
      </template>

      <section class="backup-group" aria-labelledby="local-backup-heading">
        <h3 id="local-backup-heading">Local backup</h3>
        <p class="hint">Last backed up: {{ localLastBackupLabel }}</p>
        <button type="button" class="item" @click="requestExport">🔒 Export encrypted backup</button>
        <button type="button" class="item" @click="importBackup">⬆ Import backup</button>
        <input ref="fileInput" type="file" accept="application/json,.nimconnect" hidden @change="importJson" />
      </section>

      <button type="button" class="item subtle" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '▾' : '▸' }} Advanced
      </button>
      <template v-if="showAdvanced">
        <p class="hint">Demo and power-user tools — not needed for normal use.</p>
        <button type="button" class="item subtle" @click="seedSamples">✨ Add sample contacts (demo)</button>
        <button type="button" class="item warn" @click="exportPlainJson">
          Export unencrypted JSON
        </button>
      </template>
      <p v-if="message" class="message">{{ message }}</p>
    </div>

    <div class="card group">
      <h2>Data</h2>
      <template v-if="confirmReset">
        <p class="warn">Erase all contacts and local data on this device? This cannot be undone.</p>
        <button type="button" class="item danger" :disabled="resetting" @click="resetApp">
          {{ resetting ? 'Erasing…' : 'Yes, erase everything' }}
        </button>
        <button type="button" class="item" :disabled="resetting" @click="cancelReset">Cancel</button>
      </template>
      <button v-else type="button" class="item danger" @click="resetApp">🗑 Erase local data</button>
      <p class="hint">
        Removes all local contacts, notes, cached history and settings from this device.
        Public profiles and blockchain data are not affected.
      </p>
    </div>

    <div class="card group">
      <h2>About</h2>
      <p class="about">
        NimConnect — a relationship manager for your wallet.
      </p>
      <dl class="about-meta">
        <div class="about-row">
          <dt>License</dt>
          <dd>MIT</dd>
        </div>
        <div class="about-row">
          <dt>Version</dt>
          <dd>{{ appVersion }}</dd>
        </div>
        <div class="about-row">
          <dt>Build date</dt>
          <dd>{{ buildDate }}</dd>
        </div>
        <div class="about-row">
          <dt>Git commit</dt>
          <dd class="mono">{{ gitCommit }}</dd>
        </div>
      </dl>
      <a class="item" href="https://github.com/NimMiniApps/NimConnect" target="_blank" rel="noopener">
        ↗ Source code on GitHub
      </a>
      <p class="about">
        Built for the Nimiq Pay Mini App competition with Vue, Dexie and the official
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
.group h3 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 800;
  color: var(--text);
}
.pref-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-weight: 600; }
.pref-row select,
.pref-row input {
  font: inherit; font-weight: 700; padding: 8px 10px; min-height: 44px;
  border: 1px solid var(--border); border-radius: var(--nimiq-radius-input); background: var(--bg); color: var(--text);
}
.pref-row input { flex: 1; min-width: 0; }
.pref-row input.invalid { border-color: var(--nq-red); }

.incoming-block { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.incoming-actions { display: flex; gap: 8px; }
.mini-btn {
  flex: 1;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--nimiq-radius-pill);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.mini-btn:disabled { opacity: 0.45; cursor: default; }
.mini-btn:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 2px; }
.incoming-qr {
  padding: 12px;
  border-radius: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
}

.privacy-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.privacy-list li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}
.privacy-check {
  flex-shrink: 0;
  color: var(--nq-green);
  font-weight: 800;
}

.status-card {
  margin: 4px 0 16px;
  padding: 14px;
  border-radius: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
}
.status-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.status-card-head h3 { margin: 0; }
.status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: var(--nimiq-radius-pill);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.status-badge.on {
  color: var(--nq-green);
  background: color-mix(in srgb, var(--nq-green) 18%, transparent);
}
.status-badge.off {
  color: var(--text-2);
  background: color-mix(in srgb, var(--text) 6%, transparent);
}
.status-rows {
  margin: 0 0 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.status-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.status-row dt {
  margin: 0;
  font-weight: 600;
  color: var(--text-2);
}
.status-row dd {
  margin: 0;
  font-weight: 800;
  text-align: right;
}
.status-actions { display: flex; flex-direction: column; }
.status-cta {
  width: 100%;
  margin-bottom: 4px;
}
.status-item { border-bottom-color: color-mix(in srgb, var(--border) 70%, transparent); }
.backup-group { margin-top: 4px; }

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
.about-meta {
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.about-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.about-row dt {
  margin: 0;
  font-weight: 600;
  color: var(--text-2);
}
.about-row dd {
  margin: 0;
  font-weight: 800;
  text-align: right;
}
.about-row dd.mono {
  font-family: var(--nimiq-font-family-mono);
  font-size: 12px;
}
</style>
