# Public surface identity-first overhaul — Design

Date: 2026-07-23
Status: approved

## Goal

Make the four logged-out public surfaces feel like a polished, screenshot-worthy
product: identity leads, pay/actions follow, one shared visual language. This is
a composition overhaul on top of the July 16 token/dark-mode pass — not new data,
backend, or routes.

## Design read

Redesign-overhaul of NimConnect public surfaces for people opening shared links,
with an identity-first Nimiq product language, leaning on the existing Nimiq UI
Kit tokens in `main.css`.

Dials: `DESIGN_VARIANCE 7` / `MOTION_INTENSITY 5` / `VISUAL_DENSITY 3`.

## Decisions

| Decision | Choice |
|---|---|
| Mode | Overhaul composition; preserve Nimiq tokens and slot API |
| Primary job | Identity first; pay is the clear next step |
| Scope | All four public surfaces |
| Desktop | Desktop-light: same stack + one pay-band row upgrade |
| Approach | Full-bleed identity stage (drop nested card-in-card) |

## Surfaces in scope

Shared shell `PublicSurface.vue` for:

1. `PublicProfilePage.vue` — `/u/:handle`
2. `PublicProfileLanding.vue` — shared contact import
3. `PublicPayLanding.vue` — payment request
4. `OpenInNimiqPayLanding.vue` — add / handoff

Also restyle dependents that sit in the shell chrome: `PublicAddressCopy.vue`,
`PublicStoreLinks.vue`, and tests that assert sizing/layout/theme.

## Shell composition

Remove the nested heavy panel card as the visual center. The page itself is the
canvas:

```text
[ blue gradient atmosphere (--nimiq-blue-bg) ]
  content column (--bg, full height, soft radius)
    masthead: NimConnect + context pill
    identity stage (hero)
    pay / action band (soft, not a competing card)
    primary / secondary / tertiary CTAs
    quiet footer
```

- Keep slot names: `identity`, `panel`, `primary`, `secondary`, `tertiary`, `footer`.
- Keep `context` and `actionsEnabled` props.
- Content column: `min-height: 100dvh` (minus safe-area padding), max-width
  ~26rem mobile / ~32–36rem desktop.
- Soft radius lock: shell ~20px, controls ~14px, pills for tags/links.
- No parallel `--public-*` palette; continue using app tokens.

### Desktop-light (`min-width: 48rem`)

Same vertical order. One upgrade only: in the pay band, QR sits beside the
label + address + verified column (row layout). No asymmetric page split.

## Identity stage

Order:

1. Identicon — 96px mobile, 112px desktop; soft gold glow (token-based)
2. Display name as H1 (or `@handle` if no distinct name)
3. `@handle` in gold when name is distinct
4. One short purpose line on public profile only
5. Bio (if any), then links, then tags

Per-surface hero focus:

| Surface | Hero |
|---|---|
| Public profile | Person + `@handle` |
| Shared contact | Name + bio/tags |
| Payment request | Identicon + “{label} requests a payment”; amount lives in the pay band |
| Handoff | NimConnect mark + “People, not wallet addresses.” |

No section-number eyebrows, scroll cues, or decoration strips. Context stays in
the masthead pill only.

## Pay band + CTAs

Former `#panel` becomes a soft band (`--card` tint or hairline), not a heavy
elevated card.

Band order: label → QR → scan hint → address copy → verified (profile only).

Payment request: amount is the band headline; message under it; then QR/address.
Handoff: same band chrome, lookup / open-Pay content inside.

QR: ~200px mobile, ~240px desktop; `max-width: 100%`.

CTAs:

- Primary: gold `.nq-button` (July 16 AA text color)
- Secondary: light-blue `.nq-button` + outline “Add to NimConnect”
- Tertiary: store links under a hairline
- Primary CTA must remain reachable in the first viewport with identity visible
- Touch targets ≥44px; focus-visible keeps `--nq-light-blue` ring

Loading / not-found / error stay in the panel slot; `actionsEnabled` behavior
unchanged.

## Motion, theme, a11y

- Enter: short fade/rise on the content column (~180ms)
- Identity: light first-paint stagger (identicon → title → meta)
- Pay band: one-time reveal when entering view (CSS or Motion; no scroll listeners)
- `prefers-reduced-motion`: instant, no stagger
- Theme: follow `prefers-color-scheme` via existing `main.css` tokens; no mid-page inversion
- Keep July 16 `.nq-button` contrast fixes

## Copy

- Replace em-dashes in footers with hyphens or periods
- One browser-continue label (“Open NimConnect in the browser”)
- Keep surface-specific primary labels (“Send in Nimiq Pay” vs “Pay with Nimiq Pay”);
  no duplicate intents on one page

## Out of scope

- New profile fields, reputation, themes, activity feeds
- Backend / public API changes
- Desktop identity portal (`Desktop*` pages)
- Route / IA changes (`/u/:handle` stays)
- Script/data contract rewrites beyond template class and size props

## Success criteria

- Opening `/u/:handle` reads as a person first, pay second
- All four surfaces share one shell language
- First viewport shows identity + primary CTA without hunting
- Light and dark modes both pass AA on CTAs and body text
- Existing slot/prop contracts and public links keep working
