# Compact Profile Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate QR and public-page sharing into one on-demand owner-profile share sheet.

**Architecture:** `ProfileView` exposes compact owner-profile actions and emits an event when sharing is requested. `MyProfilePage` retains handle and public-page data, then presents existing QR and share/copy primitives in an `ActionSheet`. A small pure helper defines the available share actions, allowing the public-link condition to be regression-tested in the node-based Vitest setup.

**Tech Stack:** Vue 3 Composition API, TypeScript, Vitest, existing NimConnect `ActionSheet`, QR, and share services.

## Global Constraints

- Preserve the profile-share QR payload and public `@handle` URL format.
- Do not change handle claiming, confirmation polling, wallet behavior, contact profiles, or external public-profile pages.
- Keep actions at least 44 px high and retain visible keyboard focus.
- Do not overwrite unrelated uncommitted workspace changes.

---

### Task 1: Model available owner-profile share actions

**Files:**

- Create: `src/services/profile-sharing.ts`
- Test: `src/services/profile-sharing.test.ts`

**Interfaces:**

- Produces: `profileShareActions(profileLink: string, publicPageUrl?: string): ProfileShareAction[]`.
- Produces entries shaped as `{ kind: 'profile' | 'public'; link: string; title: string; label: string }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { profileShareActions } from './profile-sharing'

describe('profileShareActions', () => {
  it('keeps the public-page action out until a claimed URL exists', () => {
    expect(profileShareActions('https://nimconnect.app/add?profile=x')).toEqual([
      { kind: 'profile', link: 'https://nimconnect.app/add?profile=x', title: 'NimConnect profile', label: 'Share profile link' },
    ])
  })
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/services/profile-sharing.test.ts`

Expected: FAIL because `./profile-sharing` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ProfileShareAction = { kind: 'profile' | 'public'; link: string; title: string; label: string }

export function profileShareActions(profileLink: string, publicPageUrl?: string): ProfileShareAction[] {
  const actions: ProfileShareAction[] = [{ kind: 'profile', link: profileLink, title: 'NimConnect profile', label: 'Share profile link' }]
  if (publicPageUrl) actions.push({ kind: 'public', link: publicPageUrl, title: 'Public profile', label: 'Share public page' })
  return actions
}
```

- [ ] **Step 4: Verify green**

Run: `npm test -- src/services/profile-sharing.test.ts`

Expected: PASS with 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add src/services/profile-sharing.ts src/services/profile-sharing.test.ts
git commit -m "feat: model profile share actions"
```

### Task 2: Make sharing a compact owner-profile action

**Files:**

- Modify: `src/components/ProfileView.vue`
- Modify: `src/pages/MyProfilePage.vue`
- Modify: `src/services/profile-sharing.test.ts`

**Interfaces:**

- Consumes: `ProfileView` emits `share` when the owner selects `Share profile`.
- Consumes: `profileShareActions(shareLink, publicProfileUrl)` from Task 1.
- Produces: a compact identity, `Share profile` action, and sheet containing QR and available link actions.

- [ ] **Step 1: Write the failing test**

Add this case to `src/services/profile-sharing.test.ts`:

```ts
it('offers the claimed public page alongside the profile link', () => {
  const actions = profileShareActions('https://nimconnect.app/add?profile=x', 'https://nimconnect.app/@alice?tx=abc')
  expect(actions).toHaveLength(2)
  expect(actions[1]).toMatchObject({ kind: 'public', link: 'https://nimconnect.app/@alice?tx=abc', label: 'Share public page' })
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- src/services/profile-sharing.test.ts`

Expected: FAIL because the public-page action is not yet returned.

- [ ] **Step 3: Implement the smallest UI change**

In `ProfileView.vue`, extend `defineEmits` with `share`, remove the owner-only QR card, and render:

```vue
<button v-if="own" type="button" class="share-profile" @click="$emit('share')">
  <span aria-hidden="true">↗</span>
  Share profile
</button>
```

In `MyProfilePage.vue`, add `shareOpen`, import `ActionSheet`, `QrCode`, `makeProfileShareLink`, `profileShareActions`, `shareOrCopy`, and `canShare`. Pass `@share="shareOpen = true"` to `ProfileView`; render an action sheet with the existing QR payload and the conditional share/copy buttons. Keep `ClaimHandleSheet` and handle polling unchanged. Place a claimed `@handle` as a compact identity line and put the no-handle claim control in a compact secondary row.

- [ ] **Step 4: Verify focused tests and build**

Run: `npm test -- src/services/profile-sharing.test.ts && npm run build`

Expected: focused tests pass and `vue-tsc -b && vite build` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProfileView.vue src/pages/MyProfilePage.vue src/services/profile-sharing.test.ts
git commit -m "feat: consolidate profile sharing"
```

### Task 3: Verify the complete frontend surface

**Files:**

- Verify only: `src/components/ProfileView.vue`, `src/pages/MyProfilePage.vue`, `src/services/profile-sharing.ts`

- [ ] **Step 1: Run the full frontend suite**

Run: `npm test`

Expected: PASS with no failed tests.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: `vue-tsc -b && vite build` exits 0.

- [ ] **Step 3: Inspect final changes**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; feature files are the only new modifications and pre-existing dirty files remain untouched.

