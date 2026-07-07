<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import { loadSampleContacts } from '../services/samples'
import { preferredCurrency } from '../services/prefs'
import { FIAT_CURRENCIES } from '../services/rates'
import { clearHistoryCache } from '../services/history'
import { resetBootstrap } from '../services/wallet-bootstrap'

const router = useRouter()
const store = useProfilesStore()
const message = ref('')
const confirmReset = ref(false)
const resetting = ref(false)

async function seedSamples() {
  const added = await loadSampleContacts()
  message.value = added
    ? `Added ${added} sample contact${added === 1 ? '' : 's'}.`
    : 'Sample contacts are already in your list.'
}
const fileInput = ref<HTMLInputElement>()

async function exportJson() {
  const doc = await store.exportDocument()
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nimconnect-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function importJson(event: Event) {
  message.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const doc = JSON.parse(await file.text())
    const { added, skipped } = await store.importDocument(doc)
    message.value = `Imported ${added} contact${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate/invalid` : ''}.`
  } catch {
    message.value = 'That file is not a valid NimConnect export.'
  }
  if (fileInput.value) fileInput.value.value = ''
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
    </div>

    <div class="card group">
      <h2>Backup</h2>
      <button class="item" @click="exportJson">⬇ Export contacts (JSON)</button>
      <button class="item" @click="fileInput?.click()">⬆ Import contacts (JSON)</button>
      <input ref="fileInput" type="file" accept="application/json" hidden @change="importJson" />
      <button class="item" @click="seedSamples">✨ Add sample contacts</button>
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
      <p v-if="message" class="message">{{ message }}</p>
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
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.back { background: none; border: none; color: var(--nq-light-blue); font-size: 16px; padding: 8px 8px 12px 0; cursor: pointer; }
h1 { font-size: 28px; margin: 0 0 16px; }
.group { padding: 16px 20px; margin-bottom: 16px; }
.group h2 { font-size: 14px; color: var(--text-2); margin: 0 0 8px; }
.pref-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; font-weight: 600; }
.pref-row select {
  font: inherit; font-weight: 700; padding: 8px 10px; min-height: 44px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--text);
}
.item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 12px 0; min-height: 44px; font: inherit; font-weight: 600;
  color: var(--text); cursor: pointer; border-bottom: 1px solid var(--border);
}
.item:last-of-type { border-bottom: none; }
.item.danger { color: var(--nq-red); }
a.item { text-decoration: none; border-bottom: none; display: flex; align-items: center; }
.message { color: var(--nq-green); font-size: 14px; }
.warn { color: var(--nq-red); font-size: 14px; margin: 0 0 8px; line-height: 1.4; }
.hint { color: var(--text-2); font-size: 13px; margin: 4px 0 0; line-height: 1.4; }
.about { color: var(--text-2); font-size: 14px; line-height: 1.6; margin: 0; }
</style>
