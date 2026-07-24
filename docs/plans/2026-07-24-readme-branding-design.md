# NimConnect README branding design

## Goal

Give the NimConnect README the same polished branded opening as NimBomber
without restructuring or weakening NimConnect's existing documentation.

## Design

Replace the plain top-level title and introductory link line with:

1. The corrected 1500 × 500 NimConnect header at full README width.
2. The compact NimConnect logo centered below it.
3. A centered product description that preserves the current positioning.
4. Centered links to the live app, Nimiq Pay launch route, catalog listing,
   and backend documentation.
5. A divider before the existing "What it is" section.

The existing features, development, deployment, architecture, and license
sections remain structurally unchanged. Add a short final brand-assets section
that points contributors to the source pack and its generation instructions.

## Asset paths

- Header: `assets/header-1500x500.png`
- Logo: `assets/nimconnect-logo-full.png`
- Asset guide: `assets/README.md`

All references use repository-relative paths so they render on GitHub and in
local Markdown previews.

## Verification

- Confirm every README-local link and image target exists.
- Confirm the README no longer has a duplicate top-level Markdown heading.
- Inspect the opening markup for parity with NimBomber's centered structure.
- Run the repository's Markdown/link checks if one exists.
