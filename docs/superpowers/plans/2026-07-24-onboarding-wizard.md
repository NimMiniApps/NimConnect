# Unified Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two disconnected first-run flows (`App.vue`'s modal sequence + `IdentitySetupCard`'s Home checklist) with one full-screen, slick 5-step wizard: claim handle → fill profile → back up wallet → share profile → add contact.

**Architecture:** A new `OnboardingWizard.vue` full-screen orchestrator mounts the three existing form components (`ClaimHandleSheet`, `OnboardingSheet`, `BackupOnboardingSheet`) in a new `embedded` mode via one new `ActionSheet` prop, plus one new small `ShareProfileStep.vue`, plus an inline final step for adding a contact that hands off to `/add?from=onboarding`. Step completion is a derived predicate (never a dismissal flag), computed once in `resolveIdentitySetup()` and shared by the wizard and the Home resume banner.

**Tech Stack:** Vue 3 (`<script setup>`, Composition API), Pinia (`useProfilesStore`), Vitest + `@vue/test-utils`, Vue Router (hash history).

## Global Constraints

- No new persisted "deferred" state — a deferred step and a never-visited step are both just "not done" (spec: State and data flow).
- `embedded` mode on `ClaimHandleSheet` / `OnboardingSheet` / `BackupOnboardingSheet` must not change their existing standalone (non-embedded) behavior at all — every existing call site (`/me?sheet=claim`, etc.) keeps working unchanged (spec: Component reuse).
- Profile-filled completion is derived from `self.name !== 'Me'`, never from `markOnboardingDone()`/`DONE_KEY` (spec: State and data flow — legacy-user fix).
- `PassphraseSheet` stays a real, non-embedded modal inside the backup step — do not add an `embedded` prop to it (spec: Exception — nested passphrase modal).
- Step order is claim-handle → fill-profile → setup-backup → share-profile → first-contact (spec: Supersedes).

---

## File Structure

- **Modify** `src/components/ActionSheet.vue` — add `embedded` rendering mode.
- **Modify** `src/services/identity-setup.ts` — new step order, new `profileFilled`/`backupDone` inputs.
- **Modify** `src/services/identity-setup.test.ts` — rewritten for the new shape.
- **Modify** `src/services/onboarding.ts` — add a single "wizard shown once" flag.
- **Modify** `src/services/onboarding.test.ts` — cover the new flag.
- **Modify** `src/components/ClaimHandleSheet.vue` — `embedded` prop, `defer` event, always-visible skip when embedded.
- **Modify** `src/components/OnboardingSheet.vue` — `embedded` prop, `defer` event replaces `mark*Done`-on-skip when embedded.
- **Modify** `src/components/BackupOnboardingSheet.vue` — same pattern as `OnboardingSheet`.
- **Create** `src/components/ShareProfileStep.vue` — new embedded-only step body.
- **Modify** `src/pages/ProfileFormPage.vue` — `from=onboarding` query handling.
- **Create** `src/services/onboarding-wizard-state.ts` — one shared `ref<boolean>` so both `App.vue` (mounts the wizard) and the Home resume banner (opens it) control the same instance, matching the existing `backup-prefs.ts` exported-ref pattern.
- **Create** `src/components/OnboardingWizard.vue` — the full-screen orchestrator.
- **Modify** `src/App.vue` — replace the two-sheet first-run sequence with the wizard.
- **Modify** `src/App.test.ts` — cover the new wiring.
- **Modify** `src/components/IdentitySetupCard.vue` — replaced with a slim resume banner (same filename, new contents, since `HomePage.vue` already imports it by this name).
- **Modify** `src/components/IdentitySetupCard.test.ts` — rewritten for the new shape.
- **Modify** `src/pages/HomePage.vue` — wire the resume banner and drop the old per-step handlers.
- **Modify** `src/pages/HomePage.test.ts` (if present) — cover the new wiring, or add one if none exists.

---

### Task 1: `ActionSheet` embedded mode

**Files:**
- Modify: `src/components/ActionSheet.vue`
- Test: `src/components/ActionSheet.test.ts` (new)

**Interfaces:**
- Produces: `ActionSheet` prop `embedded?: boolean` (default `false`). When `true`: no teleport, no backdrop, no drag-to-dismiss, no page-scroll lock; renders the header (if `title` given) + `<slot />` in normal document flow.

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/ActionSheet.test.ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ActionSheet from './ActionSheet.vue'

describe('ActionSheet', () => {
  it('teleports to body and shows a backdrop by default', () => {
    const wrapper = mount(ActionSheet, {
      props: { open: true, title: 'Test' },
      slots: { default: '<p>Body</p>' },
      attachTo: document.body,
    })
    expect(document.querySelector('.backdrop')).not.toBeNull()
    expect(document.body.textContent).toContain('Body')
    wrapper.unmount()
  })

  it('renders inline with no backdrop or teleport when embedded', () => {
    const wrapper = mount(ActionSheet, {
      props: { open: true, title: 'Test', embedded: true },
      slots: { default: '<p>Body</p>' },
      attachTo: document.body,
    })
    expect(document.querySelector('.backdrop')).toBeNull()
    expect(wrapper.find('h2').text()).toBe('Test')
    expect(wrapper.text()).toContain('Body')
    wrapper.unmount()
  })

  it('renders nothing when embedded and closed', () => {
    const wrapper = mount(ActionSheet, {
      props: { open: false, title: 'Test', embedded: true },
      slots: { default: '<p>Body</p>' },
    })
    expect(wrapper.text()).not.toContain('Body')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ActionSheet.test.ts`
Expected: FAIL — `embedded` prop doesn't exist yet, backdrop always renders.

- [ ] **Step 3: Implement `embedded` mode**

In `src/components/ActionSheet.vue`, add the prop and guard the scroll-lock calls:

```ts
const props = defineProps<{
  open: boolean
  title: string
  subtitle?: string
  prominentTitle?: boolean
  embedded?: boolean
}>()
```

```ts
watch(() => props.open, open => {
  dragY.value = 0
  dragging.value = false
  if (props.embedded) return
  if (open) lockPageScroll()
  else unlockPageScroll()
}, { immediate: true })
```

Replace the template with a fragment that branches on `embedded`:

```html
<template>
  <teleport to="body" v-if="!embedded">
    <transition name="sheet">
      <div v-if="open" class="backdrop" @click.self="close" @touchmove.self.prevent>
        <div class="sheet card" :class="{ dragging }" :style="sheetStyle">
          <button
            type="button"
            class="sheet-handle"
            aria-label="Close sheet"
            @click="close"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <span class="sheet-bar" />
          </button>
          <header class="sheet-head">
            <h2 :class="{ 'sheet-title--prominent': prominentTitle }">{{ title }}</h2>
            <p v-if="subtitle" class="sheet-subtitle">{{ subtitle }}</p>
          </header>
          <slot />
        </div>
      </div>
    </transition>
  </teleport>
  <div v-else-if="open" class="sheet-embedded">
    <header class="sheet-head" v-if="title">
      <h2 :class="{ 'sheet-title--prominent': prominentTitle }">{{ title }}</h2>
      <p v-if="subtitle" class="sheet-subtitle">{{ subtitle }}</p>
    </header>
    <slot />
  </div>
</template>
```

Add one small style rule alongside the existing `.sheet-head`/`.sheet h2` rules (they already target plain `h2`/`.sheet-head` selectors scoped to the component, so `.sheet-embedded` just needs its own block width):

```css
.sheet-embedded { width: 100%; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ActionSheet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ActionSheet.vue src/components/ActionSheet.test.ts
git commit -m "feat: add embedded rendering mode to ActionSheet"
```

---

### Task 2: `identity-setup.ts` — new step order and predicates

**Files:**
- Modify: `src/services/identity-setup.ts`
- Modify: `src/services/identity-setup.test.ts`

**Interfaces:**
- Produces: `IdentitySetupInput` gains `profileFilled: boolean` and `backupDone: boolean`. `IdentitySetupStepId` becomes `'claim-handle' | 'fill-profile' | 'setup-backup' | 'share-profile' | 'first-contact'`. `resolveIdentitySetup()` returns steps in that order (claim-handle first only when `handlesEnabled`).
- Consumes: nothing new.

- [ ] **Step 1: Update the failing/changed tests first**

Replace `src/services/identity-setup.test.ts` in full:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearIdentitySetupState,
  clearCelebration,
  identitySetupVisible,
  markPublicProfileShared,
  markHandleClaimedCelebration,
  snoozeIdentitySetup,
  isSnoozed,
  cancelSnooze,
  resolveIdentitySetup,
  noteIdentitySetupProgress,
  SNOOZE_MS,
  type IdentitySetupInput,
} from './identity-setup'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

const base = (over: Partial<IdentitySetupInput> = {}): IdentitySetupInput => ({
  handlesEnabled: true,
  handle: null,
  profileFilled: false,
  backupDone: false,
  contactCount: 0,
  ...over,
})

describe('identity-setup', () => {
  beforeEach(() => {
    stubLocalStorage()
    clearIdentitySetupState()
  })

  it('orders steps claim-handle, fill-profile, setup-backup, share-profile, first-contact', () => {
    const r = resolveIdentitySetup(base())
    expect(r.steps.map(s => s.id)).toEqual([
      'claim-handle', 'fill-profile', 'setup-backup', 'share-profile', 'first-contact',
    ])
    expect(r.nextStep).toBe('claim-handle')
    expect(r.complete).toBe(false)
  })

  it('treats empty or whitespace handle as unclaimed', () => {
    expect(resolveIdentitySetup(base({ handle: '' })).nextStep).toBe('claim-handle')
    expect(resolveIdentitySetup(base({ handle: '   ' })).nextStep).toBe('claim-handle')
  })

  it('omits claim-handle when handles are disabled', () => {
    const r = resolveIdentitySetup(base({ handlesEnabled: false }))
    expect(r.steps.map(s => s.id)).toEqual(['fill-profile', 'setup-backup', 'share-profile', 'first-contact'])
    expect(r.nextStep).toBe('fill-profile')
  })

  it('walks the remaining steps in order as each predicate flips true', () => {
    expect(resolveIdentitySetup(base({ handle: 'chuck' })).nextStep).toBe('fill-profile')
    expect(resolveIdentitySetup(base({ handle: 'chuck', profileFilled: true })).nextStep).toBe('setup-backup')
    expect(
      resolveIdentitySetup(base({ handle: 'chuck', profileFilled: true, backupDone: true })).nextStep,
    ).toBe('share-profile')
    expect(
      resolveIdentitySetup(
        base({ handle: 'chuck', profileFilled: true, backupDone: true, contactCount: 1 }),
      ).nextStep,
    ).toBe('share-profile') // share-profile still not done — separate signal
  })

  it('never shows when already complete', () => {
    markPublicProfileShared()
    const r = resolveIdentitySetup(
      base({ handle: 'chuck', profileFilled: true, backupDone: true, contactCount: 2 }),
    )
    expect(r.complete).toBe(true)
    expect(identitySetupVisible(r)).toBe(false)
  })

  it('snoozes for 24h and cancels when progress happens', () => {
    const t0 = 1_000_000
    snoozeIdentitySetup(t0)
    expect(isSnoozed(t0 + 1000)).toBe(true)
    expect(isSnoozed(t0 + SNOOZE_MS + 1)).toBe(false)
    snoozeIdentitySetup(t0)
    cancelSnooze()
    expect(isSnoozed(t0 + 1000)).toBe(false)
    snoozeIdentitySetup(t0)
    noteIdentitySetupProgress()
    expect(isSnoozed(t0 + 1000)).toBe(false)
  })

  it('celebration phase claimed clears after share', () => {
    markHandleClaimedCelebration('chuck')
    let r = resolveIdentitySetup(base({ handle: 'chuck', profileFilled: true, backupDone: true }))
    expect(r.celebration).toBe('claimed')
    expect(r.celebrationHandle).toBe('chuck')
    markPublicProfileShared()
    r = resolveIdentitySetup(base({ handle: 'chuck', profileFilled: true, backupDone: true }))
    expect(r.celebration).toBeNull()
    expect(r.nextStep).toBe('first-contact')
    expect(r.steps.find(s => s.id === 'share-profile')!.done).toBe(true)
  })

  it('clearCelebration drops celebration without marking the profile shared', () => {
    markHandleClaimedCelebration('chuck')
    expect(resolveIdentitySetup(base({ handle: 'chuck' })).celebration).toBe('claimed')
    clearCelebration()
    const r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBeNull()
    expect(r.steps.find(s => s.id === 'share-profile')!.done).toBe(false)
  })

  it('normalizes celebration handle to trimmed lowercase', () => {
    markHandleClaimedCelebration('  Chuck  ')
    const r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBe('claimed')
    expect(r.celebrationHandle).toBe('chuck')
  })

  it('suppresses celebration when handle is missing', () => {
    markHandleClaimedCelebration('chuck')
    const r = resolveIdentitySetup(base({ handle: null }))
    expect(r.celebration).toBeNull()
    expect(r.celebrationHandle).toBeNull()
  })

  it('celebration claimed overrides active snooze', () => {
    const t0 = 1_000_000
    markHandleClaimedCelebration('chuck')
    snoozeIdentitySetup(t0)
    const r = resolveIdentitySetup(base({ handle: 'chuck' }))
    expect(r.celebration).toBe('claimed')
    expect(isSnoozed(t0 + 1000)).toBe(true)
    expect(identitySetupVisible(r, t0 + 1000)).toBe(true)
  })

  it('hides when incomplete, snoozed, and not celebrating', () => {
    const t0 = 1_000_000
    snoozeIdentitySetup(t0)
    const r = resolveIdentitySetup(base())
    expect(identitySetupVisible(r, t0 + 1000)).toBe(false)
  })

  it('shows when incomplete and not snoozed', () => {
    const r = resolveIdentitySetup(base())
    expect(identitySetupVisible(r, 1_000_000)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/identity-setup.test.ts`
Expected: FAIL — old step order/shape.

- [ ] **Step 3: Update `src/services/identity-setup.ts`**

```ts
export type IdentitySetupStepId = 'claim-handle' | 'fill-profile' | 'setup-backup' | 'share-profile' | 'first-contact'
```

```ts
export interface IdentitySetupInput {
  handlesEnabled: boolean
  handle: string | null
  profileFilled: boolean
  backupDone: boolean
  contactCount: number
}
```

```ts
const STEP_LABELS: Record<IdentitySetupStepId, string> = {
  'claim-handle': 'Claim your @handle',
  'fill-profile': 'Set up your profile',
  'setup-backup': 'Back up your wallet',
  'share-profile': 'Share your public profile',
  'first-contact': 'Add your first contact',
}
```

```ts
export function resolveIdentitySetup(input: IdentitySetupInput): IdentitySetupResult {
  const handle = normalizeHandle(input.handle)
  const hasHandle = !!handle
  const steps: IdentitySetupStep[] = []

  if (input.handlesEnabled) {
    steps.push({ id: 'claim-handle', label: STEP_LABELS['claim-handle'], done: hasHandle })
  }
  steps.push({ id: 'fill-profile', label: STEP_LABELS['fill-profile'], done: input.profileFilled })
  steps.push({ id: 'setup-backup', label: STEP_LABELS['setup-backup'], done: input.backupDone })
  steps.push({ id: 'share-profile', label: STEP_LABELS['share-profile'], done: publicProfileShared() })
  steps.push({ id: 'first-contact', label: STEP_LABELS['first-contact'], done: input.contactCount > 0 })

  const firstUndone = steps.find(s => !s.done)
  const nextStep = firstUndone ? firstUndone.id : null
  const complete = nextStep == null

  const stored = currentCelebration()
  const celebration = stored.celebration === 'claimed' && hasHandle ? 'claimed' : null
  const celebrationHandle = celebration ? stored.celebrationHandle : null

  return { steps, nextStep, complete, celebration, celebrationHandle }
}
```

(Only the step-push block and the two type declarations above change — everything else in the file, including `publicProfileShared`, `markPublicProfileShared`, the celebration functions, snooze functions, and `identitySetupVisible`, stays as-is.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/identity-setup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/identity-setup.ts src/services/identity-setup.test.ts
git commit -m "feat: reorder identity setup steps and derive profile/backup from real state"
```

---

### Task 3: `onboarding.ts` — one "wizard shown" flag

**Files:**
- Modify: `src/services/onboarding.ts`
- Modify: `src/services/onboarding.test.ts`

**Interfaces:**
- Produces: `onboardingWizardShown(): boolean`, `markOnboardingWizardShown(): void`, `hasFilledProfile(self: Profile | null | undefined): boolean`. Existing exports (`needsOnboarding`, `needsBackupOnboarding`, `markOnboardingDone`, etc.) are untouched — they're superseded for step-completion purposes but nothing in this task removes them, since Task 11 still needs to check remaining call sites before deciding what (if anything) to delete.
- Produces (shared predicate): `hasFilledProfile` is the one tested place the "profile filled" rule lives — `needsOnboarding()` already inlines the same `self.name === 'Me'` check but isn't reused here to avoid touching its existing behavior; `hasFilledProfile` is the new, single source of truth Tasks 10 and 12 both import instead of each inlining `self?.name !== 'Me'` themselves.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/onboarding.test.ts` (inside the existing `describe('onboarding', ...)` block, after the last `it`, and add `onboardingWizardShown, markOnboardingWizardShown, hasFilledProfile` to the existing import list at the top of the file):

```ts
  it('wizard-shown flag defaults false and can be marked', () => {
    expect(onboardingWizardShown()).toBe(false)
    markOnboardingWizardShown()
    expect(onboardingWizardShown()).toBe(true)
  })

  it('hasFilledProfile is false for the stub name, missing profile, or blank name', () => {
    expect(hasFilledProfile(self('Me'))).toBe(false)
    expect(hasFilledProfile(null)).toBe(false)
    expect(hasFilledProfile(self(''))).toBe(false)
  })

  it('hasFilledProfile is true for a real name, independent of markOnboardingDone (legacy-user case)', () => {
    // No markOnboardingDone() call here on purpose — this is the exact legacy scenario:
    // a profile that already has a real name but never triggered the old dismissal flag.
    expect(onboardingDone()).toBe(false)
    expect(hasFilledProfile(self('Alice'))).toBe(true)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/onboarding.test.ts`
Expected: FAIL — `onboardingWizardShown`/`hasFilledProfile` are not exported.

- [ ] **Step 3: Implement in `src/services/onboarding.ts`**

Add near the other key constants and functions:

```ts
const WIZARD_SHOWN_KEY = 'nimconnect:onboarding-wizard-shown'

export function onboardingWizardShown(): boolean {
  return globalThis.localStorage?.getItem(WIZARD_SHOWN_KEY) === '1'
}

export function markOnboardingWizardShown(): void {
  try { globalThis.localStorage?.setItem(WIZARD_SHOWN_KEY, '1') } catch { /* best-effort */ }
}

/** Derived from profile data alone — never from markOnboardingDone(), so a legacy
 *  profile that already has a real name reports correctly even if it never
 *  triggered the old first-run dismissal flag. */
export function hasFilledProfile(self: Profile | null | undefined): boolean {
  return !!self && self.name.trim() !== '' && self.name !== 'Me'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/onboarding.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/onboarding.ts src/services/onboarding.test.ts
git commit -m "feat: add wizard-shown flag and shared hasFilledProfile predicate"
```

---

### Task 4: `ClaimHandleSheet` embedded mode

**Files:**
- Modify: `src/components/ClaimHandleSheet.vue`
- Test: `src/components/ClaimHandleSheet.test.ts` (new)

**Interfaces:**
- Produces: new prop `embedded?: boolean`; new emit `defer: []`. Existing `close`/`claimed` emits and their meaning are unchanged in both modes.
- Consumes: `ActionSheet`'s `embedded` prop from Task 1.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/ClaimHandleSheet.test.ts
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import ClaimHandleSheet from './ClaimHandleSheet.vue'
import { db } from '../db/db'

describe('ClaimHandleSheet embedded mode', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
  })

  it('shows a Skip for now control and emits defer without emitting close', async () => {
    const wrapper = mount(ClaimHandleSheet, {
      props: { open: true, embedded: true },
      attachTo: document.body,
    })
    const skip = wrapper.get('.skip')
    await skip.trigger('click')
    expect(wrapper.emitted('defer')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not show a Skip for now control in standalone mode', () => {
    const wrapper = mount(ClaimHandleSheet, {
      props: { open: true },
      attachTo: document.body,
    })
    expect(wrapper.find('.skip').exists()).toBe(false)
    wrapper.unmount()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ClaimHandleSheet.test.ts`
Expected: FAIL — no `.skip` element, no `defer` emit.

- [ ] **Step 3: Implement in `src/components/ClaimHandleSheet.vue`**

Change the props/emits declaration:

```ts
const props = defineProps<{ open: boolean; embedded?: boolean }>()
const emit = defineEmits<{ close: []; defer: []; claimed: [handle: string, txHash: string, claim?: HandleClaim] }>()
```

Add a `defer` function next to `close`:

```ts
function defer() {
  handle.value = ''
  availability.value = 'idle'
  result.value = null
  error.value = null
  debugInfo.value = null
  emit('defer')
}
```

Update the template — pass `embedded` through, and add the skip control outside the `insideNimiqPay` branch so it's available even when the user isn't inside Nimiq Pay yet:

```html
<template>
  <ActionSheet :open="open" :embedded="embedded" title="Claim your @handle" @close="close">
    <template v-if="insideNimiqPay">
      <template v-if="result">
        <p class="ok">
          🎉 Claim for <strong>@{{ handle.trim().toLowerCase() }}</strong> is on the chain.
          <template v-if="result === 'pending'">
            It'll be confirmed within a couple of minutes — earliest claim wins.
          </template>
        </p>
        <button class="primary" @click="close">Done</button>
      </template>
      <template v-else>
        <p class="intro">
          Your @handle is claimed with a tiny on-chain transaction and belongs to
          your wallet address — permanently, first come first served.
        </p>
        <label class="handle-label">
          Handle
          <div class="handle-input">
            <span aria-hidden="true">@</span>
            <input
              v-model="handle"
              maxlength="26"
              autocapitalize="off"
              autocomplete="off"
              spellcheck="false"
              placeholder="chuck"
            />
          </div>
        </label>
        <p class="hint" :class="{ good: availability === 'available', bad: availability === 'taken' || availability === 'reserved' }">
          {{ HINTS[availability] }}
        </p>
        <p v-if="error" class="err">{{ error }}</p>
        <details v-if="debugInfo" class="debug">
          <summary>Debug info</summary>
          <pre>{{ debugInfo }}</pre>
          <button type="button" class="debug-copy" @click="copyDebug">
            {{ debugCopied ? 'Copied ✓' : 'Copy debug info' }}
          </button>
        </details>
        <button
          class="primary"
          :disabled="claiming || availability === 'taken' || availability === 'reserved' || !isValidHandle(handle.trim().toLowerCase())"
          @click="doClaim"
        >
          {{ claiming ? 'Waiting for confirmation…' : 'Claim with a dust transaction' }}
        </button>
      </template>
    </template>
    <p v-else class="hint">Open NimConnect inside Nimiq Pay to claim a handle.</p>
    <button v-if="embedded && !result" type="button" class="skip" @click="defer">Skip for now</button>
  </ActionSheet>
</template>
```

Add the skip button's style, matching `OnboardingSheet`'s `.skip` rule:

```css
.skip {
  background: none; border: none; min-height: 44px; width: 100%; margin-top: 8px;
  font: inherit; font-weight: 600; color: var(--text-2); cursor: pointer;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/ClaimHandleSheet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ClaimHandleSheet.vue src/components/ClaimHandleSheet.test.ts
git commit -m "feat: add embedded skip-for-now to ClaimHandleSheet"
```

---

### Task 5: `OnboardingSheet` embedded mode

**Files:**
- Modify: `src/components/OnboardingSheet.vue`
- Test: `src/components/OnboardingSheet.test.ts` (new)

**Interfaces:**
- Produces: new prop `embedded?: boolean`; new emit `defer: []`. `complete` keeps meaning "profile actually saved" in both modes.

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/OnboardingSheet.test.ts
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import OnboardingSheet from './OnboardingSheet.vue'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { onboardingDone, clearOnboardingDone } from '../services/onboarding'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

describe('OnboardingSheet embedded mode', () => {
  beforeEach(async () => {
    stubLocalStorage()
    clearOnboardingDone()
    setActivePinia(createPinia())
    await db.profiles.clear()
    const store = useProfilesStore()
    await store.load()
  })

  it('emits defer without marking onboarding done when skipped', async () => {
    const wrapper = mount(OnboardingSheet, {
      props: { open: true, embedded: true },
      attachTo: document.body,
    })
    await wrapper.get('.skip').trigger('click')
    expect(wrapper.emitted('defer')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(onboardingDone()).toBe(false)
    wrapper.unmount()
  })

  it('standalone skip still marks onboarding done and emits close', async () => {
    const wrapper = mount(OnboardingSheet, {
      props: { open: true },
      attachTo: document.body,
    })
    await wrapper.get('.skip').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('defer')).toBeUndefined()
    expect(onboardingDone()).toBe(true)
    wrapper.unmount()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/OnboardingSheet.test.ts`
Expected: FAIL — `embedded` skip always marks done and emits `close`.

- [ ] **Step 3: Implement in `src/components/OnboardingSheet.vue`**

```ts
const props = defineProps<{ open: boolean; embedded?: boolean }>()
const emit = defineEmits<{ close: []; complete: []; defer: [] }>()
```

```ts
function skip() {
  if (props.embedded) {
    emit('defer')
    return
  }
  markOnboardingDone()
  emit('close')
}
```

Pass `embedded` through in the template:

```html
<ActionSheet :open="open" :embedded="embedded" title="Set up your profile" @close="skip">
```

(`save()` is unchanged — it still calls `markOnboardingDone()` and emits `complete` in both modes, since that's a real completion, not a skip.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/OnboardingSheet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/OnboardingSheet.vue src/components/OnboardingSheet.test.ts
git commit -m "feat: add embedded defer path to OnboardingSheet"
```

---

### Task 6: `BackupOnboardingSheet` embedded mode

**Files:**
- Modify: `src/components/BackupOnboardingSheet.vue`
- Test: `src/components/BackupOnboardingSheet.test.ts` (new)

**Interfaces:**
- Produces: new prop `embedded?: boolean`; new emit `defer: []`. `complete`/`restored` unchanged in both modes. `PassphraseSheet` usage is untouched (still non-embedded).

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/BackupOnboardingSheet.test.ts
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BackupOnboardingSheet from './BackupOnboardingSheet.vue'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { backupOnboardingDone, clearBackupOnboardingDone } from '../services/onboarding'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

describe('BackupOnboardingSheet embedded mode', () => {
  beforeEach(async () => {
    stubLocalStorage()
    clearBackupOnboardingDone()
    setActivePinia(createPinia())
    await db.profiles.clear()
    const store = useProfilesStore()
    await store.load()
  })

  it('emits defer without marking backup onboarding done when skipped', async () => {
    const wrapper = mount(BackupOnboardingSheet, {
      props: { open: true, embedded: true },
      attachTo: document.body,
    })
    await wrapper.get('.item:not(.primary)').trigger('click') // "Skip for now" is the last plain item
    const skipButtons = wrapper.findAll('.item').filter(b => b.text() === 'Skip for now')
    await skipButtons[0]!.trigger('click')
    expect(wrapper.emitted('defer')?.length).toBeGreaterThan(0)
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(backupOnboardingDone()).toBe(false)
    wrapper.unmount()
  })

  it('standalone skip still marks backup onboarding done and emits close', async () => {
    const wrapper = mount(BackupOnboardingSheet, {
      props: { open: true },
      attachTo: document.body,
    })
    const skipButtons = wrapper.findAll('.item').filter(b => b.text() === 'Skip for now')
    await skipButtons[0]!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(backupOnboardingDone()).toBe(true)
    wrapper.unmount()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/BackupOnboardingSheet.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/components/BackupOnboardingSheet.vue`**

```ts
const props = defineProps<{ open: boolean; embedded?: boolean }>()
const emit = defineEmits<{ close: []; complete: []; restored: []; defer: [] }>()
```

```ts
function skip() {
  if (props.embedded) {
    emit('defer')
    return
  }
  markBackupOnboardingDone()
  emit('close')
}
```

Pass `embedded` through on the main `ActionSheet` only (`PassphraseSheet` keeps no `embedded` prop, per the spec's exception):

```html
<ActionSheet :open="open" :embedded="embedded" title="Back up your contacts" @close="skip">
```

(`finish()` is unchanged — still marks done and emits `complete` in both modes.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/BackupOnboardingSheet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/BackupOnboardingSheet.vue src/components/BackupOnboardingSheet.test.ts
git commit -m "feat: add embedded defer path to BackupOnboardingSheet"
```

---

### Task 7: `ShareProfileStep.vue` (new)

**Files:**
- Create: `src/components/ShareProfileStep.vue`
- Test: `src/components/ShareProfileStep.test.ts` (new)

**Interfaces:**
- Produces: props `{ publicUrl: string }`; emits `{ complete: []; defer: [] }`.
- Consumes: `shareOrCopy` from `src/services/share.ts`; `markPublicProfileShared` from `src/services/identity-setup.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/ShareProfileStep.test.ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShareProfileStep from './ShareProfileStep.vue'
import * as shareService from '../services/share'

describe('ShareProfileStep', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', (() => {
      const data: Record<string, string> = {}
      return {
        getItem: (k: string) => data[k] ?? null,
        setItem: (k: string, v: string) => { data[k] = v },
        removeItem: (k: string) => { delete data[k] },
      }
    })())
  })

  it('renders the public URL', () => {
    const wrapper = mount(ShareProfileStep, { props: { publicUrl: 'https://nimconnect.app/@chuck' } })
    expect(wrapper.text()).toContain('https://nimconnect.app/@chuck')
  })

  it('shares and emits complete on success', async () => {
    vi.spyOn(shareService, 'shareOrCopy').mockResolvedValue('copied')
    const wrapper = mount(ShareProfileStep, { props: { publicUrl: 'https://nimconnect.app/@chuck' } })
    await wrapper.get('.primary').trigger('click')
    await Promise.resolve()
    expect(shareService.shareOrCopy).toHaveBeenCalledWith('https://nimconnect.app/@chuck', 'My NimConnect profile')
    expect(wrapper.emitted('complete')).toHaveLength(1)
  })

  it('emits defer on skip', async () => {
    const wrapper = mount(ShareProfileStep, { props: { publicUrl: 'https://nimconnect.app/@chuck' } })
    await wrapper.get('.skip').trigger('click')
    expect(wrapper.emitted('defer')).toHaveLength(1)
  })

  it('disables the share button without a public URL', () => {
    const wrapper = mount(ShareProfileStep, { props: { publicUrl: '' } })
    expect((wrapper.get('.primary').element as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ShareProfileStep.test.ts`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement `src/components/ShareProfileStep.vue`**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { shareOrCopy } from '../services/share'
import { markPublicProfileShared } from '../services/identity-setup'

const props = defineProps<{ publicUrl: string }>()
const emit = defineEmits<{ complete: []; defer: [] }>()

const sharing = ref(false)

async function share() {
  if (!props.publicUrl || sharing.value) return
  sharing.value = true
  try {
    await shareOrCopy(props.publicUrl, 'My NimConnect profile')
    markPublicProfileShared()
    emit('complete')
  } finally {
    sharing.value = false
  }
}
</script>

<template>
  <div class="share-step">
    <h2 class="title">Share your public profile</h2>
    <p class="hint">Anyone with this link can see your profile and pay you — no wallet address needed.</p>
    <p class="url">{{ publicUrl }}</p>
    <button type="button" class="primary" :disabled="sharing || !publicUrl" @click="share">
      {{ sharing ? 'Sharing…' : 'Share profile' }}
    </button>
    <button type="button" class="skip" :disabled="sharing" @click="emit('defer')">Skip for now</button>
  </div>
</template>

<style scoped>
.title { margin: 0 0 8px; font-size: 20px; font-weight: 800; color: var(--text); }
.hint { margin: 0 0 16px; font-size: 14px; color: var(--text-2); line-height: 1.4; }
.url {
  margin: 0 0 20px; padding: 12px; border: 1px solid var(--border); border-radius: var(--nimiq-radius-input);
  background: var(--bg); color: var(--nq-light-blue); font-size: 13px; font-weight: 600; overflow-wrap: anywhere;
}
.primary {
  width: 100%; height: 48px; border: none; border-radius: var(--nimiq-radius-pill); cursor: pointer;
  font-weight: 700; font-size: 16px; color: var(--nimiq-white); background: var(--nimiq-gold-bg);
}
.primary:disabled { opacity: 0.5; cursor: default; }
.skip {
  background: none; border: none; min-height: 44px; width: 100%; margin-top: 8px;
  font: inherit; font-weight: 600; color: var(--text-2); cursor: pointer;
}
.skip:disabled { opacity: 0.5; cursor: default; }
</style>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ShareProfileStep.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ShareProfileStep.vue src/components/ShareProfileStep.test.ts
git commit -m "feat: add ShareProfileStep wizard step"
```

---

### Task 8: `ProfileFormPage` `from=onboarding` return contract

**Files:**
- Modify: `src/pages/ProfileFormPage.vue`
- Modify: `src/pages/ProfileFormPage.test.ts` (add cases; file already exists per current git status)

**Interfaces:**
- Produces: reading `route.query.from === 'onboarding'` changes `save()`'s post-add redirect from `/profile/:id` to `/`, and changes the header Back control from `router.back()` to `router.replace('/')`.
- Consumes: nothing new — `profilesStore.contacts.length` (already the real completion signal `resolveIdentitySetup()` reads) is what changes as a side effect of `store.add(...)` succeeding.

- [ ] **Step 1: Write the failing tests**

Add to `src/pages/ProfileFormPage.test.ts` (adjust the existing mount helper's `route.query`/router-push pattern to match how other tests in this file already set up the route — use the same router/route mocking already present in the file for the `/add` tests):

```ts
  it('redirects to / instead of /profile/:id when from=onboarding', async () => {
    // Mount at /add?from=onboarding (same pattern as other /add tests in this file),
    // fill the required name + address fields, submit the form.
    // Assert router ends up at '/' rather than a `/profile/:id` path.
  })

  it('Back routes to / instead of browser history when from=onboarding', async () => {
    // Mount at /add?from=onboarding, click the '.back' button,
    // assert router ends up at '/' rather than calling router.back().
  })
```

(Write these against whatever router/route test double this file's existing `/add` tests already use — match that pattern exactly rather than introducing a second one. Read the top of `src/pages/ProfileFormPage.test.ts` first for the existing router setup before filling these in.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/ProfileFormPage.test.ts`
Expected: FAIL — both still use the old routing.

- [ ] **Step 3: Implement in `src/pages/ProfileFormPage.vue`**

Add near the other route-derived computeds (close to `const editId = route.params.id as string | undefined`):

```ts
const fromOnboarding = computed(() => route.query.from === 'onboarding')
```

Update the header Back button:

```html
<button type="button" class="back" @click="fromOnboarding ? router.replace('/') : router.back()">‹ Back</button>
```

Update the new-contact branch of `save()`:

```ts
    } else {
      const p = await store.add({
        name: name.value.trim(), address: address.value, notes: notes.value,
        tags: mergedTags(), favorite: favorite.value, type: type.value,
        ...(claimedHandle.value ? { handle: claimedHandle.value } : {}),
        ...identity,
      })
      router.replace(fromOnboarding.value ? '/' : `/profile/${p.id}`)
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/ProfileFormPage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProfileFormPage.vue src/pages/ProfileFormPage.test.ts
git commit -m "feat: give /add an onboarding return contract"
```

---

### Task 9: Shared wizard-open state

**Files:**
- Create: `src/services/onboarding-wizard-state.ts`
- Test: none (a one-line reactive ref; covered indirectly by Task 10/11's tests)

**Interfaces:**
- Produces: `onboardingWizardOpen: Ref<boolean>` — a single shared instance so both `App.vue` (which mounts the one `OnboardingWizard` instance) and the Home resume banner (which needs to open it) control the same state, following the existing exported-ref pattern already used in `src/services/backup-prefs.ts`.

- [ ] **Step 1: Implement**

```ts
// src/services/onboarding-wizard-state.ts
import { ref } from 'vue'

export const onboardingWizardOpen = ref(false)
```

- [ ] **Step 2: Commit**

```bash
git add src/services/onboarding-wizard-state.ts
git commit -m "feat: add shared onboarding wizard open state"
```

---

### Task 10: `OnboardingWizard.vue` (new)

**Files:**
- Create: `src/components/OnboardingWizard.vue`
- Test: `src/components/OnboardingWizard.test.ts` (new)

**Interfaces:**
- Consumes: `resolveIdentitySetup` (Task 2), embedded `ClaimHandleSheet`/`OnboardingSheet`/`BackupOnboardingSheet` (Tasks 4–6), `ShareProfileStep` (Task 7), `onboardingWizardOpen` (Task 9).
- Produces: `<OnboardingWizard :open="boolean" @close="..." />`. No other props/emits — it derives everything else from live store/service state and self-closes when there's nothing left to do.

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/OnboardingWizard.test.ts
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingWizard from './OnboardingWizard.vue'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { clearIdentitySetupState } from '../services/identity-setup'
import { clearOnboardingDone, clearBackupOnboardingDone } from '../services/onboarding'

function stubLocalStorage() {
  const data: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem(k: string) { return data[k] ?? null },
    setItem(k: string, v: string) { data[k] = v },
    removeItem(k: string) { delete data[k] },
  })
}

describe('OnboardingWizard', () => {
  beforeEach(async () => {
    stubLocalStorage()
    clearIdentitySetupState()
    clearOnboardingDone()
    clearBackupOnboardingDone()
    setActivePinia(createPinia())
    await db.profiles.clear()
    const store = useProfilesStore()
    await store.load()
  })

  it('shows the step counter starting at step 1', async () => {
    const wrapper = mount(OnboardingWizard, { props: { open: true }, attachTo: document.body })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toMatch(/STEP 1 OF \d/)
    wrapper.unmount()
  })

  it('closes immediately when everything is already done', async () => {
    const store = useProfilesStore()
    await store.update(store.self!.id, { name: 'Alice' })
    localStorage.setItem('nimconnect:backup-passphrase-set', '1')
    localStorage.setItem('nimconnect:identity-setup-shared', '1')
    await store.add({ address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', name: 'Bob' })
    const wrapper = mount(OnboardingWizard, { props: { open: true }, attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('exits only from the wizard-level close control, not from inside a step', async () => {
    const wrapper = mount(OnboardingWizard, { props: { open: true }, attachTo: document.body })
    await wrapper.vm.$nextTick()
    await wrapper.get('.wizard-exit').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/OnboardingWizard.test.ts`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement `src/components/OnboardingWizard.vue`**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ClaimHandleSheet from './ClaimHandleSheet.vue'
import OnboardingSheet from './OnboardingSheet.vue'
import BackupOnboardingSheet from './BackupOnboardingSheet.vue'
import ShareProfileStep from './ShareProfileStep.vue'
import { useProfilesStore } from '../stores/profiles'
import { resolveIdentitySetup, markHandleClaimedCelebration, type IdentitySetupInput } from '../services/identity-setup'
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
        <BackupOnboardingSheet
          v-else-if="currentStep.id === 'setup-backup'"
          :open="true"
          embedded
          @complete="advance"
          @defer="advance"
          @restored="onBackupRestored"
        />
        <ShareProfileStep
          v-else-if="currentStep.id === 'share-profile'"
          :public-url="publicUrl"
          @complete="advance"
          @defer="advance"
        />
        <div v-else-if="currentStep.id === 'first-contact'" class="wizard-step">
          <h2 class="title">Add your first contact</h2>
          <p class="hint">Add someone you pay — they'll show up on Home.</p>
          <button type="button" class="primary" @click="goAddContact">Add a contact</button>
          <button type="button" class="skip" @click="advance">Skip for now</button>
        </div>
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
```

Scope note: the claim-handle step's handle lookup on open uses `loadMyHandle()` (the synchronous local cache), not `findMyHandle()` (the async registry re-check `HomePage.vue`/`MyProfilePage.vue` also do). This is an intentional simplification — the wizard only needs a best-effort handle for building the share-step URL, and a stale cache self-corrects the next time the user visits `/me`. Add the async re-check later only if this proves to cause a visibly wrong share link in practice.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/OnboardingWizard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/OnboardingWizard.vue src/components/OnboardingWizard.test.ts
git commit -m "feat: add OnboardingWizard full-screen orchestrator"
```

---

### Task 11: `App.vue` — replace the old first-run sequence

**Files:**
- Modify: `src/App.vue`
- Modify: `src/App.test.ts` (already modified per current git status — reconcile with these changes rather than reverting them)

**Interfaces:**
- Consumes: `OnboardingWizard` (Task 10), `onboardingWizardOpen` (Task 9), `onboardingWizardShown`/`markOnboardingWizardShown` (Task 3).
- Produces: `maybeShowOnboardingWizard()` replaces `maybeShowOnboarding()`/`maybeShowBackupOnboarding()`.

- [ ] **Step 1: Read the current `App.test.ts` first**

Before writing new assertions, read `src/App.test.ts` in full — it's already been modified on this branch (per `git status`) and may already reference `OnboardingSheet`/`BackupOnboardingSheet` mounting behavior that needs updating to `OnboardingWizard` instead. Update rather than duplicate its existing first-run test coverage.

- [ ] **Step 2: Update/add the failing test**

Adjust (or add, if none currently covers this) a test asserting: on a fresh profile with `onboardingWizardShown()` false, after `initApp()` resolves (past the restore-gate skip), `OnboardingWizard`'s `open` prop is `true`, and `onboardingWizardShown()` becomes `true`. Follow whatever mounting/mocking pattern the rest of `App.test.ts` already uses for `bootstrapWallet`/`profilesStore.load` — do not introduce a second pattern.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/App.test.ts`
Expected: FAIL until Step 4 lands.

- [ ] **Step 4: Implement in `src/App.vue`**

Replace the imports:

```ts
import OnboardingWizard from './components/OnboardingWizard.vue'
import { onboardingWizardShown, markOnboardingWizardShown } from './services/onboarding'
import { onboardingWizardOpen } from './services/onboarding-wizard-state'
```

(Remove the `OnboardingSheet`, `BackupOnboardingSheet`, `needsOnboarding`, `needsBackupOnboarding` imports — nothing else in `App.vue` uses them after this change.)

Remove the `onboardingOpen`/`backupOnboardingOpen` refs; replace the three related functions:

```ts
function anyFirstRunSheetOpen() {
  return restoreOpen.value || onboardingWizardOpen.value
}

function maybeShowOnboardingWizard() {
  if (onboardingWizardShown()) return
  markOnboardingWizardShown()
  onboardingWizardOpen.value = true
}
```

Update `tryFirstRunPrompts()` to call `maybeShowOnboardingWizard()` instead of `maybeShowOnboarding()`:

```ts
function tryFirstRunPrompts() {
  if (anyFirstRunSheetOpen()) return
  if (
    !restoreOffered.value
    && profilesStore.contacts.length === 0
    && !globalThis.localStorage?.getItem('nimconnect:skipped-restore')
  ) {
    restoreOpen.value = true
    restoreOffered.value = true
    return
  }
  maybeShowOnboardingWizard()
}
```

Remove `onOnboardingFinished` and `onBackupOnboardingComplete` entirely. Update `onRestoreSkipped`'s `continueFirstRun` call chain — `continueFirstRun()` currently ends by calling `maybeShowOnboarding()`; change that call to `maybeShowOnboardingWizard()`:

```ts
async function continueFirstRun() {
  await bootstrapWallet()
  await profilesStore.load()
  if (profilesStore.self) inboxStore.selfAddress = profilesStore.self.address
  await nextTick()
  maybeShowOnboardingWizard()
}
```

Replace the template's sheet mounts:

```html
<RestoreBackupSheet :open="restoreOpen" @skipped="onRestoreSkipped" @restored="onRestoreComplete" />
<OnboardingWizard :open="onboardingWizardOpen" @close="onboardingWizardOpen = false" />
```

(Remove the old `<OnboardingSheet ...>` and `<BackupOnboardingSheet ...>` template blocks.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/App.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS (aside from Task 12's not-yet-updated `IdentitySetupCard.test.ts`, if that task hasn't landed yet — otherwise full PASS)

- [ ] **Step 7: Commit**

```bash
git add src/App.vue src/App.test.ts
git commit -m "feat: launch the unified onboarding wizard from App.vue"
```

---

### Task 12: `IdentitySetupCard` → slim resume banner, `HomePage` wiring

**Files:**
- Modify: `src/components/IdentitySetupCard.vue` (full rewrite — same filename, `HomePage.vue` already imports it under this name)
- Modify: `src/components/IdentitySetupCard.test.ts` (full rewrite)
- Modify: `src/pages/HomePage.vue`

**Interfaces:**
- Produces: `IdentitySetupCard` becomes `{ props: { label?: string }, emits: { resume: []; dismiss: [] } }` — no more `result`/`publicUrl`/`feedback` props or `claim`/`add-contact`/`share`/`learn-more` emits.
- Consumes: `onboardingWizardOpen` (Task 9), `resolveIdentitySetup` (Task 2, via `HomePage.vue`'s existing `identitySetup` computed).

- [ ] **Step 1: Write the failing tests**

Replace `src/components/IdentitySetupCard.test.ts` in full:

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import IdentitySetupCard from './IdentitySetupCard.vue'
import identitySetupCardSource from './IdentitySetupCard.vue?raw'

describe('IdentitySetupCard resume banner', () => {
  it('shows a default label when none is given', () => {
    const wrapper = mount(IdentitySetupCard)
    expect(wrapper.text()).toContain('Finish setting up')
  })

  it('shows a custom label when given', () => {
    const wrapper = mount(IdentitySetupCard, { props: { label: 'Back up your wallet next.' } })
    expect(wrapper.text()).toContain('Back up your wallet next.')
  })

  it('emits resume from the CTA', async () => {
    const wrapper = mount(IdentitySetupCard)
    await wrapper.get('.resume-cta').trigger('click')
    expect(wrapper.emitted('resume')).toHaveLength(1)
  })

  it('emits dismiss from the subtle dismiss control', async () => {
    const wrapper = mount(IdentitySetupCard)
    await wrapper.get('[aria-label="Dismiss"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('reuses the Home panel visual language instead of a new design system', () => {
    expect(identitySetupCardSource).toMatch(/class="[^"]*home-panel/)
    expect(identitySetupCardSource).toMatch(/var\(--text\)/)
    expect(identitySetupCardSource).toMatch(/var\(--nimiq-gold-bg\)|var\(--nq-/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/IdentitySetupCard.test.ts`
Expected: FAIL — old props/shape.

- [ ] **Step 3: Rewrite `src/components/IdentitySetupCard.vue`**

```vue
<script setup lang="ts">
defineProps<{ label?: string }>()
const emit = defineEmits<{ resume: []; dismiss: [] }>()
</script>

<template>
  <section class="home-panel resume-banner">
    <button type="button" class="resume-dismiss" aria-label="Dismiss" @click="emit('dismiss')">✕</button>
    <h2 class="resume-title">Finish setting up</h2>
    <p class="resume-sub">{{ label ?? 'A few steps left to get the most out of NimConnect.' }}</p>
    <button type="button" class="resume-cta primary-action" @click="emit('resume')">Continue</button>
  </section>
</template>

<style scoped>
.resume-banner {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.resume-dismiss {
  position: absolute;
  top: 12px;
  right: 12px;
  min-width: 28px;
  min-height: 28px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-2);
  font-size: 13px;
  opacity: 0.7;
}
.resume-title {
  margin: 0;
  padding-right: 28px;
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
}
.resume-sub {
  margin: 0;
  color: var(--text-2);
  font-size: 14px;
}
.resume-cta {
  margin-top: 4px;
  min-height: 44px;
  padding: 0 16px;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  background: var(--nimiq-gold-bg);
  color: var(--nimiq-blue);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
}
</style>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/IdentitySetupCard.test.ts`
Expected: PASS

- [ ] **Step 5: Update `src/pages/HomePage.vue`**

Replace the `IdentitySetupCard` import's usage and drop the now-unused per-step handlers. Import the shared wizard state:

```ts
import { onboardingWizardOpen } from '../services/onboarding-wizard-state'
```

Replace the template block:

```html
<IdentitySetupCard
  v-if="identityCardVisible"
  @resume="onboardingWizardOpen = true"
  @dismiss="dismissIdentitySetup"
/>
```

(Remove the now-unused `<p v-if="showLearnMore" ...>` block, `showLearnMore` ref, `toggleLearnMore`, `claimIdentity`, `addContactFromIdentity`, `shareIdentityProfile`, `identityPublicUrl`, and `identityFeedback` from the `<script setup>` block — grep the file for each name first to confirm nothing else in `HomePage.vue` still uses it, particularly the `EmptyState` block below, which calls `claimIdentity`/`shareIdentityProfile` directly — those call sites stay, since `EmptyState` is a separate first-time-user path unrelated to the resume banner; only remove a helper if it truly has no remaining callers.)

Update the `identitySetup` computed's input to match the new `IdentitySetupInput` shape from Task 2:

```ts
const identitySetup = computed<IdentitySetupResult>(() => {
  void identitySetupVersion.value
  return resolveIdentitySetup({
    handlesEnabled: handlesEnabled(),
    handle: selfHandle.value,
    profileFilled: hasFilledProfile(profilesStore.self),
    backupDone: backupPassphraseSet.value || cloudBackupEnabled.value || lastLocalBackupAt.value > 0,
    contactCount: profilesStore.contacts.length,
  })
})
```

Add the new imports this requires:

```ts
import { backupPassphraseSet, cloudBackupEnabled, lastLocalBackupAt } from '../services/backup-prefs'
import { hasFilledProfile } from '../services/onboarding'
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS. If `src/pages/HomePage.test.ts` exists and references the removed handlers/props, update it the same way `IdentitySetupCard.test.ts` was updated in Step 3. If it doesn't exist, this step needs no new file — HomePage's identity-setup wiring is already covered indirectly by `IdentitySetupCard.test.ts` and `identity-setup.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/components/IdentitySetupCard.vue src/components/IdentitySetupCard.test.ts src/pages/HomePage.vue
git commit -m "feat: replace the Home checklist with a slim resume banner"
```

---

### Task 13: Manual verification

**Files:** none (no code changes — verification only)

- [ ] **Step 1: Type-check and build**

Run: `npx vue-tsc --noEmit && npx vite build`
Expected: both succeed with no errors.

- [ ] **Step 2: Run the complete test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Manual walkthrough (mobile viewport)**

Start the dev server, open a fresh profile (or clear local storage), and walk the wizard end-to-end:
- Confirm it auto-launches once after the restore gate.
- Confirm the progress bar and "STEP X OF N" counter update correctly across all 5 steps (or 4, if testing with handles disabled).
- Defer at least one step (e.g. backup) via its "Skip for now" control, and confirm it reappears via the Home resume banner afterward rather than reading as done.
- Complete the claim-handle step and confirm the Share step's URL uses the claimed handle.
- Trigger the cloud-backup passphrase flow and confirm `PassphraseSheet` still pops up correctly as a modal over the full-screen wizard.
- Complete the final add-contact step via the `/add?from=onboarding` handoff and confirm it lands back on Home rather than a contact detail page.
- Confirm the wizard's ✕ exits cleanly from any step and the resume banner picks up wherever it left off.
- Confirm `/me?sheet=claim` (claiming a handle later, outside the wizard) still opens the standalone bottom sheet exactly as before.
