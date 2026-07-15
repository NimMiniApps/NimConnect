<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import Identicon from '../components/Identicon.vue'
import PublicAddressCopy from '../components/PublicAddressCopy.vue'
import PublicSurface from '../components/PublicSurface.vue'
import QrCode from '../components/QrCode.vue'
import {
  resolveHandleEnriched,
  fetchPublicProfile,
  checkHandle,
  claimOwnerAddress,
  NIMFEED_CATALOG_ADDRESS,
  type HandleClaim,
  type PublicProfile,
} from '../services/handles'
import {
  makeRequestLink,
  makeNimiqPayDeepLink,
  makeAppAddLink,
  transactionExplorerUrl,
  addressExplorerUrl,
} from '../services/links'

const route = useRoute()
const state = ref<'loading' | 'ready' | 'notfound' | 'error'>('loading')
/** Why resolve missed — drives copy on the not-found card. */
const notFoundKind = ref<'unclaimed' | 'indexing' | 'pending'>('unclaimed')
const claim = ref<HandleClaim | null>(null)
const profile = ref<PublicProfile | null>(null)
let retryTimer: ReturnType<typeof setInterval> | undefined

const handle = computed(() => String(route.params.handle ?? '').toLowerCase())
const claimTxQuery = computed(() => {
  const raw = route.query.tx
  return typeof raw === 'string' ? raw.trim() : ''
})
const handleLabel = computed(() => `@${handle.value}`)
const publishedName = computed(() => profile.value?.display_name?.trim() ?? '')
const hasDistinctDisplayName = computed(() => {
  const name = publishedName.value
  if (!name) return false
  return name.replace(/^@/, '').toLowerCase() !== handle.value
})
const headline = computed(() =>
  hasDistinctDisplayName.value ? publishedName.value : handleLabel.value,
)
const payAddress = computed(() => (claim.value ? claimOwnerAddress(claim.value) : ''))
const payUri = computed(() => (payAddress.value ? makeRequestLink(payAddress.value) : ''))
const registryExplorer = addressExplorerUrl(NIMFEED_CATALOG_ADDRESS)
const pendingTxUrl = computed(() =>
  claimTxQuery.value ? transactionExplorerUrl(claimTxQuery.value) : '',
)

const safeWebsite = computed(() => {
  try {
    const u = new URL(profile.value?.website ?? '')
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
})

async function loadProfile() {
  const resolved = await resolveHandleEnriched(handle.value)
  if (!resolved) {
    if (claimTxQuery.value) {
      notFoundKind.value = 'pending'
    } else {
      try {
        const check = await checkHandle(handle.value)
        notFoundKind.value = check.available ? 'unclaimed' : 'indexing'
      } catch {
        notFoundKind.value = 'unclaimed'
      }
    }
    state.value = 'notfound'
    return false
  }
  claim.value = resolved
  profile.value = (await fetchPublicProfile(claimOwnerAddress(resolved)))?.profile ?? null
  state.value = 'ready'
  return true
}

function startRetryPoll() {
  clearInterval(retryTimer)
  retryTimer = setInterval(() => {
    void loadProfile().then(ok => { if (ok) clearInterval(retryTimer) })
  }, 12_000)
}

onMounted(async () => {
  try {
    const ok = await loadProfile()
    if (!ok && (notFoundKind.value === 'indexing' || notFoundKind.value === 'pending')) {
      startRetryPoll()
    }
  } catch {
    state.value = 'error'
  }
})

onUnmounted(() => clearInterval(retryTimer))

async function refresh() {
  state.value = 'loading'
  try {
    const ok = await loadProfile()
    if (!ok && (notFoundKind.value === 'indexing' || notFoundKind.value === 'pending')) {
      startRetryPoll()
    }
  } catch {
    state.value = 'error'
  }
}
</script>

<template>
  <PublicSurface context="Public profile" :actions-enabled="state !== 'loading'">
    <template v-if="state === 'ready' && claim" #identity>
      <header class="identity">
        <Identicon :address="payAddress" :size="80" />
        <h1 class="identity__title">{{ headline }}</h1>
        <p v-if="hasDistinctDisplayName" class="identity__handle">{{ handleLabel }}</p>
        <p v-if="profile?.bio" class="identity__bio">{{ profile.bio }}</p>
        <ul v-if="safeWebsite || profile?.github || profile?.x" class="identity__links">
          <li v-if="safeWebsite">
            <a :href="safeWebsite" target="_blank" rel="noopener noreferrer nofollow">Website</a>
          </li>
          <li v-if="profile?.github">
            <a :href="`https://github.com/${profile.github}`" target="_blank" rel="noopener noreferrer">GitHub</a>
          </li>
          <li v-if="profile?.x">
            <a :href="`https://x.com/${profile.x}`" target="_blank" rel="noopener noreferrer">X</a>
          </li>
        </ul>
        <ul v-if="profile?.tags?.length" class="identity__tags">
          <li v-for="tag in profile.tags" :key="tag">{{ tag }}</li>
        </ul>
      </header>
    </template>

    <template #panel>
      <template v-if="state === 'loading'">
        <p class="status">Loading @{{ handle }}…</p>
      </template>

      <template v-else-if="state === 'notfound'">
        <template v-if="notFoundKind === 'pending'">
          <h1 class="status__title">Claim confirming</h1>
          <p class="status__lead">
            @{{ handle }} isn't indexed yet. If you just claimed, the profile usually
            appears within a couple of minutes.
          </p>
          <a
            v-if="pendingTxUrl"
            class="status__link"
            :href="pendingTxUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            View your claim transaction on NimiqScan →
          </a>
        </template>
        <template v-else-if="notFoundKind === 'indexing'">
          <h1 class="status__title">Indexing @{{ handle }}</h1>
          <p class="status__lead">
            This handle is claimed on chain but NimConnect hasn't indexed it yet — try again shortly.
          </p>
          <a class="status__link" :href="registryExplorer" target="_blank" rel="noopener noreferrer">
            Browse claims on the NimFeed registry →
          </a>
        </template>
        <template v-else>
          <h1 class="status__title">@{{ handle }} is free</h1>
          <p class="status__lead">Nobody has claimed this handle yet.</p>
          <router-link class="status__link" to="/">Claim it in NimConnect →</router-link>
          <a class="status__link" :href="registryExplorer" target="_blank" rel="noopener noreferrer">
            Browse claims on the NimFeed registry →
          </a>
        </template>
      </template>

      <template v-else-if="state === 'error'">
        <p class="status">Couldn't load this profile — try again in a moment.</p>
      </template>

      <template v-else-if="claim">
        <h2>Send NIM</h2>
        <QrCode :text="payUri" :size="200" />
        <p class="scan-hint">Scan with any Nimiq wallet</p>
        <PublicAddressCopy :address="payAddress" />
        <a class="verified" :href="transactionExplorerUrl(claim.tx_hash)" target="_blank" rel="noopener">
          ✓ Handle verified on the Nimiq chain
        </a>
      </template>
    </template>

    <template #primary>
      <a v-if="state === 'ready' && claim" :href="makeNimiqPayDeepLink(payAddress)">Send in Nimiq Pay</a>
      <button v-else type="button" @click="refresh">Refresh</button>
    </template>

    <template #secondary>
      <a v-if="state === 'ready' && claim" :href="makeAppAddLink(payAddress)" class="public-action--outline">Add to NimConnect</a>
    </template>

    <template #footer>
      <p>Shared via <strong>NimConnect</strong> — a relationship manager for your wallet.</p>
    </template>
  </PublicSurface>
</template>

<style scoped>
.identity { display: grid; gap: 0.5rem; justify-items: center; }
.identity__title, .status__title { color: var(--text); font-size: 1.625rem; margin: 0; }
.identity__handle { color: var(--nq-gold-dark); font-weight: 800; margin: 0; }
.identity__bio, .status, .status__lead { color: var(--text-2); line-height: 1.5; margin: 0; max-width: 23.75rem; }
.identity__links, .identity__tags { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; list-style: none; margin: 0; padding: 0; }
.identity__links a, .identity__tags li { border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill); color: var(--text-2); font-size: 0.8125rem; font-weight: 700; padding: 0.375rem 0.625rem; text-decoration: none; }
.status__link { color: var(--nq-light-blue); font-size: 0.875rem; font-weight: 700; text-decoration: none; }
.scan-hint { color: var(--text-2); font-size: 0.8125rem; }
.verified { color: var(--nq-green); font-size: 0.75rem; font-weight: 700; text-decoration: none; }
</style>
