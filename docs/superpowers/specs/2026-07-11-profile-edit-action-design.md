# Profile Edit Action Design

## Goal

Make editing the user's own profile immediately discoverable on the Profile screen.

## Design

- Show a full-width `Edit profile` button directly below the identity card and before the QR-code card.
- Include a small pencil glyph before the label.
- Use the Nimiq light-blue gradient, white text, and the existing pill radius. Gold remains reserved for payment and transaction actions.
- Use a 48px minimum height, visible keyboard focus, and restrained pressed feedback.
- Remove the existing text-only `Edit` link from the bottom of the user's profile.
- Keep the existing management controls unchanged for contact profiles, including `Edit` and `Delete`.

## Behavior

The button emits the existing `edit` event. Routing and profile form behavior remain unchanged.

## Responsive and Accessibility Requirements

- The button spans the available content width at mobile and desktop sizes.
- The control uses a native `button` element and retains an explicit text label.
- Keyboard focus must be visible against the dark page background.
- The pressed state must not cause surrounding content to shift.

## Verification

- Add a component-level assertion if the current test setup supports `ProfileView` rendering without disproportionate mocking.
- Run the complete unit-test suite and production build.
- Inspect the Profile screen at a mobile viewport to confirm placement, contrast, and bottom-navigation clearance.
