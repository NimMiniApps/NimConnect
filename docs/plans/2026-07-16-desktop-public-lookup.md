# Desktop Public Profile Lookup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On the desktop NimConnect handoff, add a quiet `@handle` / address lookup that navigates to `/u/:handle` when a claimed handle exists, while keeping Open in Nimiq Pay as the primary CTA.

**Architecture:** Add a pure `parsePublicLookupQuery` helper next to existing handle helpers. Extend `OpenInNimiqPayLanding` so the desktop branch (`allowBrowserContinue === false`) shows a secondary lookup form that calls `resolveHandle` / `handleForAddress` and `router.push`s to the public profile page. Mobile handoff stays unchanged. No new backend endpoints or public routes.

**Tech Stack:** Vue 3 SFCs, TypeScript, Vitest, `@vue/test-utils`, existing `handles` service + `ValidationUtils`.

**Design:** `docs/plans/2026-07-16-desktop-public-lookup-design.md`

---

### Task 1: Parse lookup input (handle vs address)

**Files:**
- Modify: `src/services/handles.ts`
- Create: `src/services/handles-lookup.test.ts` (or add to an existing handles unit test file if one already covers pure helpers)

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { parsePublicLookupQuery } from './handles'

describe('parsePublicLookupQuery', () => {
  it('accepts bare and @-prefixed handles', () => {
    expect(parsePublicLookupQuery('ada')).toEqual({ kind: 'handle', handle: 'ada' })
    expect(parsePublicLookupQuery('@Ada')).toEqual({ kind: 'handle', handle: 'ada' })
  })

  it('accepts spaced Nimiq addresses', () => {
    const address = 'NQ26 8MMT 8317 VD0D NNKE 3NVA GBVE UY1E 9YDF'
    expect(parsePublicLookupQuery(address)).toEqual({
      kind: 'address',
      address: 'NQ268MMT8317VD0DNNKE3NVAGBVEUY1E9YDF', // use ValidationUtils.normalizeAddress result in the assertion
    })
  })

  it('rejects empty and garbage input', () => {
    expect(parsePublicLookupQuery('')).toEqual({ kind: 'invalid' })
    expect(parsePublicLookupQuery('nope!')).toEqual({ kind: 'invalid' })
    expect(parsePublicLookupQuery('ab')).toEqual({ kind: 'invalid' })
  })
})
```

For the address assertion, import `ValidationUtils` and compare against `ValidationUtils.normalizeAddress(address)` so the test does not hard-code normalize details incorrectly.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/services/handles-lookup.test.ts`

Expected: FAIL because `parsePublicLookupQuery` is not exported.

**Step 3: Implement the helper**

In `src/services/handles.ts`, add:

```ts
import { ValidationUtils } from '@nimiq/utils/validation-utils'

export type PublicLookupQuery =
  | { kind: 'handle'; handle: string }
  | { kind: 'address'; address: string }
  | { kind: 'invalid' }

/** Classify desktop public-lookup input before any network call. */
export function parsePublicLookupQuery(raw: string): PublicLookupQuery {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: 'invalid' }
  if (ValidationUtils.isValidAddress(trimmed)) {
    return { kind: 'address', address: ValidationUtils.normalizeAddress(trimmed) }
  }
  const handle = trimmed.replace(/^@/, '').toLowerCase()
  if (isValidHandle(handle)) return { kind: 'handle', handle }
  return { kind: 'invalid' }
}
```

Prefer address classification first (addresses contain spaces; handles do not).

**Step 4: Run test to verify it passes**

Run: `npm test -- src/services/handles-lookup.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/services/handles.ts src/services/handles-lookup.test.ts
git commit -m "feat: parse public profile lookup input"
```

---

### Task 2: Desktop landing shows lookup; mobile does not

**Files:**
- Modify: `src/components/PublicLandings.test.ts`
- Modify: `src/components/OpenInNimiqPayLanding.vue`

**Step 1: Extend the failing UI tests**

In `PublicLandings.test.ts`, update/add assertions on the existing desktop handoff case and add focused lookup presence tests:

```ts
it('shows public profile lookup only on the desktop handoff', async () => {
  const wrapper = mount(OpenInNimiqPayLanding)
  expect(wrapper.find('[data-public-lookup]').exists()).toBe(false)

  await wrapper.setProps({ allowBrowserContinue: false })
  expect(wrapper.find('[data-public-lookup]').exists()).toBe(true)
  expect(wrapper.text()).toContain('Look up a public profile')
  expect(wrapper.text()).toContain('look up public')
  expect(wrapper.get('[data-public-lookup] input').attributes('placeholder'))
    .toBe('@handle or Nimiq address')
})
```

Also update the desktop body-copy expectation in the first test so it still matches the new wording (payment/profile links **and** public `@handles` / lookup).

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: FAIL — no `[data-public-lookup]` and old desktop copy.

**Step 3: Add the desktop lookup UI (static first)**

In `OpenInNimiqPayLanding.vue`:

1. Update desktop `#panel` body copy to mention looking up public `@handles`.
2. Add a `#secondary` slot only when `allowBrowserContinue === false`:

```vue
<template #secondary v-if="allowBrowserContinue === false">
  <form class="handoff__lookup" data-public-lookup @submit.prevent>
    <label class="handoff__lookup-label" for="public-lookup-input">
      Look up a public profile
    </label>
    <input
      id="public-lookup-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder="@handle or Nimiq address"
    />
    <button type="submit">Look up</button>
  </form>
</template>
```

3. Style the form quietly under the primary CTA (full-width input, label above, not a second gold button). Scoped styles on `.handoff__lookup`; the submit button will inherit PublicSurface secondary button styles — that is acceptable for the Look up action.

Note: PublicSurface styles slotted `a`/`button` in secondary as blue CTAs. Keep a single submit button; do not wrap the whole form in extra card chrome.

**Step 4: Run tests**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: PASS for presence/copy tests (behavior tests come next).

**Step 5: Commit**

```bash
git add src/components/OpenInNimiqPayLanding.vue src/components/PublicLandings.test.ts
git commit -m "feat: show desktop public profile lookup field"
```

---

### Task 3: Wire lookup → navigate to `/u/:handle`

**Files:**
- Modify: `src/components/PublicLandings.test.ts`
- Modify: `src/components/OpenInNimiqPayLanding.vue`

**Step 1: Write failing behavior tests**

Add mocks at the top of `PublicLandings.test.ts` (follow `PublicProfilePage.test.ts` pattern):

```ts
const mocks = vi.hoisted(() => ({
  resolveHandle: vi.fn(),
  handleForAddress: vi.fn(),
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('../services/handles', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/handles')>()
  return {
    ...actual,
    resolveHandle: mocks.resolveHandle,
    handleForAddress: mocks.handleForAddress,
  }
})
```

Then:

```ts
it('navigates to /u/:handle after a successful handle lookup', async () => {
  mocks.resolveHandle.mockResolvedValue({
    handle: 'ada',
    address,
    tx_hash: 't',
    block_height: 1,
    tx_index: 0,
  })
  const wrapper = mount(OpenInNimiqPayLanding, {
    props: { allowBrowserContinue: false },
  })
  await wrapper.get('[data-public-lookup] input').setValue('@ada')
  await wrapper.get('[data-public-lookup]').trigger('submit')
  await flushPromises()
  expect(mocks.resolveHandle).toHaveBeenCalledWith('ada')
  expect(mocks.push).toHaveBeenCalledWith('/u/ada')
})

it('resolves addresses through by-address then navigates', async () => {
  mocks.handleForAddress.mockResolvedValue({
    handle: 'ada',
    address,
    tx_hash: 't',
    block_height: 1,
    tx_index: 0,
  })
  const wrapper = mount(OpenInNimiqPayLanding, {
    props: { allowBrowserContinue: false },
  })
  await wrapper.get('[data-public-lookup] input').setValue(address)
  await wrapper.get('[data-public-lookup]').trigger('submit')
  await flushPromises()
  expect(mocks.handleForAddress).toHaveBeenCalled()
  expect(mocks.push).toHaveBeenCalledWith('/u/ada')
})

it('shows an empty-state message when no public handle exists', async () => {
  mocks.resolveHandle.mockResolvedValue(null)
  const wrapper = mount(OpenInNimiqPayLanding, {
    props: { allowBrowserContinue: false },
  })
  await wrapper.get('[data-public-lookup] input').setValue('ghost')
  await wrapper.get('[data-public-lookup]').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('No public @handle found')
  expect(mocks.push).not.toHaveBeenCalled()
})

it('validates garbage input without calling the network', async () => {
  const wrapper = mount(OpenInNimiqPayLanding, {
    props: { allowBrowserContinue: false },
  })
  await wrapper.get('[data-public-lookup] input').setValue('nope!')
  await wrapper.get('[data-public-lookup]').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('Enter an @handle or Nimiq address')
  expect(mocks.resolveHandle).not.toHaveBeenCalled()
  expect(mocks.handleForAddress).not.toHaveBeenCalled()
})
```

Reset mocks in `beforeEach`.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: FAIL — form does not call services / navigate.

**Step 3: Implement lookup submit logic**

In `OpenInNimiqPayLanding.vue` `<script setup>`:

```ts
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  handleForAddress,
  parsePublicLookupQuery,
  resolveHandle,
} from '../services/handles'

const router = useRouter()
const lookupQuery = ref('')
const lookupError = ref<string | null>(null)
const lookupPending = ref(false)

async function submitLookup() {
  lookupError.value = null
  const parsed = parsePublicLookupQuery(lookupQuery.value)
  if (parsed.kind === 'invalid') {
    lookupError.value = 'Enter an @handle or Nimiq address'
    return
  }
  lookupPending.value = true
  try {
    const claim = parsed.kind === 'handle'
      ? await resolveHandle(parsed.handle)
      : await handleForAddress(parsed.address)
    if (!claim) {
      lookupError.value = 'No public @handle found'
      return
    }
    await router.push(`/u/${claim.handle}`)
  } catch {
    lookupError.value = 'Lookup failed — try again'
  } finally {
    lookupPending.value = false
  }
}
```

Bind the form:

- `v-model="lookupQuery"` on the input
- `:disabled="lookupPending"` on input + button
- `@submit.prevent="submitLookup"`
- Show `lookupError` in a `<p role="status">` inside the form when set

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: PASS

Also run: `npm test -- src/services/handles-lookup.test.ts src/pages/PublicProfilePage.test.ts`

Expected: PASS (no regressions on public profile / helper).

**Step 5: Commit**

```bash
git add src/components/OpenInNimiqPayLanding.vue src/components/PublicLandings.test.ts
git commit -m "feat: resolve desktop public profile lookups"
```

---

### Task 4: Full verification

**Step 1: Run the focused suites**

```bash
npm test -- src/services/handles-lookup.test.ts src/components/PublicLandings.test.ts src/pages/PublicProfilePage.test.ts
```

Expected: PASS

**Step 2: Run the full test suite**

```bash
npm test
```

Expected: PASS

**Step 3: Manual smoke (optional but recommended)**

1. Open the app root on a desktop-width browser / with desktop UA so `isDesktopBrowser()` is true.
2. Confirm body mentions lookup; primary is still Open in Nimiq Pay.
3. Paste a known claimed `@handle` → lands on `/u/:handle`.
4. Paste that handle’s address → same navigation.
5. Paste unknown handle → “No public @handle found”.
6. Narrow / mobile-like pointer: lookup should not appear on the phone handoff.

**Step 4: Final commit only if verification left uncommitted polish**

If styles/copy needed a small fix during smoke, commit that separately:

```bash
git commit -m "fix: polish desktop public lookup copy"
```

Otherwise stop after green tests.

---

## Done when

- Desktop handoff has lookup; mobile does not
- `@handle` and address both reach `/u/:handle` when a claim exists
- Invalid / not-found / network error messages match the design
- No new routes or APIs
- Tests green
