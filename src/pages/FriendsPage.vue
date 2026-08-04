<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FriendEntry } from '../services/friends'
import {
  acceptFriendRequest,
  clearFriendsSession,
  declineFriendRequest,
  getStoredFriendsSessionToken,
  listFriendRequests,
  listFriends,
  removeFriend,
  sendFriendRequest,
} from '../services/friends'
import { shortAddress } from '../services/links'
import EmptyState from '../components/EmptyState.vue'

type ViewState = 'connect' | 'loading' | 'ready' | 'error'

const state = ref<ViewState>('connect')
const error = ref('')
const friends = ref<FriendEntry[]>([])
const requests = ref<FriendEntry[]>([])
const addTo = ref('')
const busy = ref(false)

const incoming = computed(() => requests.value.filter(r => r.status === 'pending_in'))
const outgoing = computed(() => requests.value.filter(r => r.status === 'pending_out'))

function label(entry: FriendEntry): string {
  if (entry.displayName) return entry.displayName
  if (entry.handle) return `@${entry.handle}`
  return shortAddress(entry.address)
}

function sublabel(entry: FriendEntry): string {
  const parts: string[] = []
  if (entry.displayName && entry.handle) parts.push(`@${entry.handle}`)
  parts.push(shortAddress(entry.address))
  return parts.join(' · ')
}

async function load() {
  state.value = 'loading'
  error.value = ''
  try {
    const [nextFriends, nextRequests] = await Promise.all([listFriends(), listFriendRequests()])
    friends.value = nextFriends
    requests.value = nextRequests
    state.value = 'ready'
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Friends unavailable'
    if (/\b401\b/.test(message)) {
      clearFriendsSession()
      state.value = 'connect'
      return
    }
    error.value = message
    state.value = 'error'
  }
}

async function onConnect() {
  state.value = 'loading'
  error.value = ''
  try {
    await load()
  } catch {
    state.value = 'connect'
  }
}

async function onAdd() {
  const to = addTo.value.trim()
  if (!to || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await sendFriendRequest(to)
    addTo.value = ''
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not send request'
    if (/\b401\b/.test(error.value)) {
      clearFriendsSession()
      state.value = 'connect'
    }
  } finally {
    busy.value = false
  }
}

async function onAccept(id: string) {
  busy.value = true
  try {
    await acceptFriendRequest(id)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Accept failed'
  } finally {
    busy.value = false
  }
}

async function onDecline(id: string) {
  busy.value = true
  try {
    await declineFriendRequest(id)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Decline failed'
  } finally {
    busy.value = false
  }
}

async function onRemove(address: string) {
  busy.value = true
  try {
    await removeFriend(address)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Remove failed'
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  if (getStoredFriendsSessionToken()) void load()
})
</script>

<template>
  <div class="page">
    <header class="header">
      <h1>Friends</h1>
      <p class="lede">
        Mutual friends shared with apps you authorize.
        <router-link to="/contacts">Contacts</router-link> and notes stay on this device.
      </p>
    </header>

    <div v-if="state === 'connect'" class="hint">
      <p>Sign once with your wallet to manage friend requests.</p>
      <button type="button" class="nq-button" data-connect @click="onConnect">Connect wallet</button>
    </div>

    <p v-else-if="state === 'loading'" class="hint">Loading…</p>

    <div v-else-if="state === 'error'" class="hint">
      <p>{{ error || 'Friends are unavailable right now.' }}</p>
      <button type="button" class="nq-button" data-retry @click="load">Retry</button>
    </div>

    <template v-else>
      <form class="add-form card" @submit.prevent="onAdd">
        <label class="add-label" for="friend-to">Add by @handle or address</label>
        <div class="add-row">
          <input
            id="friend-to"
            v-model="addTo"
            type="text"
            autocomplete="off"
            placeholder="@bob or NQ…"
            :disabled="busy"
          >
          <button type="submit" class="nq-button" :disabled="busy || !addTo.trim()">Add</button>
        </div>
      </form>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <section v-if="incoming.length" class="section">
        <h2 class="section-title">Incoming</h2>
        <ul class="card list">
          <li v-for="entry in incoming" :key="entry.friendshipId" class="row">
            <div class="meta">
              <span class="name">{{ label(entry) }}</span>
              <span class="sub">{{ sublabel(entry) }}</span>
            </div>
            <div class="actions">
              <button type="button" class="nq-button-s" :disabled="busy" @click="onAccept(entry.friendshipId)">Accept</button>
              <button type="button" class="nq-button-s light" :disabled="busy" @click="onDecline(entry.friendshipId)">Decline</button>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="outgoing.length" class="section">
        <h2 class="section-title">Outgoing</h2>
        <ul class="card list">
          <li v-for="entry in outgoing" :key="entry.friendshipId" class="row">
            <div class="meta">
              <span class="name">{{ label(entry) }}</span>
              <span class="sub">{{ sublabel(entry) }} · pending</span>
            </div>
          </li>
        </ul>
      </section>

      <section class="section">
        <h2 class="section-title">Friends</h2>
        <ul v-if="friends.length" class="card list">
          <li v-for="entry in friends" :key="entry.friendshipId" class="row">
            <div class="meta">
              <span class="name">{{ label(entry) }}</span>
              <span class="sub">{{ sublabel(entry) }}</span>
            </div>
            <div class="actions">
              <button type="button" class="nq-button-s light" :disabled="busy" @click="onRemove(entry.address)">Remove</button>
            </div>
          </li>
        </ul>
        <EmptyState
          v-else
          icon="🤝"
          title="No friends yet"
          hint="Add someone by @handle or address. They must accept before you become friends."
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.page { padding: 16px 16px 96px; }
.header { margin-bottom: 16px; }
.header h1 { margin: 0 0 6px; font-size: 1.5rem; }
.lede { margin: 0; color: var(--nq-neutral-600, #5c6573); font-size: 0.95rem; line-height: 1.4; }
.lede a { color: inherit; text-decoration: underline; }
.hint { display: grid; gap: 12px; justify-items: start; }
.add-form { padding: 14px; margin-bottom: 16px; display: grid; gap: 8px; }
.add-label { font-size: 0.85rem; color: var(--nq-neutral-600, #5c6573); }
.add-row { display: flex; gap: 8px; }
.add-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--nq-neutral-200, #d0d4dc);
  border-radius: 8px;
  padding: 10px 12px;
  font: inherit;
}
.section { margin-bottom: 20px; }
.section-title { margin: 0 0 8px; font-size: 0.95rem; color: var(--nq-neutral-600, #5c6573); }
.list { list-style: none; margin: 0; padding: 0; }
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--nq-neutral-100, #eceef2);
}
.row:last-child { border-bottom: 0; }
.meta { display: grid; gap: 2px; min-width: 0; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { font-size: 0.85rem; color: var(--nq-neutral-600, #5c6573); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 6px; flex-shrink: 0; }
.error { color: var(--nq-red, #d94445); font-size: 0.9rem; margin: 0 0 12px; }
</style>
