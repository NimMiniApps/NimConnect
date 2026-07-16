# Public surface visual redesign — Design

Date: 2026-07-16
Status: approved

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
- `PublicProfilePage.vue` (`/@handle`)
- `PublicPayLanding.vue` (payment request)
- `PublicProfileLanding.vue` (shared contact)
- `OpenInNimiqPayLanding.vue` (add-to-NimConnect handoff)

All four keep their current slot API (`identity`, `panel`, `primary`,
`secondary`, `tertiary`, `footer`) and prop contracts. This is a restyle, not
a re-architecture — no consumer's `<script>` changes.

## Changes

### 1. Token/gradient/dark-mode restyle (`PublicSurface.vue`)

- Replace the local `--public-ink` / `--public-blue` / `--public-gold` /
  `--public-soft-blue` custom properties with the app's real tokens
  (`--nimiq-blue`, `--text`, `--text-2`, `--border`, etc.), inheriting
  `main.css`'s existing `@media (prefers-color-scheme: dark)` block instead of
  redefining a parallel light-only palette.
- Primary/secondary action buttons adopt the shared `.nq-button` rules from
  `main.css` (gold gradient for primary, light-blue gradient for secondary)
  rather than redefining button styling locally — same hover, `:active`
  scale/opacity, `:disabled`, and `:focus-visible` behavior as every other
  button in the app, in both light and dark mode. The existing
  `.public-action--outline` variant keeps its own transparent/bordered look
  but still inherits the shared focus-visible outline. Foreground text on
  both gradients must continue to meet WCAG AA contrast (`--nimiq-white` on
  gold/light-blue gradients is the app's existing combination — reuse it
  as-is, don't introduce a new text color for public buttons).
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
- QR code size targets 260px but must stay responsive: wrap `QrCode` in a
  container capped with `max-width: 100%` (and `width: min(260px, 100%)` or
  equivalent) so it scales down proportionally on narrow viewports —
  verified down to ~320px wide — instead of overflowing or forcing
  horizontal scroll. Aspect ratio (1:1) is preserved at every size.
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
  light and dark mode — reuse the existing shared focus-visible rule
  (`PublicSurface`'s current `outline: 3px solid var(--public-gold)` block
  becomes an existing app token, e.g. `--nimiq-gold`, applied the same way)
  rather than dropping it during the token swap.
- Gradient button text must meet WCAG AA contrast against both ends of the
  gradient — use the app's existing white-on-gradient combination rather
  than a new color.
- No change to tab order, semantics, or ARIA — this pass touches CSS and a
  handful of size/prop values only.

## Non-goals

- No new props, slots, or data on any component.
- No behavior change to any button, link, or action.
- No changes to `PublicProfilePage.vue`'s `<script>` block, `ClaimHandleSheet`,
  or any service/store.
- No reputation stats, themes, activity feed, quick-action buttons, or
  multi-asset support — those are separate, larger projects (see
  `2026-07-14-public-profiles-and-pay-links-design.md` for the ecosystem
  direction if pursued later).

## Testing

- `PublicSurface.test.ts`'s light-only-guard test (asserting hardcoded
  `--text`/`--text-2`/`--border` regardless of theme) is replaced with a test
  asserting the shell defines both a light-mode token set and a
  `prefers-color-scheme: dark` override block (source-level check, consistent
  with the existing source-matching style in that file). Other tests in that
  file and `PublicProfilePage.test.ts` assert structure/slot presence, not
  exact colors — continue passing unchanged.
- Manual review checklist (screenshot-based): all four public pages
  (`PublicProfilePage`, `PublicPayLanding`, `PublicProfileLanding`,
  `OpenInNimiqPayLanding`) × light mode × dark mode × desktop width × mobile
  width (~320px and ~390px), confirming no layout shift/overflow from the
  larger identicon/QR sizes and that focus-visible outlines are checked on
  at least one button per page in each theme. Add one extra case: a profile
  with a long handle and/or long display name, to check header wrapping and
  spacing don't break.
- No new automated visual regression tooling — out of scope for this pass.
