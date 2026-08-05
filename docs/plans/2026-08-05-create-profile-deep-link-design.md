# Create Profile Deep Link Design

## Goal

Give people and ecosystem apps one memorable URL that opens NimConnect at the
profile-creation flow instead of the generic home page, in both a normal browser
and Nimiq Pay.

## Public contract

- Browser: `https://nimconnect.nimiqminiapps.com/#/create-profile`
- Nimiq Pay: `https://nimpay.app/miniapps/open/nimconnect.nimiqminiapps.com#/create-profile`

`/create-profile` is a semantic entry route, not a second profile editor. It
forwards to the existing `/me?sheet=claim` flow. A user without a handle sees
the claim sheet directly; a user who already owns a handle sees their existing
identity page and is not prompted to claim another.

## Implementation

Add a Vue Router redirect for `/create-profile`. Centralize the browser and
Nimiq Pay URLs in the host-app configuration so callers do not assemble route
hashes themselves. Update the existing public-profile acquisition CTA to use
the canonical Nimiq Pay URL.

The desktop shell needs no new identity UI: the redirect resolves to `/me`,
which already selects the desktop identity page outside Nimiq Pay. Inside
Nimiq Pay, `/me?sheet=claim` already opens the standalone claim sheet when no
handle exists.

## Verification

Automated tests must prove that:

- `/create-profile` redirects to `/me?sheet=claim`;
- both public URL constants contain the canonical route; and
- the public-profile CTA uses the centralized Nimiq Pay create-profile link.

Run the focused tests first, then the complete frontend test suite and build.
