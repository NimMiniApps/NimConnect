# Desktop public profile lookup — design

Date: 2026-07-16
Status: approved

## Goal

On the desktop NimConnect handoff (`OpenInNimiqPayLanding` with
`allowBrowserContinue === false`), keep Nimiq Pay as the primary path while
letting someone paste an `@handle` or Nimiq address and jump to the existing
public profile page when a claimed handle exists.

## Chosen approach

**Lookup strip on the existing desktop handoff** — not a directory home, not a
separate `/lookup` route. Primary CTA remains **Open in Nimiq Pay**. A quiet
secondary block accepts `@handle` or address, resolves via existing APIs, and
navigates to `/u/:handle` on success.

## Layout (desktop only)

1. Existing masthead / brand / tagline
2. Body copy: best inside **Nimiq Pay** on phone; on desktop you can still open
   payment/profile share links **or look up public `@handles`**
3. Primary: **Open in Nimiq Pay**
4. Secondary lookup block:
   - Label: **Look up a public profile**
   - Input placeholder: `@handle or Nimiq address`
   - Button: **Look up**
5. Existing store links and footer

Mobile handoff (`allowBrowserContinue !== false`) is unchanged — no lookup UI.

## Lookup behavior

```text
submit → classify input
  handle  → resolveHandle(handle)
  address → handleForAddress(address)
  neither → inline “Enter an @handle or Nimiq address”

null  → “No public @handle found”
error → “Lookup failed — try again”
claim → router.push(`/u/${claim.handle}`)
```

- Normalize handles (strip leading `@`) and validate addresses with existing
  `ValidationUtils` helpers before any network call.
- Disable input/button while a lookup is in flight.
- Do not fetch profile content on the landing; `/u/:handle` owns that.

## Component boundaries

- UI and local state live in `OpenInNimiqPayLanding` (desktop branch).
- Reuse `resolveHandle` and `handleForAddress` from `src/services/handles.ts`.
- Small classify/normalize helper (local or next to handles service) — no new
  backend endpoints.

## Non-goals

- Profile directory / browse-all
- Public page for address-without-handle
- Changes to mobile handoff, `/u/:handle`, pay, or shared-profile landings
- New APIs or authenticated-app changes

## Testing

- Desktop landing shows lookup; mobile handoff does not.
- Valid `@handle` or address with a claim → navigates to `/u/:handle`.
- Invalid input / unknown handle or address → stays on landing with the right
  message.
- Existing public-landing tests continue to pass.
