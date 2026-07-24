<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ClaimHandleSheet from './ClaimHandleSheet.vue'
import OnboardingSheet from './OnboardingSheet.vue'
import BackupOnboardingSheet from './BackupOnboardingSheet.vue'
import ShareProfileStep from './ShareProfileStep.vue'
import { useProfilesStore } from '../stores/profiles'
import {
  resolveIdentitySetup,
  markHandleClaimedCelebration,
  dismissShareProfile,
  dismissBackup,
  type IdentitySetupInput,
} from '../services/identity-setup'
import { handlesEnabled, loadMyHandle, saveMyHandle, type HandleClaim } from '../services/handles'
import { myAddresses } from '../services/nimiq'
import { makePublicHandleLink } from '../services/links'
import { makeProfileShareLink } from '../services/profile-share'
import { backupPassphraseSet, cloudBackupEnabled, lastLocalBackupAt } from '../services/backup-prefs'
import { afterRestore } from '../services/restore'
import { hasFilledProfile } from '../services/onboarding'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const store = useProfilesStore()
const selfHandle = ref<string | null>(null)
const currentStepIndex = ref(0)

const inputs = computed<IdentitySetupInput>(() => ({
  handlesEnabled: handlesEnabled(),
  handle: selfHandle.value,
  profileFilled: hasFilledProfile(store.self),
  backupDone: backupPassphraseSet.value || cloudBackupEnabled.value || lastLocalBackupAt.value > 0,
  contactCount: store.contacts.length,
}))

const steps = computed(() => resolveIdentitySetup(inputs.value).steps)
const currentStep = computed(() => steps.value[currentStepIndex.value])
const publicUrl = computed(() => {
  if (selfHandle.value) return makePublicHandleLink(selfHandle.value)
  return store.self ? makeProfileShareLink(store.self) : ''
})

function firstIncompleteIndex(): number {
  const idx = steps.value.findIndex(s => !s.done)
  return idx === -1 ? steps.value.length : idx
}

watch(() => props.open, (open) => {
  if (!open) return
  const self = store.self
  selfHandle.value = self?.handle ?? null
  if (handlesEnabled() && self) {
    const cached = loadMyHandle(myAddresses(self.address))
    if (cached?.handle) selfHandle.value = cached.handle
  }
  const idx = firstIncompleteIndex()
  if (idx >= steps.value.length) {
    emit('close')
    return
  }
  currentStepIndex.value = idx
}, { immediate: true })

function advance() {
  if (currentStepIndex.value < steps.value.length - 1) {
    currentStepIndex.value++
  } else {
    emit('close')
  }
}

function goBack() {
  if (currentStepIndex.value > 0) currentStepIndex.value--
}

function requestExit() {
  emit('close')
}

function onHandleClaimed(handle: string, txHash: string, claim?: HandleClaim) {
  if (store.self && claim) saveMyHandle(myAddresses(store.self.address), claim)
  selfHandle.value = handle
  markHandleClaimedCelebration(handle)
  advance()
}

async function onBackupRestored() {
  await afterRestore()
  advance()
}

function goAddContact() {
  emit('close')
  router.push('/add?from=onboarding')
}

/** Share and backup nudges are declined permanently, not deferred — see dismissShareProfile/dismissBackup. */
function dismissShareStep() {
  dismissShareProfile()
  advance()
}

function dismissBackupStep() {
  dismissBackup()
  advance()
}
</script>

<template>
  <div v-if="open && currentStep" class="wizard-backdrop">
    <div class="wizard">
      <header class="wizard-chrome">
        <button
          v-if="currentStepIndex > 0"
          type="button"
          class="wizard-back"
          aria-label="Previous step"
          @click="goBack"
        >‹</button>
        <div class="wizard-progress">
          <div class="wizard-bar-track">
            <div
              class="wizard-bar-fill"
              :style="{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }"
            />
          </div>
          <p class="wizard-counter">STEP {{ currentStepIndex + 1 }} OF {{ steps.length }}</p>
        </div>
        <button type="button" class="wizard-exit" aria-label="Exit setup" @click="requestExit">✕</button>
      </header>

      <div class="wizard-body">
        <ClaimHandleSheet
          v-if="currentStep.id === 'claim-handle'"
          :open="true"
          embedded
          @claimed="onHandleClaimed"
          @defer="advance"
        />
        <OnboardingSheet
          v-else-if="currentStep.id === 'fill-profile'"
          :open="true"
          embedded
          @complete="advance"
          @defer="advance"
        />
        <ShareProfileStep
          v-else-if="currentStep.id === 'share-profile'"
          :public-url="publicUrl"
          @complete="advance"
          @defer="dismissShareStep"
        />
        <div v-else-if="currentStep.id === 'first-contact'" class="wizard-step">
          <h2 class="title">Add your first contact</h2>
          <p class="hint">Add someone you pay — they'll show up on Home.</p>
          <button type="button" class="primary" @click="goAddContact">Add a contact</button>
          <button type="button" class="skip" @click="advance">Skip for now</button>
        </div>
        <BackupOnboardingSheet
          v-else-if="currentStep.id === 'setup-backup'"
          :open="true"
          embedded
          @complete="advance"
          @defer="dismissBackupStep"
          @restored="onBackupRestored"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard-backdrop {
  position: fixed; inset: 0; z-index: 60;
  background: var(--bg);
  display: flex; justify-content: center;
}
.wizard { width: 100%; max-width: 560px; display: flex; flex-direction: column; }
.wizard-chrome {
  display: flex; align-items: center; gap: 12px;
  padding: calc(12px + env(safe-area-inset-top)) 20px 12px;
}
.wizard-back, .wizard-exit {
  flex: 0 0 auto; min-width: 32px; min-height: 32px; border: none; background: none;
  color: var(--text-2); font-size: 18px; cursor: pointer;
}
.wizard-progress { flex: 1; min-width: 0; }
.wizard-bar-track { height: 4px; border-radius: 2px; background: var(--border); overflow: hidden; }
.wizard-bar-fill { height: 100%; border-radius: 2px; background: var(--nimiq-gold-bg); transition: width var(--movement-duration) var(--nimiq-ease); }
.wizard-counter { margin: 8px 0 0; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; color: var(--text-2); }
.wizard-body { flex: 1; padding: 8px 20px 20px; overflow-y: auto; }
.title { margin: 0 0 8px; font-size: 20px; font-weight: 800; color: var(--text); }
.hint { margin: 0 0 20px; font-size: 14px; color: var(--text-2); line-height: 1.4; }
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); background: var(--nimiq-gold-bg);
}
.skip {
  background: none; border: none; min-height: 44px; width: 100%; margin-top: 8px;
  font: inherit; font-weight: 600; color: var(--text-2); cursor: pointer;
}
</style>
