# Profile sharing layout design

## Goal

Make the in-app profile page feel like one coherent identity surface. Sharing
should remain quick, but QR sharing, public-page sharing, and handle state must
not each consume a permanent card on the page.

## Chosen layout

The owner profile keeps its identity details and primary `Edit profile` action
in `ProfileView`. The existing standalone QR card is removed. A compact
secondary `Share profile` action sits directly below the primary edit action,
so sharing is discoverable without competing with profile management.

Selecting `Share profile` opens an action sheet:

- The QR code is the primary quick, in-person sharing method.
- The sheet includes a share/copy action for the full NimConnect profile link.
- When the owner has a claimed handle, it also includes a share/copy action
  for the public `@handle` page.
- Feedback remains local to the action that completed (for example, `Link
  copied`).

The profile page owns the public-handle state. An existing handle appears as a
small `@handle` identity line in the profile header. It is not a standalone
card. When no handle exists, the page offers a compact `Claim @handle` row
below the profile actions; claiming itself remains in the existing sheet.

## Component responsibilities

- `ProfileView` owns the own-profile visual hierarchy and emits a `share`
  event. It does not need to know handle or public-page state.
- `MyProfilePage` owns the share action sheet because it already fetches the
  handle, creates the public URL, and presents `ClaimHandleSheet`.
- The share sheet reuses the existing QR, share/copy, public-link, and handle
  service functions. No payload, wallet, or public-page behavior changes.

## Interaction and states

- QR sharing always works for an existing local profile.
- The public-page action appears only after a handle has been claimed.
- A confirming handle retains its confirmation hint, but it is compact and
  adjacent to its `@handle` identity line.
- A user without a handle sees the existing explanatory claim copy only after
  choosing the compact claim row, keeping the default page concise.

## Accessibility and responsive behavior

- The new secondary action has a 44 px minimum hit target and visible keyboard
  focus.
- The share sheet uses existing `ActionSheet` focus, safe-area, and dismissal
  behavior.
- Long URLs remain contained in the sheet and do not widen the profile page.

## Testing

Add focused component/page coverage for the owner-profile hierarchy: the
standalone QR card is absent, `Share profile` is available, and public sharing
is offered only for a claimed handle. Run the focused test plus the existing
frontend build and test suite.

## Non-goals

- Changing the QR/profile-link payload format.
- Changing handle claim or confirmation behavior.
- Redesigning contact profiles or the external public profile page.
