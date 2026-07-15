# NimConnect public-surface system design

Date: 2026-07-15
Status: approved

## Goal

Make every logged-out NimConnect route feel like one product. Public `@handle`
profiles are the canonical expression; shared-profile links and public payment
requests use the same structure with only the identity and action content
changed.

The redesign must preserve existing routes, request payloads, wallet deep
links, public API calls, and browser/Nimiq Pay handoff behaviour.

## Chosen approach

Use one reusable mobile-first public-surface shell for:

- `PublicProfilePage` (`/u/:handle`)
- `PublicProfileLanding` (shared profile import links)
- `PublicPayLanding` (public payment requests)
- `OpenInNimiqPayLanding` (generic non-wallet handoff)

The shell presents a compact NimConnect masthead, an identity block, one
focused action panel, a primary action, grouped secondary actions, and a quiet
trust footer. Variants provide their own title, identity details, action-panel
content, and action set.

## Layout

```text
NimConnect · Public profile / Payment request

identity block
identicon · name · @handle · bio
links and tags when available

action panel
Send NIM / Pay amount / Add contact
QR
address + Copy address
verification or request detail

primary action
grouped secondary actions

Shared via NimConnect trust footer
```

The public profile is the richest variant: name, handle, bio, public links,
tags, verified chain claim, and a `Send NIM` action. A shared profile keeps the
same identity hierarchy without a handle or verification row. A payment
request uses recipient identity and puts amount and message at the top of the
action panel. The generic landing keeps the same masthead and action grouping,
but replaces identity and the action panel with the Nimiq Pay handoff message.

## Visual system

- Use Nimiq ink blue (`#1f2348`) as the outer public canvas and high-contrast,
  soft-blue-tinted content surfaces for reading.
- Retain Mulish for interface copy and the existing mono font token for
  addresses and verification data.
- Reserve the existing gold gradient for one primary action only. Wallet/open
  actions use blue; lower-priority actions use a neutral outlined treatment.
- Use one confident, rounded action sheet with a restrained blue edge/light;
  do not stack unrelated card styles.
- Standardize tags, external links, address-copy controls, QR framing,
  verification rows, store links, and footer language across variants.
- Keep movement limited to a short load/reveal transition when motion is
  allowed. Preserve keyboard focus visibility and honour reduced motion.

## Component boundaries

- A shared presentational public-shell component owns page width, safe-area
  padding, masthead, visual layers, footer, and the common action layout.
- Small shared presentational primitives own address copy, action buttons,
  external links, and app-store choices where practical.
- Existing route components retain all data fetching, parsing, retry, copying,
  and deep-link logic. They supply slots or props to the shared system rather
  than moving route behavior into a visual component.
- `App.vue` keeps the current routing and host-app handoff decisions unchanged.

## States and accessibility

Loading, unclaimed, indexing, pending-confirmation, and error states render
inside the public shell with the same masthead and footer. Retry is the only
prominent action in those states. Long addresses wrap safely, action controls
meet a 44 px minimum target, and all interactive controls have visible focus.

## Testing and verification

- Add focused component tests for shared shell structure and variant-specific
  content: handle verification only on public handles, no handle rows on shared
  profiles, and payment amount/message retained on public payment requests.
- Keep current link and parsing service tests as regression coverage for route
  behavior.
- Run the focused UI tests, full test suite, and production build.

## Non-goals

- Change profile or payment-link encoding.
- Change public-handle resolution, profile publishing, or Nimiq Pay routing.
- Add new public data fields or a new design system for authenticated screens.
