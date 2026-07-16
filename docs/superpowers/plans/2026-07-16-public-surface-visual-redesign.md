# Public Surface Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the four public-facing pages (`@handle` profile at `/u/:handle`, payment request, shared contact, add-to-NimConnect landing) to use the app's real design tokens (gradients, dark mode, one shared button implementation) instead of a parallel hardcoded light-only palette, with larger/responsive QR codes and a hero polish pass on the profile page — all while passing WCAG AA contrast, computed and verified, not assumed.

**Architecture:** All four top-level pages share one shell component, `PublicSurface.vue`, with a fixed slot API (`identity`, `panel`, `primary`, `secondary`, `tertiary`, `footer`). Three more components render inside those slots and currently duplicate the same light-only palette: `PublicAddressCopy.vue`, `PublicStoreLinks.vue`, and `OpenInNimiqPayLanding.vue`'s own lookup-form styles. This plan fixes `main.css`'s unused-but-broken `.nq-button` class first (zero blast radius today — nothing consumes it yet), then wires every filled button in the four pages to it via a template `class` attribute, then token-migrates every dependent component. No `<script>` block changes anywhere; template changes are limited to adding `class` attributes and bumping size props.

**Tech Stack:** Vue 3 `<script setup>`, scoped CSS, existing `--nimiq-*` / `--nq-*` / `--text` / `--card` / `--bg` design tokens from `src/assets/main.css` (globally imported via `src/main.ts`). Vitest + `@vue/test-utils` for tests.

## Global Constraints

- No new props, slots, or data on any component (spec: Non-goals).
- No behavior change to any button, link, or action; adding a `class` attribute to an existing element is a template-only styling change (spec: Non-goals).
- No changes to any `<script>` block, `ClaimHandleSheet`, or any service/store, in any of the seven files this redesign touches (spec: Non-goals).
- No new hardcoded colors — every value must resolve to an existing token in `src/assets/main.css`, with one documented exception: `QrCode.vue`'s `.qr` background stays hardwired to `var(--nimiq-white)` regardless of theme, because a QR code needs a light quiet zone to stay camera-scannable (spec: Changes §2, Testing).
- Public surface now supports real dark mode via `main.css`'s existing `prefers-color-scheme: dark` block — this reverses the prior light-only-guard test in `PublicSurface.test.ts` (spec: "Explicit reversal of prior decision").
- **WCAG AA contrast is computed, not assumed.** White text on `--nimiq-gold-bg` measures 1.94–2.30:1 and on `--nimiq-light-blue-bg` measures 4.16–5.79:1 (relative-luminance formula against the actual gradient stops in `main.css:21-23`) — both fail 4.5:1 at one or both stops. The fix (Task 1): `--nimiq-blue` text on the gold gradient (6.56–7.79:1); the solid `--nimiq-light-blue-darkened` token with white text for the light-blue variant (5.06:1, gradient dropped for this variant only). Gold focus-outline fails 3:1 on a white card (1.94:1); `--nq-light-blue` passes both light (4.16:1) and dark (3.63:1) cards. Green badge text on a green tint fails (≤2.65:1 at any reasonable opacity); use `var(--text)` for the label instead (spec: Accessibility).
- Decorative glow layers must be `pointer-events: none`, stacked strictly behind content, and **static** — no animation/transition on the glow itself (spec: Changes §3).
- QR codes target 260px but must scale down proportionally on narrow viewports (verified down to ~320px in the manual review) without overflow, preserving 1:1 aspect ratio (spec: Changes §2).
- `.nq-button` is currently defined in `main.css` but consumed by **no component in the app today** — fixing and adopting it here has zero blast radius on any existing screen (confirmed via `grep -rn "nq-button" src/` returning only its own definitions).
- Do not touch `docs/superpowers/specs/2026-07-14-public-profiles-and-pay-links-design.md` scope (reputation, themes, activity feed, multi-asset, quick-action buttons) — out of scope entirely (spec: Non-goals).
- `vitest`/`jsdom` has no layout engine — QR containment at 320px and real focus-ring rendering cannot be verified by automated tests. This project has no browser-automation tooling and adding one is out of scope; final confirmation is the manual review (Task 10) (spec: Testing).

---

## Task 1: Responsive, theme-exempt QR background (`QrCode.vue`)

**Files:**
- Modify: `src/components/QrCode.vue`
- Test: `src/components/QrCode.test.ts` (new)

**Interfaces:**
- Consumes: nothing new — `QrCode` already takes `text: string` and `size?: number` (default 240).
- Produces: the `.qr` CSS class now scales down responsively and its background resolves to a real token; later tasks bump the `size` prop passed by consumers to 260 and rely on this class to prevent overflow.

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

  it('keeps a white background from a real token, regardless of theme', () => {
    expect(qrCodeSource).toMatch(/\.qr\s*\{[\s\S]*?background:\s*var\(--nimiq-white\);/)
    expect(qrCodeSource).not.toMatch(/background:\s*#fff/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- QrCode.test.ts`
Expected: FAIL — the second and third tests fail (`.qr` has no `max-width`/`height: auto` yet, and background is still the literal `#fff`).

- [ ] **Step 3: Update the `.qr` class**

In `src/components/QrCode.vue`, change:

```css
.qr { border-radius: 12px; background: #fff; padding: 8px; display: block; margin: 0 auto; }
```

to:

```css
/* Stays white regardless of theme: a light quiet zone keeps the code camera-scannable. */
.qr {
  background: var(--nimiq-white);
  border-radius: 12px;
  display: block;
  height: auto;
  margin: 0 auto;
  max-width: 100%;
  padding: 8px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- QrCode.test.ts`
Expected: PASS (all three tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/QrCode.vue src/components/QrCode.test.ts
git commit -m "fix: make QR codes responsive and token-based while staying theme-exempt"
```

---

## Task 2: Fix `.nq-button` contrast in `main.css`

**Files:**
- Modify: `src/assets/main.css`
- Test: `src/assets/nq-button.test.ts` (new)

**Interfaces:**
- Consumes: existing tokens `--nimiq-blue`, `--nimiq-gold-bg`, `--nimiq-gold-bg-darkened`, `--nimiq-light-blue-darkened`, `--nimiq-white`, `--nq-light-blue`, `--nimiq-green-bg`, `--nimiq-red-bg`, `--nimiq-radius-pill`, `--attr-duration`, `--nimiq-ease` — all already defined in this file.
- Produces: `.nq-button` and `.nq-button.light-blue` become the single, contrast-correct button implementation that Tasks 4–7 attach via `class="nq-button"` / `class="nq-button light-blue"`.

- [ ] **Step 1: Write the failing test**

Create `src/assets/nq-button.test.ts`:

```typescript
import mainCssSource from './main.css?raw'
import { describe, expect, it } from 'vitest'

describe('.nq-button contrast fix', () => {
  it('uses dark ink text on the gold gradient (6.56-7.79:1, passes WCAG AA)', () => {
    expect(mainCssSource).toMatch(/\.nq-button\s*\{[\s\S]*?color:\s*var\(--nimiq-blue\);/)
  })

  it('uses the solid light-blue-darkened token, not the gradient, for the light-blue variant (5.06:1, passes)', () => {
    expect(mainCssSource).toMatch(/\.nq-button\.light-blue\s*\{\s*background:\s*var\(--nimiq-light-blue-darkened\);\s*color:\s*var\(--nimiq-white\);\s*\}/)
  })

  it('gives .nq-button a focus-visible outline using a token that passes 3:1 in both themes', () => {
    expect(mainCssSource).toMatch(/\.nq-button:focus-visible\s*\{[\s\S]*?outline:\s*3px solid var\(--nq-light-blue\);/)
  })

  it('gives .nq-button a hover state', () => {
    expect(mainCssSource).toMatch(/\.nq-button:hover\s*\{[\s\S]*?background:\s*var\(--nimiq-gold-bg-darkened\);/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- nq-button.test.ts`
Expected: FAIL on all four (current `.nq-button` has `color: var(--nimiq-white)`, `.light-blue` uses the gradient, and there is no `:hover` or `:focus-visible` rule at all).

- [ ] **Step 3: Rewrite the `.nq-button` rules**

In `src/assets/main.css`, replace:

```css
.nq-button {
  min-height: 48px;
  padding: 0 24px;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--nimiq-white);
  background: var(--nimiq-gold-bg);
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition:
    background var(--attr-duration) var(--nimiq-ease),
    transform var(--attr-duration) var(--nimiq-ease),
    opacity var(--attr-duration) var(--nimiq-ease);
}

.nq-button:active { transform: scale(0.98); }
.nq-button:disabled { cursor: default; opacity: 0.5; }
.nq-button.light-blue { background: var(--nimiq-light-blue-bg); }
.nq-button.green { background: var(--nimiq-green-bg); }
.nq-button.red { background: var(--nimiq-red-bg); }
```

with:

```css
/*
 * Contrast (WCAG relative luminance, computed against the actual gradient
 * stops above, not assumed): white text on --nimiq-gold-bg is 1.94-2.30:1
 * and on --nimiq-light-blue-bg is 4.16-5.79:1 — both fail 4.5:1 AA for
 * normal text at one or both stops. --nimiq-blue text on the gold gradient
 * is 6.56-7.79:1; white text on the solid --nimiq-light-blue-darkened is
 * 5.06:1. Both pass — keep these pairings if the gradient stops change.
 */
.nq-button {
  min-height: 48px;
  padding: 0 24px;
  border: none;
  border-radius: var(--nimiq-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--nimiq-blue);
  background: var(--nimiq-gold-bg);
  font: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition:
    background var(--attr-duration) var(--nimiq-ease),
    transform var(--attr-duration) var(--nimiq-ease),
    opacity var(--attr-duration) var(--nimiq-ease);
}

.nq-button:hover { background: var(--nimiq-gold-bg-darkened); }
.nq-button:active { transform: scale(0.98); }
.nq-button:disabled { cursor: default; opacity: 0.5; }
.nq-button:focus-visible { outline: 3px solid var(--nq-light-blue); outline-offset: 3px; }
.nq-button.light-blue { background: var(--nimiq-light-blue-darkened); color: var(--nimiq-white); }
.nq-button.green { background: var(--nimiq-green-bg); color: var(--nimiq-white); }
.nq-button.red { background: var(--nimiq-red-bg); color: var(--nimiq-white); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- nq-button.test.ts`
Expected: PASS (all four tests)

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: PASS — `.nq-button` has no template consumers yet, so no other test can regress from this change.

- [ ] **Step 6: Commit**

```bash
git add src/assets/main.css src/assets/nq-button.test.ts
git commit -m "fix: correct .nq-button contrast to meet WCAG AA before it gets its first consumers"
```

---

## Task 3: `PublicSurface.vue` — token, gradient, dark-mode restyle; delegate buttons to `.nq-button`

**Files:**
- Modify: `src/components/PublicSurface.vue`
- Modify: `src/components/PublicSurface.test.ts`

**Interfaces:**
- Consumes: `--nimiq-blue`, `--nimiq-blue-bg`, `--nq-light-blue`, `--nimiq-light-blue`, `--text`, `--text-2`, `--border`, `--card`, `--bg`, `--shadow` from `main.css`; `.nq-button` from Task 2 (referenced only implicitly — `PublicSurface` itself no longer styles filled buttons at all).
- Produces: no change to the slot API (`identity`, `panel`, `primary`, `secondary`, `tertiary`, `footer`) or component props (`context`, `footerVerb`, `actionsEnabled`) — Tasks 4–7's consumers are unaffected at the template level, except that their filled buttons now need an explicit `class="nq-button"` (this task removes the implicit styling those buttons used to get for free).

- [ ] **Step 1: Write the failing tests**

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
  it('no longer defines the removed --public-* custom properties, so app-wide dark mode applies', () => {
    expect(publicSurfaceSource).not.toMatch(/--public-ink:/)
    expect(publicSurfaceSource).not.toMatch(/--public-blue:/)
    expect(publicSurfaceSource).not.toMatch(/--public-gold:/)
    expect(publicSurfaceSource).not.toMatch(/--public-soft-blue:/)
  })

  it('keeps a visible focus-visible outline sourced from a token that passes 3:1 in both themes', () => {
    expect(publicSurfaceSource).toMatch(/:focus-visible\)[\s\S]*?outline:\s*3px solid var\(--nq-light-blue\);/)
  })

  it('gives its decorative canvas glow pointer-events: none and no transition or animation', () => {
    const canvasGlowBlock = publicSurfaceSource.match(/\.public-surface__canvas::before\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(canvasGlowBlock).toMatch(/pointer-events:\s*none;/)
    expect(canvasGlowBlock).not.toMatch(/transition|animation/)
  })

  it('no longer duplicates filled-button styling — that now lives only in .nq-button', () => {
    expect(publicSurfaceSource).not.toMatch(/__primary :slotted\(a\)[\s\S]*?background:\s*var\(--nimiq-gold/)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- PublicSurface.test.ts`
Expected: FAIL on all four new/changed tests.

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

.public-surface__secondary :slotted(.public-action--outline),
.public-surface__secondary :slotted([data-public-action='outline']) {
  align-items: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  box-sizing: border-box;
  color: var(--text);
  display: inline-flex;
  font-weight: 800;
  justify-content: center;
  min-height: 3rem;
  padding: 0.75rem 1rem;
  text-decoration: none;
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
  outline: 3px solid var(--nq-light-blue);
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

Note: filled primary/secondary buttons are no longer styled by `PublicSurface` at all — `.nq-button` (Task 2) is now the single implementation, applied via `class` in Tasks 4–7. The `.public-action--outline` ghost-button variant is unrelated to `.nq-button` and keeps its own rule here, now using `var(--text)` / `var(--border)` instead of hardcoded hex.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- PublicSurface.test.ts`
Expected: PASS (all tests, including the two pre-existing ones for slot rendering and the 44px footer button target — neither slot markup nor `.public-surface__footer :slotted(button)`'s `min-height` changed)

- [ ] **Step 5: Commit**

```bash
git add src/components/PublicSurface.vue src/components/PublicSurface.test.ts
git commit -m "feat: restyle public surface shell with real tokens, dark mode, and one shared button implementation"
```

---

## Task 4: `PublicProfilePage.vue` — sizing, `.nq-button` classes, verified badge, avatar glow

**Files:**
- Modify: `src/pages/PublicProfilePage.vue`
- Modify: `src/pages/PublicProfilePage.test.ts`

**Interfaces:**
- Consumes: `PublicSurface`'s unchanged slot API (Task 3); `.nq-button` / `.nq-button.light-blue` (Task 2); `Identicon` unchanged `size` prop; `QrCode` unchanged `size` prop, now responsive (Task 1).
- Produces: nothing new consumed elsewhere — this page is a leaf route component at `/u/:handle` (not `/@handle` — Vite reserves `/@…`; see `src/router.ts:14`).

- [ ] **Step 1: Write the failing tests**

In `src/pages/PublicProfilePage.test.ts`, add near the top (after existing imports):

```typescript
import publicProfilePageSource from './PublicProfilePage.vue?raw'
```

Add a new `describe` block at the end of the file:

```typescript
describe('PublicProfilePage visual sizing and hero polish', () => {
  it('uses the larger 96px avatar and 260px QR code sizes', () => {
    expect(publicProfilePageSource).toMatch(/<Identicon :address="payAddress" :size="96"/)
    expect(publicProfilePageSource).toMatch(/<QrCode :text="payUri" :size="260"/)
  })

  it('wraps the avatar in a glow container that never blocks interaction and never animates', () => {
    expect(publicProfilePageSource).toMatch(/class="identity__avatar"/)
    const glowBlock = publicProfilePageSource.match(/\.identity__avatar::before\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(glowBlock).toMatch(/pointer-events:\s*none;/)
    expect(glowBlock).not.toMatch(/transition|animation/)
  })

  it('styles the verified badge as a pill with theme-safe text on a green tint', () => {
    const verifiedBlock = publicProfilePageSource.match(/\.verified\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(verifiedBlock).toMatch(/border-radius:\s*var\(--nimiq-radius-pill\);/)
    expect(verifiedBlock).toMatch(/--nimiq-green/)
    expect(verifiedBlock).toMatch(/color:\s*var\(--text\);/)
  })

  it('uses the shared .nq-button class on its filled actions instead of a bespoke implementation', () => {
    expect(publicProfilePageSource.match(/class="nq-button"/g)?.length).toBe(2)
    expect(publicProfilePageSource).toContain('class="nq-button light-blue"')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- PublicProfilePage.test.ts`
Expected: FAIL on all four new tests.

- [ ] **Step 3: Update the identity header template**

In `src/pages/PublicProfilePage.vue`, change:

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

- [ ] **Step 4: Update the QR size**

Change:

```html
        <QrCode :text="payUri" :size="200" />
```

to:

```html
        <QrCode :text="payUri" :size="260" />
```

- [ ] **Step 5: Add `.nq-button` classes to the primary/secondary actions**

Change:

```html
    <template #primary>
      <a v-if="state === 'ready' && claim" :href="makeNimiqPayDeepLink(payAddress)">Send in Nimiq Pay</a>
      <button v-else type="button" @click="refresh">Refresh</button>
    </template>

    <template #secondary>
      <a v-if="state === 'ready' && claim" :href="makeWalletRequestLink(payAddress)" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
      <a v-if="state === 'ready' && claim" :href="makeNimiqPayAddLink(payAddress)" class="public-action--outline">Add to NimConnect</a>
    </template>
```

to:

```html
    <template #primary>
      <a v-if="state === 'ready' && claim" class="nq-button" :href="makeNimiqPayDeepLink(payAddress)">Send in Nimiq Pay</a>
      <button v-else type="button" class="nq-button" @click="refresh">Refresh</button>
    </template>

    <template #secondary>
      <a v-if="state === 'ready' && claim" class="nq-button light-blue" :href="makeWalletRequestLink(payAddress)" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
      <a v-if="state === 'ready' && claim" :href="makeNimiqPayAddLink(payAddress)" class="public-action--outline">Add to NimConnect</a>
    </template>
```

- [ ] **Step 6: Update the styles**

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
  color: var(--text);
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem;
  text-decoration: none;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- PublicProfilePage.test.ts`
Expected: PASS (all tests, including the three pre-existing ones — they assert text content and href attributes, not sizes/classes/colors that changed)

- [ ] **Step 8: Commit**

```bash
git add src/pages/PublicProfilePage.vue src/pages/PublicProfilePage.test.ts
git commit -m "feat: hero polish on public profile page — larger avatar/QR, verified badge, avatar glow, shared button class"
```

---

## Task 5: `PublicPayLanding.vue` — sizing and `.nq-button` classes

**Files:**
- Modify: `src/components/PublicPayLanding.vue`
- Test: `src/components/PublicPayLanding.test.ts` (new)

**Interfaces:**
- Consumes: `PublicSurface`'s unchanged slot API (Task 3); `.nq-button` / `.nq-button.light-blue` (Task 2); `Identicon`/`QrCode` unchanged prop contracts.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

Create `src/components/PublicPayLanding.test.ts`:

```typescript
import publicPayLandingSource from './PublicPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicPayLanding sizing and button classes', () => {
  it('uses the larger 96px avatar and 260px QR code sizes', () => {
    expect(publicPayLandingSource).toMatch(/<Identicon :address="payment.recipient" :size="96"/)
    expect(publicPayLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="260"/)
  })

  it('uses the shared .nq-button class on its filled actions', () => {
    expect(publicPayLandingSource).toContain('class="nq-button"')
    expect(publicPayLandingSource).toContain('class="nq-button light-blue"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- PublicPayLanding.test.ts`
Expected: FAIL (current sizes are 64/220, no `nq-button` classes present).

- [ ] **Step 3: Update sizes and add button classes**

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

Change:

```html
    <template #primary>
      <a :href="payDeepLink">Pay with Nimiq Pay</a>
    </template>

    <template #secondary>
      <a :href="walletLink" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
    </template>
```

to:

```html
    <template #primary>
      <a class="nq-button" :href="payDeepLink">Pay with Nimiq Pay</a>
    </template>

    <template #secondary>
      <a class="nq-button light-blue" :href="walletLink" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
    </template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- PublicPayLanding.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/PublicPayLanding.vue src/components/PublicPayLanding.test.ts
git commit -m "feat: bump sizes and adopt shared button class on the payment request page"
```

---

## Task 6: `PublicProfileLanding.vue` — sizing and `.nq-button` classes

**Files:**
- Modify: `src/components/PublicProfileLanding.vue`
- Test: `src/components/PublicProfileLanding.test.ts` (new)

**Interfaces:**
- Consumes: `PublicSurface`'s unchanged slot API (Task 3); `.nq-button` / `.nq-button.light-blue` (Task 2); `Identicon`/`QrCode` unchanged prop contracts.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

Create `src/components/PublicProfileLanding.test.ts`:

```typescript
import publicProfileLandingSource from './PublicProfileLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicProfileLanding sizing and button classes', () => {
  it('uses the larger 96px avatar and 260px QR code sizes', () => {
    expect(publicProfileLandingSource).toMatch(/<Identicon :address="profile.address" :size="96"/)
    expect(publicProfileLandingSource).toMatch(/<QrCode :text="nimiqUri" :size="260"/)
  })

  it('uses the shared .nq-button class on its filled actions but keeps the outline variant for Add to NimConnect', () => {
    expect(publicProfileLandingSource).toContain('class="nq-button"')
    expect(publicProfileLandingSource).toContain('class="nq-button light-blue"')
    expect(publicProfileLandingSource).toContain('class="public-action--outline"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- PublicProfileLanding.test.ts`
Expected: FAIL (current sizes are 80/220, no `nq-button` classes present).

- [ ] **Step 3: Update sizes and add button classes**

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

Change:

```html
    <template #primary>
      <a :href="payDeepLink">Pay with Nimiq Pay</a>
    </template>

    <template #secondary>
      <a :href="walletLink" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
      <a :href="addInPayLink" class="public-action--outline">Add to NimConnect</a>
    </template>
```

to:

```html
    <template #primary>
      <a class="nq-button" :href="payDeepLink">Pay with Nimiq Pay</a>
    </template>

    <template #secondary>
      <a class="nq-button light-blue" :href="walletLink" target="_blank" rel="noopener noreferrer">Pay with Nimiq Wallet</a>
      <a :href="addInPayLink" class="public-action--outline">Add to NimConnect</a>
    </template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- PublicProfileLanding.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/PublicProfileLanding.vue src/components/PublicProfileLanding.test.ts
git commit -m "feat: bump sizes and adopt shared button class on the shared-contact page"
```

---

## Task 7: `OpenInNimiqPayLanding.vue` — sizing, `.nq-button` classes, and token migration

**Files:**
- Modify: `src/components/OpenInNimiqPayLanding.vue`
- Test: `src/components/OpenInNimiqPayLanding.test.ts` (new)

**Interfaces:**
- Consumes: `PublicSurface`'s unchanged slot API (Task 3); `.nq-button` (Task 2); `--text`, `--text-2`, `--card`, `--border`, `--nq-light-blue`, `--nimiq-red` from `main.css`.
- Produces: nothing new consumed elsewhere.

This file has two things the other three don't: a lookup `<form>` whose submit `<button>` was, until Task 3, implicitly styled by `PublicSurface`'s now-removed generic `:slotted(button)` rule (it has no local style of its own), and several `--public-*` references with light-only hex fallbacks in its own lookup-form CSS.

- [ ] **Step 1: Write the failing test**

Create `src/components/OpenInNimiqPayLanding.test.ts`:

```typescript
import openInNimiqPayLandingSource from './OpenInNimiqPayLanding.vue?raw'
import { describe, expect, it } from 'vitest'

describe('OpenInNimiqPayLanding sizing, button classes, and token migration', () => {
  it('uses the larger 96px logo size', () => {
    expect(openInNimiqPayLandingSource).toMatch(/<img class="handoff__logo" :src="iconUrl" alt="" width="96" height="96" \/>/)
  })

  it('gives both the primary action and the lookup submit button the shared .nq-button class', () => {
    expect(openInNimiqPayLandingSource.match(/class="nq-button"/g)?.length).toBe(2)
  })

  it('no longer references the removed --public-* custom properties', () => {
    expect(openInNimiqPayLandingSource).not.toMatch(/--public-ink/)
    expect(openInNimiqPayLandingSource).not.toMatch(/--public-blue/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- OpenInNimiqPayLanding.test.ts`
Expected: FAIL (logo is 80px, no `nq-button` classes, `--public-ink`/`--public-blue` still referenced).

- [ ] **Step 3: Bump the logo size**

Change:

```html
      <img class="handoff__logo" :src="iconUrl" alt="" width="80" height="80" />
```

to:

```html
      <img class="handoff__logo" :src="iconUrl" alt="" width="96" height="96" />
```

- [ ] **Step 4: Add `.nq-button` to the primary action and the lookup submit button**

Change:

```html
    <template #primary>
      <a :href="openUrl">Open in Nimiq Pay</a>
    </template>
```

to:

```html
    <template #primary>
      <a class="nq-button" :href="openUrl">Open in Nimiq Pay</a>
    </template>
```

Change:

```html
        <button type="submit" :disabled="lookupPending">Look up</button>
```

to:

```html
        <button type="submit" class="nq-button" :disabled="lookupPending">Look up</button>
```

- [ ] **Step 5: Migrate the lookup-form styles off `--public-*` and hardcoded hex**

Change:

```css
.handoff__body strong { color: var(--public-ink); font-weight: 800; }
```

to:

```css
.handoff__body strong { color: var(--text); font-weight: 800; }
```

Change:

```css
.handoff__lookup-input {
  appearance: none;
  background: #ffffff;
  border: 1px solid #dce7ff;
  border-radius: 0.875rem;
  box-shadow: inset 0 1px 2px rgb(31 35 72 / 0.04);
  box-sizing: border-box;
  color: var(--public-ink, #1f2348);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  min-height: 3rem;
  padding: 0.75rem 1rem;
  width: 100%;
}

.handoff__lookup-input::placeholder {
  color: #8a93a8;
  font-weight: 500;
}

.handoff__lookup-input:hover:not(:disabled) {
  border-color: #bdc9e5;
}

.handoff__lookup-input:focus {
  border-color: var(--public-blue, #2252c7);
  box-shadow: 0 0 0 3px rgb(34 82 199 / 0.12);
}
```

to:

```css
.handoff__lookup-input {
  appearance: none;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  box-shadow: inset 0 1px 2px rgb(31 35 72 / 0.04);
  box-sizing: border-box;
  color: var(--text);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  min-height: 3rem;
  padding: 0.75rem 1rem;
  width: 100%;
}

.handoff__lookup-input::placeholder {
  color: var(--text-2);
  font-weight: 500;
}

.handoff__lookup-input:hover:not(:disabled) {
  border-color: var(--text-2);
}

.handoff__lookup-input:focus {
  border-color: var(--nq-light-blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--nq-light-blue) 12%, transparent);
}
```

Change:

```css
.handoff__lookup-error {
  color: #b42318;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
}
```

to:

```css
.handoff__lookup-error {
  color: var(--nimiq-red);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test -- OpenInNimiqPayLanding.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/OpenInNimiqPayLanding.vue src/components/OpenInNimiqPayLanding.test.ts
git commit -m "feat: bump logo size, adopt shared button class, migrate lookup form off removed tokens"
```

---

## Task 8: Token migration for `PublicAddressCopy.vue` and `PublicStoreLinks.vue`

**Files:**
- Modify: `src/components/PublicAddressCopy.vue`
- Modify: `src/components/PublicStoreLinks.vue`
- Test: `src/components/PublicAddressCopy.test.ts` (new)
- Test: `src/components/PublicStoreLinks.test.ts` (new)

**Interfaces:**
- Consumes: `--bg`, `--border`, `--text` from `main.css`.
- Produces: nothing new consumed elsewhere — both are leaf presentational components rendered inside `PublicSurface`'s `panel`/`primary`/`tertiary` slots by the four top-level pages.

Both files still reference `--public-soft-blue` / `--public-ink` (with light-only hex fallbacks) or a bare hardcoded border color, none of which track dark mode.

- [ ] **Step 1: Write the failing tests**

Create `src/components/PublicAddressCopy.test.ts`:

```typescript
import publicAddressCopySource from './PublicAddressCopy.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicAddressCopy token migration', () => {
  it('no longer references the removed --public-* custom properties or their hex fallbacks', () => {
    expect(publicAddressCopySource).not.toMatch(/--public-ink/)
    expect(publicAddressCopySource).not.toMatch(/--public-soft-blue/)
  })

  it('uses themed tokens for its background, border, and text color', () => {
    expect(publicAddressCopySource).toMatch(/\.public-address-copy\s*\{[\s\S]*?background:\s*var\(--bg\);/)
    expect(publicAddressCopySource).toMatch(/border:\s*1px solid var\(--border\);/)
    expect(publicAddressCopySource).toMatch(/color:\s*var\(--text\);/)
  })
})
```

Create `src/components/PublicStoreLinks.test.ts`:

```typescript
import publicStoreLinksSource from './PublicStoreLinks.vue?raw'
import { describe, expect, it } from 'vitest'

describe('PublicStoreLinks token migration', () => {
  it('uses a themed border token instead of a hardcoded light-only hex', () => {
    expect(publicStoreLinksSource).not.toMatch(/#bdc9e5/)
    expect(publicStoreLinksSource).toMatch(/border:\s*1px solid var\(--border\);/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- PublicAddressCopy.test.ts PublicStoreLinks.test.ts`
Expected: FAIL on all assertions (current code still has `--public-*` refs and the hardcoded `#bdc9e5` border).

- [ ] **Step 3: Migrate `PublicAddressCopy.vue`**

Change:

```css
.public-address-copy {
  align-items: center;
  background: var(--public-soft-blue, #eef4ff);
  border: 1px solid #dce7ff;
  border-radius: 0.875rem;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.75rem;
}

.public-address-copy__address {
  color: var(--public-ink, #1f2348);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.45;
  min-width: 0;
  overflow-wrap: anywhere;
  user-select: all;
}

.public-address-copy__button {
  background: transparent;
  border: 1px solid #bdc9e5;
  border-radius: 0.625rem;
  color: var(--public-ink, #1f2348);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 800;
  min-height: 2.75rem;
  padding: 0.5rem 0.625rem;
}
```

to:

```css
.public-address-copy {
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 0.875rem;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.75rem;
}

.public-address-copy__address {
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.45;
  min-width: 0;
  overflow-wrap: anywhere;
  user-select: all;
}

.public-address-copy__button {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  color: var(--text);
  cursor: pointer;
  flex: 0 0 auto;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 800;
  min-height: 2.75rem;
  padding: 0.5rem 0.625rem;
}
```

- [ ] **Step 4: Migrate `PublicStoreLinks.vue`**

Change:

```css
.public-store-links a { align-items: center; border: 1px solid #bdc9e5; border-radius: 0.75rem; color: var(--text); display: inline-flex; font-size: 0.8125rem; font-weight: 800; min-height: 2.75rem; padding: 0.625rem 0.75rem; text-decoration: none; }
```

to:

```css
.public-store-links a { align-items: center; border: 1px solid var(--border); border-radius: 0.75rem; color: var(--text); display: inline-flex; font-size: 0.8125rem; font-weight: 800; min-height: 2.75rem; padding: 0.625rem 0.75rem; text-decoration: none; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- PublicAddressCopy.test.ts PublicStoreLinks.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/PublicAddressCopy.vue src/components/PublicStoreLinks.vue src/components/PublicAddressCopy.test.ts src/components/PublicStoreLinks.test.ts
git commit -m "fix: migrate PublicAddressCopy and PublicStoreLinks off removed --public-* tokens"
```

---

## Task 9: Repo-wide sweep — no file still references the removed `--public-*` tokens

**Files:**
- Test: `src/publicSurfaceTokens.test.ts` (new)

**Interfaces:**
- Consumes: the filesystem under `src/` (Node's `fs`/`path`, available in the Vitest/Node test environment).
- Produces: nothing consumed by other tasks — this is a backstop that scans every `.vue`/`.css` file, not just the ones enumerated in Tasks 3–8, so it also catches anything missed.

This is the automated version of finding #5 from the code review: instead of trusting that every dependent file was found and fixed by hand, scan all of `src/` for the pattern.

- [ ] **Step 1: Write the failing test**

Create `src/publicSurfaceTokens.test.ts`:

```typescript
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function collectVueAndCssFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) collectVueAndCssFiles(full, files)
    else if (/\.(vue|css)$/.test(entry)) files.push(full)
  }
  return files
}

describe('public surface token migration', () => {
  it('no source file under src/ references the removed --public-* custom properties', () => {
    const files = collectVueAndCssFiles(__dirname)
    const offenders: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      if (/--public-(ink|blue|gold|soft-blue)\b/.test(content)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npm run test -- publicSurfaceTokens.test.ts`
Expected: PASS if Tasks 3, 7, and 8 fully removed every `--public-*` reference; if it FAILS, the `offenders` array in the assertion failure lists the exact file(s) still needing migration — go fix those files using the same token mapping as Task 7/8, then re-run.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: PASS — this is the last automated task; everything from Tasks 1–8 should be green together.

- [ ] **Step 4: Run the production build**

Run: `npm run build`
Expected: succeeds (`vue-tsc -b && vite build`) — confirms no TypeScript/template errors were introduced by the `class` attribute additions.

- [ ] **Step 5: Commit**

```bash
git add src/publicSurfaceTokens.test.ts
git commit -m "test: add repo-wide sweep guarding against reintroducing removed --public-* tokens"
```

---

## Task 10: Manual visual review (screenshots and measurements)

**Files:** none — this task produces no code changes, only verification.

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Vite dev server starts on `http://localhost:5173`.

- [ ] **Step 2: Identify a real URL for each of the four public pages**

- `PublicProfilePage`: `http://localhost:5173/#/u/<any-existing-claimed-handle>` (route is `/u/:handle`, confirmed in `src/router.ts:14` — not `/@handle`; use a handle already claimed on the configured backend, or the unclaimed-handle state if none exists locally — it still exercises `PublicSurface` styling).
- `PublicPayLanding`: `http://localhost:5173/#/pay?r=<a nimiq: payment request URI query, as produced by makeRequestLink in src/services/links.ts>`.
- `PublicProfileLanding`: reached via a shared-profile link produced by `src/services/profile-share.ts` (`makeNimiqPayProfileLink`) — trigger it from a local profile's Share sheet in the app.
- `OpenInNimiqPayLanding`: `http://localhost:5173/#/` opened outside Nimiq Pay (directly in a desktop/mobile browser, not via the Pay SDK handoff).

- [ ] **Step 3: Capture the full checklist from the spec**

For each of the four pages above, capture screenshots at:
- Light mode, desktop width (e.g. 1280px)
- Light mode, mobile width (~390px, e.g. iPhone 12/13 viewport)
- Light mode, narrow mobile width (~320px, e.g. iPhone SE viewport)
- Dark mode (toggle OS/browser dark mode), desktop width
- Dark mode, mobile width (~390px)

Use browser devtools device toolbar + "Emulate CSS prefers-color-scheme" to cover both themes without needing two physical devices.

- [ ] **Step 4: Verify with actual measurements, not visual judgment**

On each screenshot/page, confirm with devtools (not eyeballing):
- At 320px width: select the QR `<img>` in the Elements panel, read its computed `width` in the Computed panel, and confirm it is ≤ the panel's content-box width. Confirm `document.body.scrollWidth` equals the viewport width (no horizontal overflow).
- Tab to (or force `:focus-visible` via devtools' "Force element state") at least one button per page in each theme, and confirm a visible outline renders — this is the `--nq-light-blue` outline from Tasks 2–3, not the old gold one.
- On `PublicProfilePage`: the verified badge renders as a pill with legible text (dark-on-tint in light mode, light-on-tint in dark mode via `var(--text)`), and the avatar glow sits behind the identicon without overlapping or obscuring it, and without any visible motion.
- The canvas background glow (all four pages) is visibly subtle, not overpowering the panel/text, in both themes.
- The primary button (gold) shows dark ink text; the secondary button (light-blue) shows white text — both legible at a glance, not just "technically passing."

- [ ] **Step 5: Long-handle / long-name wrapping check**

Load `PublicProfilePage` with a handle and/or a published `display_name` that is unusually long (e.g. locally mock `resolveHandleEnriched`/`fetchPublicProfile` to return a 25+ character display name, or find/create such a profile on the configured backend). Confirm the header text wraps cleanly without breaking the layout, overflowing the canvas, or clipping against the verified badge/avatar glow.

- [ ] **Step 6: Report findings**

If any check in Steps 4–5 fails, note the specific page/viewport/theme combination and fix it in the relevant task's files before considering this plan complete (reopen Task 2, 3, 4, 5, 6, 7, or 8 as appropriate — do not silently proceed). If all checks pass, this task requires no commit — it is verification only.

---

## Self-Review Notes

- **Spec coverage:** §1 token/gradient/dark-mode restyle → Task 3; `.nq-button` contrast fix → Task 2; button-class adoption → Tasks 4-7. §2 sizing bump → Tasks 4-6; logo bump → Task 7; QR responsiveness + theme-exempt background → Task 1. §3 hero polish (badge, glow) → Task 4. Accessibility (focus-visible, contrast, badge text color) → Tasks 2-4, verified with computed numbers and manually in Task 10. Explicit reversal of the light-only test → Task 3 Step 1. Dependent components (`PublicAddressCopy`, `PublicStoreLinks`, `OpenInNimiqPayLanding`'s lookup form) → Tasks 7-8. Repo-wide sweep for missed `--public-*` refs → Task 9. Route-path correction → Task 4 and Task 10. Manual review checklist → Task 10. Non-goals (no new props/slots/script changes) — verified no task touches any `<script>` block or adds a prop/slot; template changes are limited to `class` attributes and size-prop literals.
- **Placeholder scan:** no TBD/TODO; every step has literal code or literal commands.
- **Type/name consistency:** `.identity__avatar` class name (Task 4) is used consistently in both the template edit and the CSS edit within the same task. `.nq-button` / `.nq-button.light-blue` class names are identical across Tasks 2, 4, 5, 6, 7. Token names (`--nimiq-gold-bg`, `--nimiq-gold-bg-darkened`, `--nimiq-light-blue-darkened`, `--nq-light-blue`, `--nimiq-green`, `--nimiq-radius-pill`, `--bg`, `--card`, `--border`, `--text`, `--text-2`, `--nimiq-red`) are copied verbatim from the confirmed contents of `src/assets/main.css` and the confirmed current contents of each modified file.
- **Contrast fixes are traceable:** every color decision in Task 2 and Task 4 cites the computed ratio in a comment or in this plan's Global Constraints, rather than asserting compliance without a number.
