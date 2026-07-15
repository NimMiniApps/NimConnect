<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import Identicon from '../components/Identicon.vue'
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
  shortAddress,
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
  <div class="public-profile">
    <p v-if="state === 'loading'" class="status">Loading @{{ handle }}…</p>

    <section v-else-if="state === 'notfound'" class="status-card">
      <template v-if="notFoundKind === 'pending'">
        <h1>Claim confirming</h1>
        <p class="lead">
          @{{ handle }} isn't indexed yet. If you just claimed, the profile usually
          appears within a couple of minutes.
        </p>
        <a
          v-if="pendingTxUrl"
          class="explorer-link"
          :href="pendingTxUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          View your claim transaction on NimiqScan →
        </a>
      </template>
      <template v-else-if="notFoundKind === 'indexing'">
        <h1>Indexing @{{ handle }}</h1>
        <p class="lead">
          This handle is claimed on chain but NimConnect hasn't indexed it yet — try again shortly.
        </p>
        <a class="explorer-link" :href="registryExplorer" target="_blank" rel="noopener noreferrer">
          Browse claims on the NimFeed registry →
        </a>
      </template>
      <template v-else>
        <h1>@{{ handle }} is free</h1>
        <p class="lead">Nobody has claimed this handle yet.</p>
        <router-link class="claim-link" to="/">Claim it in NimConnect →</router-link>
        <a class="explorer-link" :href="registryExplorer" target="_blank" rel="noopener noreferrer">
          Browse claims on the NimFeed registry →
        </a>
      </template>
      <button type="button" class="refresh-btn" @click="refresh">Refresh</button>
    </section>

    <p v-else-if="state === 'error'" class="status">Couldn't load this profile — try again in a moment.</p>

    <template v-else-if="claim">
      <header class="who">
        <Identicon :address="payAddress" :size="80" />
        <h1>{{ headline }}</h1>
        <p v-if="hasDistinctDisplayName" class="handle">{{ handleLabel }}</p>
        <p v-if="profile?.bio" class="bio">{{ profile.bio }}</p>
        <ul v-if="safeWebsite || profile?.github || profile?.x" class="socials">
          <li v-if="safeWebsite">
            <a :href="safeWebsite" target="_blank" rel="noopener noreferrer nofollow">🌐 Website</a>
          </li>
          <li v-if="profile?.github">
            <a :href="`https://github.com/${profile.github}`" target="_blank" rel="noopener noreferrer">GitHub</a>
          </li>
          <li v-if="profile?.x">
            <a :href="`https://x.com/${profile.x}`" target="_blank" rel="noopener noreferrer">X</a>
          </li>
        </ul>
        <ul v-if="profile?.tags?.length" class="tags">
          <li v-for="tag in profile.tags" :key="tag">{{ tag }}</li>
        </ul>
      </header>

      <section class="pay-card">
        <h2>Send NIM</h2>
        <QrCode :text="payUri" :size="200" />
        <p class="scan-hint">Scan with any Nimiq wallet</p>
        <p class="address" :title="payAddress">{{ shortAddress(payAddress) }}</p>
        <a class="verified" :href="transactionExplorerUrl(claim.tx_hash)" target="_blank" rel="noopener">
          ✓ Handle verified on the Nimiq chain
        </a>
        <a :href="makeNimiqPayDeepLink(payAddress)" class="primary-btn">Send in Nimiq Pay</a>
        <a :href="makeAppAddLink(payAddress)" class="secondary-btn">Add to NimConnect</a>
      </section>

      <footer class="brand">
        <p><strong>NimConnect</strong> — a relationship manager for your wallet.</p>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.public-profile {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.status { padding: 40px 0; text-align: center; color: var(--text-2); }
.status-card {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 28px 16px; text-align: center;
  border-radius: 16px; background: var(--card); border: 1px solid var(--border);
}
.status-card h1 { margin: 0; font-size: 22px; color: var(--text); }
.lead { margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2); max-width: 380px; }
.claim-link, .explorer-link {
  font-size: 14px; font-weight: 700; color: var(--nq-light-blue); text-decoration: none;
}
.refresh-btn {
  margin-top: 8px; padding: 10px 18px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill);
  background: var(--bg); font: inherit; font-size: 14px; font-weight: 700; color: var(--text); cursor: pointer;
}
.who { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
.who h1 { margin: 8px 0 0; font-size: 26px; line-height: 1.2; color: var(--text); }
.handle { margin: 0; font-size: 15px; font-weight: 800; color: var(--nq-gold-dark); }
.bio { margin: 6px 0 0; max-width: 380px; font-size: 15px; line-height: 1.5; color: var(--text-2); }
.socials { display: flex; gap: 14px; margin: 8px 0 0; padding: 0; list-style: none; }
.socials a { font-size: 14px; font-weight: 700; color: var(--nq-light-blue); text-decoration: none; }
.tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.tags li {
  padding: 3px 10px; border-radius: var(--nimiq-radius-pill); font-size: 12px; font-weight: 700;
  background: var(--bg); border: 1px solid var(--border); color: var(--text-2);
}
.pay-card {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 20px 16px; border-radius: 16px;
  background: var(--card); border: 1px solid var(--border); box-shadow: var(--shadow);
}
.pay-card h2 { margin: 0; font-size: 17px; color: var(--text); }
.scan-hint { margin: 0; font-size: 13px; color: var(--text-2); }
.address { margin: 0; font-size: 13px; font-family: monospace; color: var(--text); }
.verified { font-size: 12px; font-weight: 700; color: var(--nq-green); text-decoration: none; }
.primary-btn {
  display: flex; align-items: center; justify-content: center; width: 100%;
  min-height: 50px; border-radius: var(--nimiq-radius-pill); text-decoration: none;
  font-size: 16px; font-weight: 800; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg); box-shadow: var(--nimiq-shadow);
}
.secondary-btn {
  display: flex; align-items: center; justify-content: center; width: 100%;
  min-height: 44px; border-radius: var(--nimiq-radius-pill); text-decoration: none;
  font-size: 14px; font-weight: 700; color: var(--text);
  border: 1px solid var(--border); background: var(--card);
}
.brand { margin-top: auto; text-align: center; font-size: 13px; color: var(--text-2); }
.brand strong { color: var(--nq-gold-dark); }
</style>
