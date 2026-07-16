<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import type { Profile, ProfileType } from '../types/profile'
import { shortAddress } from '../services/links'
import { useProfilesStore } from '../stores/profiles'
import Identicon from './Identicon.vue'

const props = defineProps<{ profile: Profile; pendingCount?: number }>()
const store = useProfilesStore()

const flash = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined

onUnmounted(() => clearTimeout(flashTimer))

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

function typeLabel(type: ProfileType): string | null {
  if (type === 'merchant') return 'Merchant'
  if (type === 'business') return 'Business'
  if (type === 'person') return null
  return 'Other'
}

/** Who they are — handle, tag, role. Address only as last resort. */
const identityLine = computed(() => {
  const p = props.profile
  if (p.handle) return `@${p.handle}`
  const tag = p.tags[0]?.trim()
  if (tag) return tag
  const type = typeLabel(p.type)
  if (type) return type
  return shortAddress(p.address)
})

const identityKind = computed<'handle' | 'tag' | 'type' | 'address'>(() => {
  const p = props.profile
  if (p.handle) return 'handle'
  if (p.tags[0]?.trim()) return 'tag'
  if (typeLabel(p.type)) return 'type'
  return 'address'
})

/** How you relate — always a second signal when we have interaction history. */
const activityLine = computed(() => {
  const at = props.profile.lastInteractionAt
  if (!at) return null
  return `Last activity ${formatRelative(at)}`
})

async function onFavoriteClick(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  const adding = !props.profile.favorite
  await store.toggleFavorite(props.profile.id)
  flash.value = adding ? 'Added to Favorites' : 'Removed from Favorites'
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flash.value = null }, 1600)
}
</script>

<template>
  <div class="row">
    <router-link :to="`/profile/${profile.id}`" class="row-link">
      <Identicon :address="profile.address" :size="44" />
      <div class="row-main">
        <div class="row-name">
          <span class="name-text">{{ profile.name }}</span>
          <span
            v-if="profile.type === 'merchant'"
            class="presence merchant"
            title="Merchant"
            aria-label="Merchant"
          >●</span>
        </div>
        <div class="row-meta">
          <div class="row-sub" :class="identityKind">
            <span v-if="identityKind === 'tag'" class="tag-mark" aria-hidden="true">🏷</span>
            {{ identityLine }}
          </div>
          <div v-if="activityLine" class="row-sub activity">{{ activityLine }}</div>
          <div v-if="flash" class="row-flash" role="status">{{ flash }}</div>
        </div>
      </div>
      <span v-if="pendingCount" class="pending-badge">{{ pendingCount }}</span>
    </router-link>

    <button
      type="button"
      class="fav-btn"
      :class="{ on: profile.favorite, pulse: !!flash }"
      :aria-label="profile.favorite ? 'Remove from favorites' : 'Add to favorites'"
      :aria-pressed="profile.favorite"
      :title="profile.favorite ? 'Remove from favorites' : 'Add to favorites'"
      @click="onFavoriteClick"
    >
      <span
        class="fav-star"
        :class="{ 'star-pop': !!flash && profile.favorite }"
        aria-hidden="true"
      >{{ profile.favorite ? '★' : '☆' }}</span>
    </button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: stretch;
  min-height: 56px;
}
.row-link {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px 8px 14px;
  text-decoration: none;
  color: var(--text);
  transition: background 0.12s ease;
}
.row-link:active { background: var(--border); }
.row-main { flex: 1; min-width: 0; }
.row-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  min-width: 0;
}
.name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.presence {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
}
.presence.merchant { color: var(--nq-gold); }
.row-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.row-sub {
  font-size: 13px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-sub.handle { color: var(--nq-light-blue); font-weight: 600; }
.row-sub.tag {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tag-mark { font-size: 11px; line-height: 1; }
.row-sub.activity { font-size: 12px; }
.row-flash {
  font-size: 11px;
  font-weight: 700;
  color: var(--nq-gold-dark);
  animation: flash-in 0.2s var(--nimiq-ease);
}
@keyframes flash-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}
.pending-badge {
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  border-radius: var(--nimiq-radius-small);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--text-6);
  color: var(--nq-gold-dark);
  font-size: 12px;
  font-weight: 800;
}
.fav-btn {
  flex-shrink: 0;
  align-self: center;
  width: 44px;
  height: 44px;
  margin: 0 6px 0 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-2);
  opacity: 0.75;
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  transition: color 0.2s var(--nimiq-ease), opacity 0.2s var(--nimiq-ease), transform 0.15s var(--nimiq-ease);
}
.fav-btn:active { transform: scale(0.9); }
.fav-btn.on {
  color: var(--nq-gold);
  opacity: 1;
}
.fav-btn.pulse .fav-star {
  animation: star-fill 0.42s var(--nimiq-ease);
}
.fav-star {
  font-size: 22px;
  line-height: 1;
  transition: transform 0.2s var(--nimiq-ease);
}
@keyframes star-fill {
  0% { transform: scale(0.85); opacity: 0.7; }
  45% { transform: scale(1.35); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
