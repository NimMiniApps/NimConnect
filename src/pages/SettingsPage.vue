<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'

const router = useRouter()
const store = useProfilesStore()
const message = ref('')
const fileInput = ref<HTMLInputElement>()

function exportJson() {
  const doc = store.exportDocument()
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
</script>

<template>
  <div class="page">
    <button type="button" class="back" @click="router.back()">‹ Back</button>
    <h1>Settings</h1>

    <div class="card group">
      <h2>Backup</h2>
      <button class="item" @click="exportJson">⬇ Export contacts (JSON)</button>
      <button class="item" @click="fileInput?.click()">⬆ Import contacts (JSON)</button>
      <input ref="fileInput" type="file" accept="application/json" hidden @change="importJson" />
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
.item {
  display: block; width: 100%; text-align: left; background: none; border: none;
  padding: 12px 0; min-height: 44px; font: inherit; font-weight: 600;
  color: var(--text); cursor: pointer; border-bottom: 1px solid var(--border);
}
.item:last-of-type { border-bottom: none; }
a.item { text-decoration: none; border-bottom: none; display: flex; align-items: center; }
.message { color: var(--nq-green); font-size: 14px; }
.about { color: var(--text-2); font-size: 14px; line-height: 1.6; margin: 0; }
</style>
