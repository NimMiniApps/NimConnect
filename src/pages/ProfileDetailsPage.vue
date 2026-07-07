<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProfilesStore } from '../stores/profiles'
import ProfileView from '../components/ProfileView.vue'

const route = useRoute()
const router = useRouter()
const store = useProfilesStore()

onMounted(() => store.load())
const profile = computed(() => store.getById(route.params.id as string))

async function remove() {
  if (!profile.value) return
  if (!confirm(`Delete ${profile.value.name}?`)) return
  await store.remove(profile.value.id)
  router.replace('/')
}
</script>

<template>
  <div class="page">
    <button type="button" class="back" @click="router.back()">‹ Back</button>
    <ProfileView
      v-if="profile"
      :profile="profile"
      @edit="router.push(`/edit/${profile!.id}`)"
      @remove="remove"
    />
  </div>
</template>

<style scoped>
.page { padding: 16px; }
.back { background: none; border: none; color: var(--nq-light-blue); font-size: 16px; padding: 8px 8px 12px 0; cursor: pointer; }
</style>
