# Public surface visual redesign — Design

Date: 2026-07-16
Status: approved (revised 2026-07-16 after implementation-plan code review —
see corrected route path, `.nq-button` contrast fix, badge text color, and
the three additional dependent components in scope)

## Goal

Make the four public-facing pages (`@handle` profile, payment request, shared
contact, add-to-NimConnect landing) look like a polished product people would
screenshot and share, instead of a generic light-blue card. This is a visual
pass only — no new data, no backend changes, no new subsystems (reputation,
themes, multi-asset, activity feeds are explicitly out of scope; see the
2026-07-14 public-profiles spec for those directions if picked up later).

## Explicit reversal of prior decision

`PublicSurface.test.ts` currently asserts the shell stays light-mode only
regardless of the viewer's OS theme (a deliberate prior decision, likely to
keep shared/QR-scan links readable no matter what theme the opener's device
uses). This spec reverses that: the public surface adopts real dark-mode
support via `main.css`'s existing `prefers-color-scheme: dark` tokens, same
as the rest of the app. The old light-only-guard test is replaced with a
test asserting both themes render with adequate contrast (see Testing).

## Why now

`PublicSurface.vue` hardcodes its own flat palette (`--public-ink`,
`--public-blue`, `--public-gold`, all light-mode only) instead of using the
app's existing token set in `src/assets/main.css` — which already has
gradient backgrounds (`--nimiq-gold-bg`, `--nimiq-light-blue-bg`), a dark-mode
media query, and a wallet text-opacity ladder. The public pages are the only
part of the app not using them. Fixing that is most of the visual upgrade,
with no new markup.

## Scope

`PublicSurface.vue` is the shared shell for:
- `PublicProfilePage.vue` (route `/u/:handle`, not `/@handle` — Vite reserves
  `/@…`; see `src/router.ts:14`)
- `PublicPayLanding.vue` (payment request)
- `PublicProfileLanding.vue` (shared contact)
- `OpenInNimiqPayLanding.vue` (add-to-NimConnect handoff)

Three further components render *inside* those slots and currently consume
the same `--public-*` custom properties this redesign removes, with
hardcoded light-only fallbacks: `PublicAddressCopy.vue`, `PublicStoreLinks.vue`,
and `OpenInNimiqPayLanding.vue`'s own lookup-form styles (`.handoff__body
strong`, `.handoff__lookup-input`, `.handoff__lookup-error`). These are in
scope too — removing `--public-ink`/`--public-blue`/`--public-soft-blue`
from `PublicSurface.vue` without migrating these three would leave them
either broken (no fallback) or permanently light-only (fallback used).

All four top-level pages keep their current slot API (`identity`, `panel`,
`primary`, `secondary`, `tertiary`, `footer`) and prop contracts. This is a
restyle, not a re-architecture — no consumer's `<script>` block changes.
Template changes are limited to adding CSS class names to existing elements
(see Changes §1).

## Changes

### 1. Token/gradient/dark-mode restyle (`PublicSurface.vue`)

- Replace the local `--public-ink` / `--public-blue` / `--public-gold` /
  `--public-soft-blue` custom properties with the app's real tokens
  (`--nimiq-blue`, `--text`, `--text-2`, `--border`, etc.), inheriting
  `main.css`'s existing `@media (prefers-color-scheme: dark)` block instead of
  redefining a parallel light-only palette.
- Primary/secondary action buttons adopt the literal shared `.nq-button`
  class from `main.css`, applied via `class="nq-button"` /
  `class="nq-button light-blue"` on the existing `<a>`/`<button>` elements in
  each consumer template (a template-only change, no `<script>` edit).
  `PublicSurface.vue` stops styling slotted buttons itself — one real
  implementation, not two. `.nq-button` is currently defined in `main.css`
  but used by **no component in the app today**, so fixing it and adopting it
  here has zero blast radius on any existing screen.
- **Contrast correction to `.nq-button` itself** (computed with the WCAG
  relative-luminance formula against the actual gradient stops in
  `main.css:21-23`, not assumed): white text on the gold gradient is
  1.94–2.30:1 and white text on the light-blue gradient is 4.16–5.79:1 —
  **both fail** the 4.5:1 AA requirement for normal-weight text at one or
  both gradient stops. Fix, applied once in `main.css` (benefits every future
  consumer of `.nq-button`, not just these four pages):
  - `.nq-button` (default/gold): text color becomes `var(--nimiq-blue)` —
    6.56–7.79:1 against both gradient stops.
  - `.nq-button.light-blue`: background becomes the solid
    `var(--nimiq-light-blue-darkened)` token (not the gradient) with
    `color: var(--nimiq-white)` — 5.06:1, comfortably AA. The gradient is
    dropped for this variant specifically because no single text color
    passes AA against both of its stops.
  - `.nq-button.green` / `.nq-button.red` keep `color: var(--nimiq-white)`
    explicitly (previously inherited); unused by this pass, left otherwise
    unchanged.
  - A `.nq-button:hover` state and a `.nq-button:focus-visible` state are
    added (neither existed before, since the class had no consumers) — hover
    uses the existing `--nimiq-gold-bg-darkened` token for the default
    variant; focus-visible uses `--nq-light-blue` (see Accessibility).
- The existing `.public-action--outline` variant is unrelated to `.nq-button`
  (it's a bordered/transparent ghost style, not a filled button) and keeps
  its own scoped rule in `PublicSurface.vue`, restyled to use `var(--text)` /
  `var(--border)` instead of hardcoded hex.
- Canvas background gets a decorative radial glow *behind* the existing
  gradient, not a reduction of the canvas's own opacity: an absolutely
  positioned `::before` (or a second background layer) using the
  `--nimiq-blue-bg` gradient at reduced *element* opacity (e.g. `opacity:
  0.15` on the pseudo-element itself), stacked under the card content
  (`z-index` below `.public-surface__canvas` children). The canvas surface
  and its text stay fully opaque — only the decorative layer is
  translucent. No new hardcoded colors; only existing tokens.
- No layout/structural change: same grid, same slot regions, same responsive
  breakpoints.

### 2. Sizing bump (shell + consumers)

- Identicon/avatar size in the `identity` slot goes from 64–80px to 96px
  across all four consumers (one prop value change per file, no markup
  change).
- QR code size targets 260px but must stay responsive: `QrCode.vue`'s own
  `.qr` class gets `max-width: 100%; height: auto;` so the rendered image
  scales down proportionally on narrow viewports — verified down to ~320px
  wide in the manual review (Testing) — instead of overflowing or forcing
  horizontal scroll. Aspect ratio (1:1) is preserved at every size. `.qr`'s
  background stays hardwired to `var(--nimiq-white)` (not a themed token) —
  a documented exception, since a QR code needs a light quiet zone to stay
  camera-scannable regardless of the viewer's OS theme.
- Headline (`h1`) font-size increases one step in the type scale for more
  hero presence.

### 3. Hero polish — `PublicProfilePage.vue` only

- The existing "✓ Handle verified on the Nimiq chain" link is restyled as a
  small pill/badge (background tint using `--nimiq-green`, existing
  `--nimiq-radius-pill` token) sitting directly under the handle, instead of
  a plain underlined link. It remains a link to the explorer; behavior
  unchanged, only visual treatment.
- The identity section gets a soft radial glow behind the avatar: a
  decorative `::before` pseudo-element, `pointer-events: none`, negative
  `z-index` (or otherwise stacked strictly behind the avatar/content) so it
  never intercepts clicks/taps or visually overlaps the identicon itself.
  Static only — no animation, transition, or motion on the glow (keeps this
  pass free of added complexity and respects
  `prefers-reduced-motion` trivially since there's no motion to reduce). No
  new DOM elements beyond what pure CSS requires.

## Accessibility

- Every button and link keeps a visible `:focus-visible` outline in both
  light and dark mode. The gold token fails the 3:1 UI-component contrast
  requirement against a white card (1.94:1, computed); `--nq-light-blue`
  passes against both the light card (4.16:1) and the dark card (3.63:1), so
  it replaces gold as the focus-outline color everywhere in
  `PublicSurface.vue`, including `.nq-button:focus-visible` in `main.css`.
- Gradient/solid button text must meet WCAG AA contrast (4.5:1, normal-weight
  text) against the actual background it sits on — see the computed values
  and fix under Changes §1. Do not assume white-on-gradient is safe; it
  isn't, for either of `.nq-button`'s two variants used here.
- The "Handle verified" badge (Changes §3) uses `var(--text)` for its label,
  not `var(--nimiq-green)` — green text on a light green tint measures
  ≤2.65:1 against the tint at any reasonable opacity, failing AA. The green
  tint carries the "verified" signal in the background/icon; the label text
  stays in the theme's normal, already-compliant foreground color.
- No change to tab order, semantics, or ARIA — this pass touches CSS, a
  handful of size/prop values, and adds `class="nq-button"` /
  `class="nq-button light-blue"` to existing interactive elements.

## Non-goals

- No new props, slots, or data on any component.
- No behavior change to any button, link, or action (adding `class="nq-button"`
  to an existing element changes its appearance, not what it does).
- No changes to any `<script>` block, `ClaimHandleSheet`, or any
  service/store, in any of the seven files this redesign touches.
- No reputation stats, themes, activity feed, quick-action buttons, or
  multi-asset support — those are separate, larger projects (see
  `2026-07-14-public-profiles-and-pay-links-design.md` for the ecosystem
  direction if pursued later).

## Testing

- `PublicSurface.test.ts`'s light-only-guard test (asserting hardcoded
  `--text`/`--text-2`/`--border` regardless of theme) is replaced with tests
  asserting: the shell no longer defines the `--public-*` custom properties;
  the shared `.nq-button` gradient tokens are what buttons rely on now
  (structurally, via the consumer templates); and the focus-visible outline
  uses `--nq-light-blue`.
  Other tests in that file and `PublicProfilePage.test.ts` assert
  structure/slot presence, not exact colors — continue passing unchanged.
- A repo-wide sweep test (new) scans every `.vue`/`.css` file under `src/`
  and fails if any file still references `--public-ink`, `--public-blue`,
  `--public-gold`, or `--public-soft-blue` — catching every dependent
  component (not just the ones enumerated in Scope), including any missed
  during implementation.
- `main.css`'s corrected `.nq-button` colors are locked in by a source-level
  test asserting the literal token values from Changes §1, so a future edit
  that reintroduces the contrast bug fails CI rather than requiring someone
  to notice visually.
- WCAG contrast is a **computed, documented value** (see Changes §1 and
  Accessibility), not a visual judgment — recorded as a comment directly
  above the relevant `main.css` rules so the invariant survives future edits.
- True QR-code containment at 320px and real focus-ring rendering cannot be
  verified by `vitest`/`jsdom` (no layout engine) — this project has no
  browser-automation tooling (`Bash: grep -i playwright/cypress/puppeteer`
  over `package.json` returns nothing), and adding one for a single check is
  out of scope. This is a real, disclosed limitation of the automated suite:
  final confirmation is the manual review below.
- Manual review checklist (screenshot-based, with concrete measurements, not
  just "looks fine"): all four public pages (`PublicProfilePage` at
  `/u/:handle`, `PublicPayLanding`, `PublicProfileLanding`,
  `OpenInNimiqPayLanding`) × light mode × dark mode × desktop width × mobile
  width (~390px) × narrow mobile width (~320px). At 320px, use devtools to
  read the QR `<img>`'s computed/rendered width and confirm it is ≤ the
  panel's content-box width (no horizontal scrollbar on `<body>`). Confirm a
  visible focus-visible outline on at least one button per page in each
  theme (tab to it or force `:focus-visible` in devtools). Add one extra
  case: a profile with a long handle and/or long display name, to check
  header wrapping and spacing don't break.
- No new automated visual regression tooling — out of scope for this pass.
