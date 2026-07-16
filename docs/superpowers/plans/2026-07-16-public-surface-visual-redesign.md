# Public Surface Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the four public-facing pages (`@handle` profile, payment request, shared contact, add-to-NimConnect landing) to use the app's real design tokens (gradients, dark mode, shared button behavior) instead of a parallel hardcoded light-only palette, with larger/responsive QR codes and a hero polish pass on the profile page.

**Architecture:** All four pages share one shell component, `PublicSurface.vue`, with a fixed slot API (`identity`, `panel`, `primary`, `secondary`, `tertiary`, `footer`). This is a CSS-only restyle of that shell plus size-prop bumps in its four consumers — no slot, prop, or `<script>` changes anywhere except one new wrapper `<div>` in `PublicProfilePage.vue` for the avatar glow.

**Tech Stack:** Vue 3 `<script setup>`, scoped CSS, existing `--nimiq-*` / `--nq-*` / `--text` / `--card` / `--bg` design tokens from `src/assets/main.css` (already globally imported via `src/main.ts`). Vitest + `@vue/test-utils` for tests.

## Global Constraints

- No new props, slots, or data on any component (spec: Non-goals).
- No behavior change to any button, link, or action (spec: Non-goals).
- No changes to any `<script>` block, `ClaimHandleSheet`, or any service/store (spec: Non-goals).
- No new hardcoded colors — every value must resolve to an existing token in `src/assets/main.css` (spec: Changes §1, Accessibility).
- Public surface now supports real dark mode via `main.css`'s existing `prefers-color-scheme: dark` block — this reverses the prior light-only-guard test in `PublicSurface.test.ts` (spec: "Explicit reversal of prior decision").
- Decorative glow layers must be `pointer-events: none`, stacked strictly behind content, and **static** — no animation/transition on the glow itself (spec: Changes §3).
- QR codes target 260px but must scale down proportionally on narrow viewports (verified conceptually down to ~320px) without overflow, preserving 1:1 aspect ratio (spec: Changes §2).
- All buttons/links keep visible `:focus-visible` outlines in both themes; gradient button text must keep WCAG AA contrast using the app's existing white-on-gradient combination (spec: Accessibility).
- Do not touch `docs/superpowers/specs/2026-07-14-public-profiles-and-pay-links-design.md` scope (reputation, themes, activity feed, multi-asset, quick-action buttons) — out of scope entirely (spec: Non-goals).

---

## Task 1: Responsive QR codes (`QrCode.vue`)

**Files:**
- Modify: `src/components/QrCode.vue`
- Test: `src/components/QrCode.test.ts` (new)

**Interfaces:**
- Consumes: nothing new — `QrCode` already takes `text: string` and `size?: number` (default 240).
- Produces: the `.qr` CSS class now scales down responsively; later tasks bump the `size` prop passed by consumers to 260 and rely on this class to prevent overflow.

- [ ] **Step 1: Write the failing test**

Create `src/components/QrCode.test.ts`:

```typescript
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QrCode from './QrCode.vue'
import qrCodeSource from './QrCode.vue?raw'

describe('QrCode', () => {
  it('renders with the requested intrinsic size', async () => {
    const wrapper = mount(QrCode, { props: { text: 'nimiq:NQ00', size: 260 } })
    await wrapper.vm.$nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    const img = wrapper.find('img.qr')
    expect(img.exists()).toBe(true)
    expect(img.attributes('width')).toBe('260')
    expect(img.attributes('height')).toBe('260')
  })

  it('scales down responsively instead of overflowing narrow containers', () => {
    expect(qrCodeSource).toMatch(/\.qr\s*\{[\s\S]*?max-width:\s*100%;/)
    expect(qrCodeSource).toMatch(/\.qr\s*\{[\s\S]*?height:\s*auto;/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- QrCode.test.ts`
Expected: FAIL — the second test fails because `.qr` has no `max-width`/`height: auto` yet.

- [ ] **Step 3: Add responsive sizing to the `.qr` class**

In `src/components/QrCode.vue`, change:

```css
.qr { border-radius: 12px; background: #fff; padding: 8px; display: block; margin: 0 auto; }
```

to:

```css
.qr { border-radius: 12px; background: #fff; padding: 8px; display: block; margin: 0 auto; max-width: 100%; height: auto; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- QrCode.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/QrCode.vue src/components/QrCode.test.ts
git commit -m "fix: make QR codes scale down responsively on narrow viewports"
```

---

## Task 2: `PublicSurface.vue` token, gradient, dark-mode, and button restyle

**Files:**
- Modify: `src/components/PublicSurface.vue`
- Modify: `src/components/PublicSurface.test.ts`

**Interfaces:**
- Consumes: `--nimiq-blue`, `--nimiq-gold-bg`, `--nimiq-gold-bg-darkened`, `--nimiq-light-blue-bg`, `--nimiq-light-blue-darkened`, `--nimiq-white`, `--nq-gold`, `--nimiq-radius-pill`, `--attr-duration`, `--nimiq-ease`, `--text`, `--text-2`, `--border`, `--card`, `--bg`, `--shadow` — all already defined globally in `src/assets/main.css` (light values at `:root`, dark overrides in its `prefers-color-scheme: dark` block).
- Produces: no change to the slot API (`identity`, `panel`, `primary`, `secondary`, `tertiary`, `footer`) or component props (`context`, `footerVerb`, `actionsEnabled`) — later tasks and all four consumers are unaffected at the template level.

- [ ] **Step 1: Write the failing test — replace the light-only guard**

In `src/components/PublicSurface.test.ts`, replace the existing test:

```typescript
  it('keeps public semantic tokens readable on its light canvas when the system prefers dark mode', () => {
    expect(publicSurfaceSource).toMatch(/\.public-surface\s*\{[\s\S]*?--text:\s*#1f2348;/)
    expect(publicSurfaceSource).toMatch(/\.public-surface\s*\{[\s\S]*?--text-2:\s*#59627d;/)
    expect(publicSurfaceSource).toMatch(/\.public-surface\s*\{[\s\S]*?--border:\s*#dce7ff;/)
  })
```

with:

```typescript
  it('no longer forces a light-only palette, so the app-wide dark-mode tokens apply', () => {
    expect(publicSurfaceSource).not.toMatch(/--text:\s*#1f2348;/)
    expect(publicSurfaceSource).not.toMatch(/--text-2:\s*#59627d;/)
    expect(publicSurfaceSource).not.toMatch(/--border:\s*#dce7ff;/)
    expect(publicSurfaceSource).not.toMatch(/--public-ink:/)
    expect(publicSurfaceSource).not.toMatch(/--public-blue:/)
    expect(publicSurfaceSource).not.toMatch(/--public-gold:/)
    expect(publicSurfaceSource).not.toMatch(/--public-soft-blue:/)
  })

  it('uses the shared gradient tokens for its action buttons instead of flat colors', () => {
    expect(publicSurfaceSource).toMatch(/__primary :slotted\(a\),[\s\S]*?background:\s*var\(--nimiq-gold-bg\);/)
    expect(publicSurfaceSource).toMatch(/__secondary :slotted\(a\),[\s\S]*?background:\s*var\(--nimiq-light-blue-bg\);/)
  })

  it('keeps a visible focus-visible outline sourced from a real design token', () => {
    expect(publicSurfaceSource).toMatch(/:focus-visible\)[\s\S]*?outline:\s*3px solid var\(--nq-gold\);/)
  })

  it('gives its decorative canvas glow pointer-events: none and no transition or animation', () => {
    const canvasGlowBlock = publicSurfaceSource.match(/\.public-surface__canvas::before\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(canvasGlowBlock).toMatch(/pointer-events:\s*none;/)
    expect(canvasGlowBlock).not.toMatch(/transition|animation/)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- PublicSurface.test.ts`
Expected: FAIL on all four new/changed tests (old hardcoded values still present, no gradient buttons, `--public-gold` still used for outline, no canvas glow yet).

- [ ] **Step 3: Rewrite the `<style scoped>` block in `PublicSurface.vue`**

Replace the entire `<style scoped>` block with:

```css
<style scoped>
.public-surface {
  align-items: stretch;
  background: var(--nimiq-blue);
  color: var(--text);
  display: flex;
  justify-content: center;
  min-height: 100dvh;
  padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1.5rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}

.public-surface__canvas {
  animation: public-surface-enter 180ms ease-out both;
  background: linear-gradient(160deg, var(--card) 0%, var(--bg) 100%);
  border-radius: 1.5rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  isolation: isolate;
  max-width: 42rem;
  min-height: calc(100dvh - 2.5rem);
  overflow: hidden;
  padding: clamp(1.25rem, 4vw, 2.5rem);
  position: relative;
  width: 100%;
}

.public-surface__canvas::before {
  background: var(--nimiq-blue-bg);
  content: '';
  inset: -20%;
  opacity: 0.12;
  pointer-events: none;
  position: absolute;
  z-index: 0;
}

.public-surface__masthead,
.public-surface__identity,
.public-surface__panel,
.public-surface__actions,
.public-surface__footer {
  position: relative;
  z-index: 1;
}

.public-surface__masthead,
.public-surface__footer {
  align-items: center;
  color: var(--text-2);
  display: flex;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  justify-content: space-between;
}

.public-surface__brand {
  color: var(--text);
  font-size: 1rem;
}

.public-surface__identity {
  display: grid;
  gap: 0.625rem;
  justify-items: center;
  text-align: center;
}

.public-surface__panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 1.25rem;
  box-shadow: var(--shadow);
  display: grid;
  gap: 0.75rem;
  justify-items: center;
  padding: clamp(1rem, 3vw, 1.5rem);
  text-align: center;
}

.public-surface__panel :slotted(p) { margin: 0; }
.public-surface__panel :slotted(span) { color: var(--text-2); font-size: 0.8125rem; }

.public-surface__actions {
  display: grid;
  gap: 0.75rem;
}

.public-surface__primary,
.public-surface__secondary,
.public-surface__tertiary {
  display: grid;
  gap: 0.5rem;
}

.public-surface__primary:empty,
.public-surface__secondary:empty,
.public-surface__tertiary:empty { display: none; }

.public-surface__primary :slotted(a),
.public-surface__primary :slotted(button),
.public-surface__secondary :slotted(a),
.public-surface__secondary :slotted(button) {
  align-items: center;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  box-sizing: border-box;
  color: var(--nimiq-white);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 800;
  justify-content: center;
  min-height: 3rem;
  padding: 0.75rem 1.5rem;
  text-decoration: none;
  transition:
    background var(--attr-duration) var(--nimiq-ease),
    transform var(--attr-duration) var(--nimiq-ease),
    opacity var(--attr-duration) var(--nimiq-ease);
}

.public-surface__primary :slotted(a):active,
.public-surface__primary :slotted(button):active,
.public-surface__secondary :slotted(a):active,
.public-surface__secondary :slotted(button):active {
  transform: scale(0.98);
}

.public-surface__primary :slotted(a):is([aria-disabled='true'], :disabled),
.public-surface__primary :slotted(button):is([aria-disabled='true'], :disabled),
.public-surface__secondary :slotted(a):is([aria-disabled='true'], :disabled),
.public-surface__secondary :slotted(button):is([aria-disabled='true'], :disabled) {
  cursor: default;
  opacity: 0.5;
}

.public-surface__primary :slotted(a),
.public-surface__primary :slotted(button) {
  background: var(--nimiq-gold-bg);
}

.public-surface__primary :slotted(a):hover,
.public-surface__primary :slotted(button):hover {
  background: var(--nimiq-gold-bg-darkened);
}

.public-surface__secondary :slotted(a),
.public-surface__secondary :slotted(button) {
  background: var(--nimiq-light-blue-bg);
}

.public-surface__secondary :slotted(a):hover,
.public-surface__secondary :slotted(button):hover {
  background: var(--nimiq-light-blue-darkened);
}

.public-surface__secondary :slotted(.public-action--outline),
.public-surface__secondary :slotted([data-public-action='outline']) {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
}

.public-surface__secondary :slotted(.public-action--outline):hover,
.public-surface__secondary :slotted([data-public-action='outline']):hover {
  background: var(--border);
}

.public-surface__tertiary {
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}

.public-surface__footer {
  color: var(--text-2);
  display: grid;
  gap: 0.25rem;
  justify-items: center;
  text-align: center;
}

.public-surface__footer :slotted(p) { font-size: 0.8125rem; margin: 0; }

.public-surface__footer :slotted(button) {
  background: none;
  border: 0;
  color: var(--nimiq-light-blue);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  min-height: 2.75rem;
  padding: 0.5rem;
  text-decoration: underline;
  text-underline-offset: 0.1875rem;
}

.public-surface__footer {
  justify-content: center;
  margin-top: auto;
  padding-top: 0.75rem;
}

.public-surface :deep(a:focus-visible),
.public-surface :deep(button:focus-visible),
.public-surface :deep(input:focus-visible),
.public-surface :deep(textarea:focus-visible),
.public-surface :deep(select:focus-visible) {
  outline: 3px solid var(--nq-gold);
  outline-offset: 3px;
}

@keyframes public-surface-enter {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .public-surface__canvas {
    animation: none;
  }
}

@media (min-width: 48rem) {
  .public-surface {
    padding-bottom: max(2rem, env(safe-area-inset-bottom));
    padding-top: max(2rem, env(safe-area-inset-top));
  }

  .public-surface__canvas {
    min-height: min(48rem, calc(100dvh - 4rem));
  }
}
</style>
```

Note: `--nimiq-light-blue-darkened` and `--nimiq-gold-bg-darkened` are both existing tokens in `src/assets/main.css` (no new hardcoded colors introduced). `--nimiq-light-blue-bg` has no matching `-darkened` gradient token, so its hover state uses the existing solid `--nimiq-light-blue-darkened` token instead of inventing one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- PublicSurface.test.ts`
Expected: PASS (all tests, including the two pre-existing ones for slot rendering and the 44px footer button target — neither slot markup nor `.public-surface__footer :slotted(button)`'s `min-height` changed)

- [ ] **Step 5: Commit**

```bash
git add src/components/PublicSurface.vue src/components/PublicSurface.test.ts
git commit -m "feat: restyle public surface shell with real design tokens and dark mode"
```

---

## Task 3: `PublicProfilePage.vue` — sizing, verified badge, avatar glow

**Files:**
- Modify: `src/pages/PublicProfilePage.vue`
- Modify: `src/pages/PublicProfilePage.test.ts`

**Interfaces:**
- Consumes: `PublicSurface`'s unchanged slot API (Task 2); `Identicon` unchanged `size` prop; `QrCode` unchanged `size` prop, now responsive per Task 1.
- Produces: nothing new consumed elsewhere — this page is a leaf route component.

- [ ] **Step 1: Write the failing tests**

In `src/pages/PublicProfilePage.test.ts`, add near the top (after existing imports):

```typescript
import publicProfilePageSource from './PublicProfilePage.vue?raw'
```

Add a new `describe` block at the end of the file, before the final closing (or as a sibling top-level block):

```typescript
describe('PublicProfilePage visual sizing and hero polish', () => {
  it('uses the larger 96px avatar and 260px QR code sizes', () => {
    expect(publicProfilePageSource).toMatch(/<Identicon :address="payAddress" :size="96"/)
    expect(publicProfilePageSource).toMatch(/<QrCode :text="payUri" :size="260"/)
  })

  it('wraps the avatar in a glow container that never blocks interaction', () => {
    expect(publicProfilePageSource).toMatch(/class="identity__avatar"/)
    const glowBlock = publicProfilePageSource.match(/\.identity__avatar::before\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(glowBlock).toMatch(/pointer-events:\s*none;/)
    expect(glowBlock).not.toMatch(/transition|animation/)
  })

  it('styles the verified badge as a pill using an existing color token', () => {
    const verifiedBlock = publicProfilePageSource.match(/\.verified\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(verifiedBlock).toMatch(/border-radius:\s*var\(--nimiq-radius-pill\);/)
    expect(verifiedBlock).toMatch(/--nimiq-green/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- PublicProfilePage.test.ts`
Expected: FAIL on all three new tests (sizes still 80/200, no `.identity__avatar` wrapper, `.verified` still a plain underlined link).

- [ ] **Step 3: Update the template**

In `src/pages/PublicProfilePage.vue`, change the identity header:

```html
      <header class="identity">
        <Identicon :address="payAddress" :size="80" />
        <h1 class="identity__title">{{ headline }}</h1>
```

to:

```html
      <header class="identity">
        <div class="identity__avatar">
          <Identicon :address="payAddress" :size="96" />
        </div>
        <h1 class="identity__title">{{ headline }}</h1>
```

Change the QR size:

```html
        <QrCode :text="payUri" :size="200" />
```

to:

```html
        <QrCode :text="payUri" :size="260" />
```

- [ ] **Step 4: Update the styles**

In the `<style scoped>` block of `src/pages/PublicProfilePage.vue`, change:

```css
.identity { display: grid; gap: 0.5rem; justify-items: center; }
.identity__title, .status__title { color: var(--text); font-size: 1.625rem; margin: 0; }
.identity__bio, .status, .status__lead { color: var(--text-2); line-height: 1.5; margin: 0; max-width: 23.75rem; }
.identity__links, .identity__tags { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; list-style: none; margin: 0; padding: 0; }
.identity__links a, .identity__tags li { border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill); color: var(--text-2); font-size: 0.8125rem; font-weight: 700; padding: 0.375rem 0.625rem; text-decoration: none; }
.status__link { color: var(--nq-light-blue); font-size: 0.875rem; font-weight: 700; text-decoration: none; }
.scan-hint { color: var(--text-2); font-size: 0.8125rem; }
.verified { color: var(--nq-green); font-size: 0.75rem; font-weight: 700; text-decoration: none; }
```

to:

```css
.identity { display: grid; gap: 0.5rem; justify-items: center; }
.identity__avatar { display: grid; place-items: center; position: relative; }
.identity__avatar::before {
  background: var(--nimiq-gold-bg);
  border-radius: 50%;
  content: '';
  filter: blur(1.5rem);
  height: 7rem;
  inset: 50% auto auto 50%;
  opacity: 0.35;
  pointer-events: none;
  position: absolute;
  transform: translate(-50%, -50%);
  width: 7rem;
  z-index: -1;
}
.identity__title, .status__title { color: var(--text); font-size: 1.875rem; margin: 0; }
.identity__bio, .status, .status__lead { color: var(--text-2); line-height: 1.5; margin: 0; max-width: 23.75rem; }
.identity__links, .identity__tags { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; list-style: none; margin: 0; padding: 0; }
.identity__links a, .identity__tags li { border: 1px solid var(--border); border-radius: var(--nimiq-radius-pill); color: var(--text-2); font-size: 0.8125rem; font-weight: 700; padding: 0.375rem 0.625rem; text-decoration: none; }
.status__link { color: var(--nq-light-blue); font-size: 0.875rem; font-weight: 700; text-decoration: none; }
.scan-hint { color: var(--text-2); font-size: 0.8125rem; }
.verified {
  align-items: center;
  background: color-mix(in srgb, var(--nimiq-green) 16%, transparent);
  border-radius: var(--nimiq-radius-pill);
  color: var(--nimiq-green);
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem;
  text-decoration: none;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- PublicProfilePage.test.ts`
Expected: PASS (all tests, including the three pre-existing ones — they assert text content and href attributes, not sizes or classes that changed)

- [ ] **Step 6: Commit**

```bash
git add src/pages/PublicProfilePage.vue src/pages/PublicProfilePage.test.ts
git commit -m "feat: hero polish on public profile page — larger avatar/QR, verified badge, avatar glow"
```

---

## Task 4: Sizing bump on the remaining three public consumers

**Files:**
- Modify: `src/components/PublicPayLanding.vue`
- Modify: `src/components/PublicProfileLanding.vue`
- Modify: `src/components/OpenInNimiqPayLanding.vue`
- Test: `src/components/PublicPayLanding.test.ts` (new)
- Test: `src/components/PublicProfileLanding.test.ts` (new)
- Test: `src/components/OpenInNimiqPayLanding.test.ts` (new)

**Interfaces:**
- Consumes: `PublicSurface`'s unchanged slot API (Task 2); `Identicon`/`QrCode` unchanged prop contracts.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Create `src/components/PublicPayLanding.test.ts`:

```typescript
import publicPayLandingSource from './PublicPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicPayLanding sizing', () => {
  it('uses the larger 96px avatar and 260px QR code sizes', () => {
    expect(publicPayLandingSource).toMatch(/<Identicon :address="payment.recipient" :size="96"/)
    expect(publicPayLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="260"/)
  })
})
```

Create `src/components/PublicProfileLanding.test.ts`:

```typescript
import publicProfileLandingSource from './PublicProfileLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicProfileLanding sizing', () => {
  it('uses the larger 96px avatar and 260px QR code sizes', () => {
    expect(publicProfileLandingSource).toMatch(/<Identicon :address="profile.address" :size="96"/)
    expect(publicProfileLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="260"/)
  })
})
```

Create `src/components/OpenInNimiqPayLanding.test.ts`:

```typescript
import openInNimiqPayLandingSource from './OpenInNimiqPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('OpenInNimiqPayLanding sizing', () => {
  it('uses the larger 96px logo size', () => {
    expect(openInNimiqPayLandingSource).toMatch(/<img class="handoff__logo" :src="iconUrl" alt="" width="96" height="96" \/>/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- PublicPayLanding.test.ts PublicProfileLanding.test.ts OpenInNimiqPayLanding.test.ts`
Expected: FAIL on all three (current sizes are 64/220, 80/220, and 80 respectively).

- [ ] **Step 3: Bump sizes in `PublicPayLanding.vue`**

Change:

```html
      <Identicon :address="payment.recipient" :size="64" />
```

to:

```html
      <Identicon :address="payment.recipient" :size="96" />
```

Change:

```html
      <QrCode :text="nimiqUri" :size="220" />
```

to:

```html
      <QrCode :text="nimiqUri" :size="260" />
```

- [ ] **Step 4: Bump sizes in `PublicProfileLanding.vue`**

Change:

```html
      <Identicon :address="profile.address" :size="80" />
```

to:

```html
      <Identicon :address="profile.address" :size="96" />
```

Change:

```html
      <QrCode :text="nimiqUri" :size="220" />
```

to:

```html
      <QrCode :text="nimiqUri" :size="260" />
```

- [ ] **Step 5: Bump size in `OpenInNimiqPayLanding.vue`**

Change:

```html
      <img class="handoff__logo" :src="iconUrl" alt="" width="80" height="80" />
```

to:

```html
      <img class="handoff__logo" :src="iconUrl" alt="" width="96" height="96" />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- PublicPayLanding.test.ts PublicProfileLanding.test.ts OpenInNimiqPayLanding.test.ts`
Expected: PASS (all three)

- [ ] **Step 7: Run the full test suite**

Run: `npm run test`
Expected: PASS — no other test references the old 64/80/220 size literals in these three files (confirmed via the grep already used to locate every `Identicon`/`QrCode` size prop across the four public consumers during planning).

- [ ] **Step 8: Commit**

```bash
git add src/components/PublicPayLanding.vue src/components/PublicProfileLanding.vue src/components/OpenInNimiqPayLanding.vue src/components/PublicPayLanding.test.ts src/components/PublicProfileLanding.test.ts src/components/OpenInNimiqPayLanding.test.ts
git commit -m "feat: bump avatar/logo/QR sizes on the remaining public pages"
```

---

## Task 5: Manual visual review (screenshots)

**Files:** none — this task produces no code changes, only verification.

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Vite dev server starts on `http://localhost:5173`.

- [ ] **Step 2: Identify a real URL for each of the four public pages**

- `PublicProfilePage`: `http://localhost:5173/#/@<any-existing-claimed-handle>` (use a handle already claimed on the configured backend; if none exists locally, use the unclaimed-handle state — it still exercises `PublicSurface` styling).
- `PublicPayLanding`: `http://localhost:5173/#/pay?r=<a nimiq: payment request URI query, as produced by makeRequestLink in src/services/links.ts>`.
- `PublicProfileLanding`: reached via a shared-profile link produced by `src/services/profile-share.ts` (`makeNimiqPayProfileLink` or the corresponding share flow) — trigger it from a local profile's Share sheet in the app.
- `OpenInNimiqPayLanding`: `http://localhost:5173/#/` opened outside Nimiq Pay (i.e. directly in a desktop/mobile browser, not via the Pay SDK handoff).

- [ ] **Step 3: Capture the full checklist from the spec**

For each of the four pages above, capture screenshots at:
- Light mode, desktop width (e.g. 1280px)
- Light mode, mobile width (~390px, e.g. iPhone 12/13 viewport)
- Light mode, narrow mobile width (~320px, e.g. iPhone SE viewport)
- Dark mode (toggle OS/browser dark mode), desktop width
- Dark mode, mobile width (~390px)

Use browser devtools device toolbar + "Emulate CSS prefers-color-scheme" to cover both themes without needing two physical devices.

- [ ] **Step 4: Verify the specific concerns from the spec**

On each screenshot, confirm:
- No layout shift or horizontal overflow from the 96px avatar / 260px QR sizes, especially at 320px width.
- The QR code shrinks proportionally (not cropped, not distorted) at 320px.
- At least one button per page shows a visible `:focus-visible` outline in both light and dark mode (tab to it, or use devtools to force the `:focus-visible` state).
- On `PublicProfilePage`: the verified badge renders as a pill (not a plain underlined link) and the avatar glow sits behind the identicon without overlapping or obscuring it.
- The canvas background glow (all four pages) is visibly subtle, not overpowering the panel/text.

- [ ] **Step 5: Long-handle / long-name wrapping check**

Load `PublicProfilePage` with a handle and/or a published `display_name` that is unusually long (e.g. locally mock `resolveHandleEnriched`/`fetchPublicProfile` to return a 25+ character display name, or find/create such a profile on the configured backend). Confirm the header text wraps cleanly without breaking the layout, overflowing the canvas, or clipping against the verified badge/avatar glow.

- [ ] **Step 6: Report findings**

If any check in Steps 4–5 fails, note the specific page/viewport/theme combination and fix it in the relevant task's files before considering this plan complete (do not silently proceed — reopen Task 2, 3, or 4 as appropriate). If all checks pass, this task requires no commit — it is verification only.

---

## Self-Review Notes

- **Spec coverage:** §1 token/gradient/dark-mode restyle → Task 2. §2 sizing bump → Tasks 3–4, with QR responsiveness → Task 1. §3 hero polish (badge, glow) → Task 3. Accessibility (focus-visible, contrast) → Task 2, verified manually in Task 5. Explicit reversal of the light-only test → Task 2 Step 1. Manual review checklist → Task 5. Non-goals (no new props/slots/script changes) — verified no task touches any `<script>` block or adds a prop/slot.
- **Placeholder scan:** no TBD/TODO; every step has literal code or literal commands.
- **Type/name consistency:** `.identity__avatar` class name introduced in Task 3 is used consistently in both the template edit and the CSS edit within the same task. Token names (`--nimiq-gold-bg`, `--nimiq-light-blue-bg`, `--nimiq-light-blue-darkened`, `--nq-gold`, `--nimiq-green`, `--nimiq-radius-pill`) are copied verbatim from the confirmed contents of `src/assets/main.css`.
