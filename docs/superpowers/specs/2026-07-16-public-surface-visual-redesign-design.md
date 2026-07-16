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
- Primary action button uses `--nimiq-gold-bg` (gradient, matches `.nq-button`
  elsewhere in the app) instead of flat `var(--public-gold)`.
- Secondary action button uses `--nimiq-light-blue-bg` gradient instead of
  flat `var(--public-blue)`; the existing `.public-action--outline` variant is
  unchanged (still transparent/bordered).
- Canvas background becomes a subtle radial gradient (reusing the
  `--nimiq-blue-bg` gradient family at low opacity) instead of the flat
  white-to-soft-blue linear gradient, for a less "generic SaaS card" feel.
- No layout/structural change: same grid, same slot regions, same responsive
  breakpoints.

### 2. Sizing bump (shell + consumers)

- Identicon/avatar size in the `identity` slot goes from 64–80px to 96px
  across all four consumers (one prop value change per file, no markup
  change).
- QR code size goes from 200–220px to 260px (`PublicProfilePage`,
  `PublicPayLanding`, `PublicProfileLanding`).
- Headline (`h1`) font-size increases one step in the type scale for more
  hero presence.

### 3. Hero polish — `PublicProfilePage.vue` only

- The existing "✓ Handle verified on the Nimiq chain" link is restyled as a
  small pill/badge (background tint using `--nimiq-green`, existing
  `--nimiq-radius-pill` token) sitting directly under the handle, instead of
  a plain underlined link. It remains a link to the explorer; behavior
  unchanged, only visual treatment.
- The identity section gets a soft radial glow behind the avatar (CSS
  `::before` pseudo-element, decorative, `aria-hidden` via no interactive
  content) — no new DOM elements beyond what pure CSS requires.

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

- Existing `PublicSurface.test.ts` and `PublicProfilePage.test.ts` assert
  structure/slot presence, not exact colors — should continue passing
  unchanged; extend only if a test asserts a removed CSS custom property name.
- Manual check: all four public pages in light and dark OS theme, mobile and
  desktop width, confirm no layout shift/overflow from the larger
  identicon/QR sizes.
- No new automated visual regression tooling — out of scope for this pass.
