# Unified Public Surface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give public profiles, shared-profile links, payment requests, and the Nimiq Pay handoff one coherent NimConnect public interface without changing their data or link behaviour.

**Architecture:** Introduce a slot-based `PublicSurface` shell that owns the common masthead, public canvas, panel, action stack, and trust footer. Existing route/landing components keep their state, parsing, clipboard, and link-generation logic, but supply their variant-specific identity, panel, and actions to the shell. Add a small `PublicAddressCopy` primitive so the existing copy interaction is consistent and tested once.

**Tech Stack:** Vue 3 SFCs, TypeScript, scoped CSS, Vite, Vitest, `@vue/test-utils`, happy-dom.

---

### Task 1: Add a browser-like component-test harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Create: `src/components/PublicSurface.test.ts`

**Step 1: Write the failing shell test**

Create `src/components/PublicSurface.test.ts` using `@vue/test-utils` and assert the public contract:

```ts
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PublicSurface from './PublicSurface.vue'

describe('PublicSurface', () => {
  it('keeps public context, content, actions, and trust copy in one shell', () => {
    const wrapper = mount(PublicSurface, {
      props: { context: 'Public profile', footerVerb: 'Shared' },
      slots: {
        identity: '<h1>Alice</h1>',
        panel: '<p>Send NIM</p>',
        primary: '<a href="/pay">Pay</a>',
        secondary: '<a href="/add">Add</a>',
      },
    })

    expect(wrapper.get('[data-public-context]').text()).toBe('Public profile')
    expect(wrapper.get('[data-public-identity]').text()).toContain('Alice')
    expect(wrapper.get('[data-public-panel]').text()).toContain('Send NIM')
    expect(wrapper.get('[data-public-primary]').text()).toBe('Pay')
    expect(wrapper.get('[data-public-secondary]').text()).toBe('Add')
    expect(wrapper.get('footer').text()).toContain('Shared via NimConnect')
  })
})
```

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/PublicSurface.test.ts`

Expected: FAIL because the component and Vue test harness do not exist.

**Step 3: Add the smallest test dependencies and configuration**

Install development dependencies:

```bash
npm install -D @vue/test-utils happy-dom
```

Change `vite.config.ts` test configuration to `environment: 'happy-dom'`, retaining `fake-indexeddb/auto` as `setupFiles`. Do not change application build configuration.

**Step 4: Run the test again**

Run: `npm test -- src/components/PublicSurface.test.ts`

Expected: FAIL only because `PublicSurface.vue` is missing.

**Step 5: Commit the harness**

```bash
git add package.json package-lock.json vite.config.ts src/components/PublicSurface.test.ts
git commit -m "test: add public surface component harness"
```

### Task 2: Build and verify the shared public shell

**Files:**
- Create: `src/components/PublicSurface.vue`
- Modify: `src/assets/main.css`
- Test: `src/components/PublicSurface.test.ts`

**Step 1: Keep the public shell test failing for the correct reason**

Run: `npm test -- src/components/PublicSurface.test.ts`

Expected: FAIL because the imported SFC does not exist.

**Step 2: Implement the minimal shell**

Create `PublicSurface.vue` with this public API and semantic regions:

```vue
<script setup lang="ts">
withDefaults(defineProps<{
  context: 'Public profile' | 'Shared profile' | 'Payment request' | 'NimConnect'
  footerVerb?: 'Shared' | 'Sent'
}>(), { footerVerb: 'Shared' })
</script>

<template>
  <main class="public-surface">
    <header class="public-masthead">
      <span class="public-wordmark">NimConnect</span>
      <span data-public-context class="public-context">{{ context }}</span>
    </header>
    <section data-public-identity class="public-identity"><slot name="identity" /></section>
    <section data-public-panel class="public-panel"><slot name="panel" /></section>
    <section v-if="$slots.primary || $slots.secondary" class="public-actions">
      <div v-if="$slots.primary" data-public-primary class="public-primary"><slot name="primary" /></div>
      <div v-if="$slots.secondary" data-public-secondary class="public-secondary"><slot name="secondary" /></div>
    </section>
    <footer class="public-footer"><slot name="footer">{{ footerVerb }} via <strong>NimConnect</strong></slot></footer>
  </main>
</template>
```

Add the complete public-only visual tokens and styles in the SFC (rather than altering authenticated `.card` styles): ink-blue canvas, soft panel, gold primary, blue secondary, neutral outline, visible `:focus-visible`, safe-area padding, mobile-first max width, and `prefers-reduced-motion` handling. Add only reusable color tokens to `main.css` if the SFC needs them.

**Step 3: Run the focused test to verify it passes**

Run: `npm test -- src/components/PublicSurface.test.ts`

Expected: PASS.

**Step 4: Commit the shell**

```bash
git add src/components/PublicSurface.vue src/components/PublicSurface.test.ts src/assets/main.css
git commit -m "feat: add unified public surface shell"
```

### Task 3: Extract address copy as a shared public primitive

**Files:**
- Create: `src/components/PublicAddressCopy.vue`
- Create: `src/components/PublicAddressCopy.test.ts`
- Test: `src/components/PublicAddressCopy.test.ts`

**Step 1: Write the failing copy-interaction test**

Use `vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })`, mount the component with a Nimiq address, click its button, and assert both `writeText(address)` and the visible `Copied ✓` state.

**Step 2: Run it to verify the expected failure**

Run: `npm test -- src/components/PublicAddressCopy.test.ts`

Expected: FAIL because the component does not exist.

**Step 3: Implement the minimal primitive**

Create a component with `address` and optional `compact` props. Render a single semantic button with full selectable address text, a `Copy address`/`Copied ✓` label, safe wrapping, and a two-second local feedback timeout. Swallow clipboard errors and leave the selectable address visible, matching existing fallback behaviour.

**Step 4: Run the focused test to verify it passes**

Run: `npm test -- src/components/PublicAddressCopy.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/PublicAddressCopy.vue src/components/PublicAddressCopy.test.ts
git commit -m "feat: share public address copy control"
```

### Task 4: Migrate shared profiles and payment requests to the system

**Files:**
- Modify: `src/components/PublicProfileLanding.vue`
- Modify: `src/components/PublicPayLanding.vue`
- Create: `src/components/PublicLandings.test.ts`
- Test: `src/components/PublicLandings.test.ts`

**Step 1: Write failing variant tests**

Mount each landing with a valid representative prop and stub `QrCode`/`Identicon`. Assert that both render `PublicSurface`; assert the shared profile has `Shared profile`, identity name, `Add to NimConnect`, and no verification row; assert the payment request has `Payment request`, amount, message, and both wallet actions.

**Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: FAIL because the old components do not use the public shell.

**Step 3: Make the minimal migration**

Replace each duplicated `.landing`, `.who`, card, action, and footer style block with `PublicSurface` slots. Keep `makeRequestLink`, deep-link generation, app-store URLs, `allowBrowserContinue`, and the `continue` event exactly as they are. Use `PublicAddressCopy` in place of each private `copied` ref and `copyAddress()` function.

Use the same vocabulary across both variants:

- public profile: primary `Pay with Nimiq Pay`; secondary `Pay with Nimiq Wallet` and `Add to NimConnect`
- payment request: primary `Pay with Nimiq Pay`; secondary `Pay with Nimiq Wallet`
- store choices are a grouped tertiary section, never equal to the primary action

**Step 4: Run focused tests**

Run: `npm test -- src/components/PublicLandings.test.ts src/components/PublicAddressCopy.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/PublicProfileLanding.vue src/components/PublicPayLanding.vue src/components/PublicLandings.test.ts
git commit -m "feat: unify shared profile and payment pages"
```

### Task 5: Migrate the public @handle profile and its states

**Files:**
- Modify: `src/pages/PublicProfilePage.vue`
- Create: `src/pages/PublicProfilePage.test.ts`
- Test: `src/pages/PublicProfilePage.test.ts`

**Step 1: Write failing state and content tests**

Mock `resolveHandleEnriched`, `fetchPublicProfile`, and the router route. Test a resolved profile exposes the public-shell context, name, `@handle`, the chain verification link, and `Send in Nimiq Pay`. Test an unresolved handle exposes the same shell and the existing `Claim it in NimConnect` path. Stub `QrCode` and `Identicon`.

**Step 2: Run the tests to verify they fail**

Run: `npm test -- src/pages/PublicProfilePage.test.ts`

Expected: FAIL because the page does not render the public shell.

**Step 3: Implement the page migration**

Render every state inside `PublicSurface` with `context="Public profile"`. Keep the existing resolver, retry timer, query-transaction handling, and links unchanged. For ready profiles, supply the full identity slot (identicon, name, handle, bio, links, tags); supply QR, `PublicAddressCopy`, and chain-verification as the panel; supply Nimiq Pay as primary and `Add to NimConnect` as secondary. For loading/not-found/error, use the panel slot with the current precise copy and retain `Refresh` as the only action.

Remove the local page/card/button CSS that duplicates the shared visual system. Do not add a generic loading skeleton or change any state copy beyond fitting it into the shell.

**Step 4: Run focused tests**

Run: `npm test -- src/pages/PublicProfilePage.test.ts src/components/PublicSurface.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/pages/PublicProfilePage.vue src/pages/PublicProfilePage.test.ts
git commit -m "feat: align public handle profiles with shared surface"
```

### Task 6: Align the generic Nimiq Pay handoff and verify the release

**Files:**
- Modify: `src/components/OpenInNimiqPayLanding.vue`
- Modify: `src/components/PublicLandings.test.ts`
- Modify: `docs/plans/2026-07-15-public-surface-system-design.md`

**Step 1: Write the failing handoff assertion**

Extend `PublicLandings.test.ts` to mount `OpenInNimiqPayLanding` and assert it renders `NimConnect` context, preserves the open-in-Nimiq-Pay CTA, and preserves the optional browser-continue event.

**Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: FAIL because the generic landing still owns a separate layout.

**Step 3: Implement the minimal handoff migration**

Use `PublicSurface` for the masthead, explanation panel, primary Nimiq Pay action, store group, and optional browser continuation. Keep current desktop/mobile wording and target URLs unchanged. Update the design document only if implementation changes an approved detail.

**Step 4: Run all relevant verification**

Run:

```bash
npm test -- src/components/PublicSurface.test.ts src/components/PublicAddressCopy.test.ts src/components/PublicLandings.test.ts src/pages/PublicProfilePage.test.ts
npm test
npm run build
git diff --check
```

Expected: all test commands and the production build exit 0; `git diff --check` has no output.

**Step 5: Manual responsive check**

Run: `npm run dev -- --host 0.0.0.0`

Check `/u/<known-handle>`, `#/add?p=<valid-payload>`, `#/pay?r=<valid-nimiq-request>`, and the generic root page at 360 px and 560 px widths. Confirm that only one primary action is visually dominant, addresses wrap, focus is visible, QR remains scannable, and reduced motion does not animate the interface.

**Step 6: Commit**

```bash
git add src/components/OpenInNimiqPayLanding.vue src/components/PublicLandings.test.ts docs/plans/2026-07-15-public-surface-system-design.md
git commit -m "feat: complete unified NimConnect public surface"
```
