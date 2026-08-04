# Marketplace Buy Confirmation Polish

## Goal

Turn the bare marketplace purchase screen into a trustworthy Nimiq-styled confirmation surface without changing the reservation, escrow, or settlement protocol.

## Design

The page uses one centered confirmation card. A back link and compact marketplace label provide context; `@handle` and the NIM amount form the primary hierarchy. A connected-wallet row makes the buyer identity explicit.

A three-step explanation states what happens after reservation: the buyer funds escrow, the seller releases the handle, and the buyer claims it before the seller is paid. A restrained escrow notice clarifies that clicking the primary action reserves the listing but does not transfer funds yet.

The gold gradient is reserved for the full-width primary action. Existing project variables, Nimiq radii, Muli typography, and the dark theme's text/border tokens remain the source of truth. The layout collapses cleanly below 560px and preserves visible keyboard focus.

## States

- Loading: card-shaped skeleton rather than unstyled text.
- Available: price, buyer identity, escrow steps, and `Reserve @handle` action.
- Disconnected: same context with a `Connect wallet to continue` action.
- Unavailable: clear message with a route back to the marketplace.
- Error: inline accessible alert that preserves the existing Hub/backend error semantics.
- Submitting: disabled CTA labeled `Reserving…`.

## Testing

Component tests assert the new hierarchy, escrow explanation, connected wallet summary, back navigation, CTA copy, loading/unavailable states, and unchanged reservation behavior. The focused test file, full frontend test suite, type-check, and production build form the verification gate.
