# Desktop Identity Portal — Design

Date: 2026-07-17
Status: Direction approved; MVP scope resolved below — implementation not yet started.

## Resolved MVP (review 2026-07-17)

Direction is approved. Before implementation, the open questions from
review were resolved as follows:

1. **Desktop wallet provider: Nimiq Hub (`@nimiq/hub-api`), not Nimiq Pay.**
   Nimiq Pay's `@nimiq/mini-app-sdk` only injects `window.nimiq` inside the
   Nimiq Pay app shell (`src/services/nimiq.ts:66`) — it's unreachable from a
   plain desktop browser. Nimiq Hub is already the documented alternative
   signing path for this exact protocol: `docs/api/handle-claim-protocol.md:53`
   names Hub's `checkout` as the raw-binary claim transaction path. Desktop
   uses Hub for:
   - **Account discovery** — Hub `chooseAddress` (or `list`), one connected
     address at a time. No multi-account address book on desktop.
   - **Claim** — Hub `checkout` with `extraData` = the raw binary claim
     payload from `buildHandleClaimPayload()`, `value: 0`.
   - **Publish** — Hub `signMessage` over the challenge NimConnect's backend
     issues; verified server-side against the profile address
     (`backend/auth.go:29`), same as the Mini App's publish flow.
   - No other Hub operations (send, iframe overlays, login) are used.
     Unsupported browsers/extensions get a plain "install/open a Nimiq Hub
     compatible wallet" message — no silent fallback to Nimiq Pay.

2. **Claiming and publishing are wallet operations, not payments.**
   Both routes to Hub above are framed in the UI as "authorize your
   identity," with an explicit account-selection and confirmation step —
   not hidden behind "Connect Wallet" as if it were passive login. The
   philosophy ("desktop is for identity, not payments") describes what the
   transactions *are for*, not that no transaction occurs.

3. **No avatar upload in MVP.** Public identities only carry name, bio,
   website, GitHub, X, and tags (`docs/api/public-profile-read.md:56`);
   avatars are deterministic identicons. Upload requires storage, a content/
   moderation policy, a signed schema extension, and cache/deletion handling
   — out of scope for the first release. Desktop shows the same identicon
   as everywhere else. "Upload/change avatar" is removed from MVP scope
   (tracked under long-term roadmap instead).

4. **No profile browser/directory in MVP.** Existing public lookup is
   intentionally exact-match only, by design
   (`docs/plans/2026-07-16-desktop-public-lookup-design.md:7`). Browsing by
   display name, tags, or category needs an index, discoverability consent,
   ranking, and abuse controls — a separate product decision. MVP desktop
   lookup is **exact @handle or address only**, same contract as today.
   "Browse public profiles" moves to long-term roadmap.

5. **Separate desktop shell, not the existing mobile shell reused.** The
   current app is a single mobile-oriented shell that redirects non-public
   desktop visits to a handoff page (`src/App.vue:234`). Desktop identity
   gets its own shell and route allowlist — `/`, `/lookup` (or `/u/:handle`),
   `/me` (My Identity), `/about` — so contacts, activity, buckets, invoices,
   etc. are never reachable from a desktop URL, not even accidentally.

6. **Ownership/recovery flow is explicit.** The public profile is keyed by
   the signed wallet address; a handle can also be attributed via the HTLC
   path Nimiq Pay uses. On desktop: connecting a Hub account first checks
   whether that address already resolves to a handle/profile
   (`resolveHandleByAddress`) and if so loads it for editing — it does not
   create a second identity. Later opening Nimiq Pay with the same address
   hydrates the same remote profile; local Mini App relationship data
   (contacts, activity) is never merged with or overwritten by the desktop
   edit.

7. **"Payment pages" = the existing public profile page, not payment
   requests.** Desktop's "view/share/QR/copy link" scope is `/u/:handle`
   (`docs/plans/2026-07-17-desktop-identity-portal-design.md:176` in the
   original draft). Standalone payment-request links are a separate surface
   and are not part of this feature.

**MVP feature list**, superseding the broader lists below where they conflict:

- Desktop shell: Home, Lookup, My Identity, About.
- Nimiq Hub as the only desktop signing provider (chooseAddress, checkout,
  signMessage).
- Exact @handle / address lookup only — no directory, no name search.
- Claim handle, edit the six existing public fields, per-field visibility,
  live preview, share, identicon (no upload).
- Explicit connected-address display and existing-identity recovery on
  connect.
- No payment execution, no request/invoice pages.

Everything below this section is the original proposal; where it lists
avatar upload, profile browsing/search, or a fuller nav, treat those as
long-term roadmap, not MVP, per the resolution above.

## Goal

Expand NimConnect beyond a mobile-only Mini App by introducing a desktop web experience focused on **identity**, not payments.

The Mini App remains the primary place for wallet interactions (payments, requests, split bills, buckets, contacts), while the desktop site becomes the place where users create and manage their public identity.

The objective is to make claiming a Nimiq identity as frictionless as possible and encourage adoption across the entire ecosystem, including developers and users who primarily interact on desktop.

---

## Philosophy

NimConnect should not become another desktop wallet.

Instead it becomes:

**The identity portal for the Nimiq ecosystem.**

Desktop is for identity management.

Nimiq Pay remains the place for everyday payments and relationship management.

Claiming a handle and publishing a profile still require wallet
authorization and on-chain operations (see [Resolved MVP](#resolved-mvp-review-2026-07-17)
— Hub `checkout`/`signMessage`), so desktop is not "wallet-free." It simply
isn't intended to replace payment flows.

---

## Primary desktop use cases

Users should be able to:

- Connect a supported desktop wallet.
- Claim an @handle.
- Edit their public profile.
- Upload/change avatar.
- Manage public fields.
- Preview their public profile.
- Share their public profile.
- Browse public profiles.
- Resolve @handles.
- Explore payment pages.

Users should NOT be expected to manage contacts, split bills, buckets, payment requests or perform normal wallet operations from desktop.

---

## Wallet support

Add desktop wallet authentication.

Examples (depending on ecosystem support):

- Browser wallet extension
- WalletConnect-like flow
- Existing Nimiq signing flow
- Any supported desktop signing provider

The desktop site should authenticate ownership of the wallet in the same secure manner as the Mini App.

No private keys are ever handled by NimConnect.

---

## Desktop navigation

Desktop navigation should be intentionally small, and split by auth state
(MVP scope — see [Resolved MVP](#resolved-mvp-review-2026-07-17)):

Public:

- Home
- Lookup (exact @handle or address — not a directory)
- About
- Public profile page (`/u/:handle`)

Authenticated (via Nimiq Hub):

- My Identity — claim handle, edit profile, per-field visibility, live preview, share

Do NOT duplicate the full Mini App navigation. "Profiles" as a browsable
nav item is long-term roadmap, not MVP — MVP only ever resolves one exact
handle/address at a time.

---

## Home page

The homepage should market identity, not contacts.

Hero:

Claim your Nimiq identity.

Subtext:

Create a permanent @handle, public profile and payment page that works across the Nimiq ecosystem.

Primary CTA:

Connect Wallet

Secondary CTA:

Open in Nimiq Pay

Below:

Benefits

• Permanent @handle
• Public payment page
• Developer profile
• Works across Mini Apps
• Privacy-first

---

## My Identity

This becomes the desktop equivalent of the Profile page.

Features:

- Avatar
- Display name
- @handle
- Bio
- Website
- GitHub
- Public tags
- Visibility toggles
- Live public profile preview
- Save

Exactly the same privacy model as the Mini App.

Public Identity

vs

Private Relationship

Relationship-only data never appears on desktop.

---

## Public profile preview

The preview should update live while editing.

Changing visibility immediately updates the preview.

Opening "View live" opens the real public page.

Desktop editing should feel better than mobile for writing bios, adding websites and managing identity.

---

## Public profile browser

Allow browsing public profiles.

Search by:

- @handle
- Display name

Future:

- Tags
- Developer profiles
- Merchants

The browser should encourage discovery.

---

## Payment pages

Public payment pages remain accessible.

Desktop users can:

- View payment pages.
- Scan QR.
- Copy payment links.

Payment execution still hands off to Nimiq Pay or another supported wallet.

---

## Things intentionally NOT on desktop

Do not implement:

- Contacts
- Payment history
- Split bills
- Buckets
- Tips
- Requests
- Invoices
- Activity
- Relationship management

Those remain Mini App experiences.

Desktop should stay focused.

---

## UX principles

Desktop should feel like:

GitHub profile management

or

Linktree

or

PayPal.me

NOT like a crypto wallet.

Identity first.

Payments second.

---

## Ecosystem vision

Every Mini App should be able to resolve:

@handle

↓

Wallet address

↓

Avatar

↓

Public profile

↓

Website

↓

GitHub

↓

Public tags

NimConnect becomes the canonical public identity provider for the Nimiq ecosystem.

---

## Marketing

The desktop site should market:

Claim your @handle.

NOT

Manage contacts.

Identity is much easier to explain than relationship management.

The relationship features remain a reason to install the Mini App after users have claimed their identity.

---

## Long-term roadmap (not MVP)

Possible future additions:

- Public profile analytics
- Profile verification
- Profile themes
- Social links
- Organization profiles
- Merchant pages
- Creator donation pages
- Mini App integrations using NimConnect identity
- Public identity API

These are explicitly out of scope for the first desktop release.

---

## Success criteria

A completely new user should be able to:

1. Visit the desktop site.
2. Connect a wallet.
3. Claim an @handle.
4. Create a public profile.
5. Share that profile.
6. Later install Nimiq Pay and immediately have the same identity available.

Desktop becomes the easiest onboarding path into the NimConnect ecosystem while the Mini App remains the primary place for everyday payments and relationship management.
