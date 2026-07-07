# NimConnect — MVP Design

**Date:** 2026-07-07
**Status:** Approved for planning
**Context:** Competition entry for the Nimiq Pay Mini App framework. Must be a polished, working product — not a demo — and lay real foundations for growing into the identity/relationship layer of the Nimiq ecosystem.

## Product concept

NimConnect is a **relationship manager for your wallet**, not a contacts app. Every wallet address becomes a **Profile** — yourself, a friend, a merchant, a charity, an event. The MVP ships as a polished contact manager with live payments, but every naming, model, and UI decision is Profile-oriented so later capabilities (messaging, invoices, reputation, communities) attach to Profiles rather than becoming separate modules.

## MVP scope

### Screens (bottom nav: Contacts / Profile)

1. **Contacts (home)**
   - Search bar with smart search across name, address, notes, tags (case-insensitive, in-memory filter).
   - Sections: **Recent** (profiles with `lastInteractionAt`, most recent first, capped ~5) → **Favorites** → **All** (A–Z).
   - Rows: identicon, name, shortened address, favorite star. FAB to add.

2. **Profile details** (any profile, rendered by a reusable `ProfileView` component)
   - Rich header: large identicon, name, full address (tap-to-copy), favorite toggle, tags, date added, last interaction (when set).
   - **Live actions:** Send Money (SDK `sendBasicTransaction`), Request Payment (`nimiq:` link + QR via `@nimiq/utils`), History (transactions between you and this profile).
   - **Disabled future actions** (visually present, greyed): Split Bill, Invoice, Tip, Message.
   - Notes section (private).
   - Send/Request/History update `lastInteractionAt`.

3. **Add / Edit profile**
   - Fields: name, address (paste or QR scan via camera), notes, tags (free-form with autocomplete from existing tags), favorite, type.
   - Address validated with `@nimiq/utils` `ValidationUtils`, normalized, duplicates rejected. Identicon previews live as the address becomes valid.
   - QR scan degrades gracefully to paste if camera is unavailable in the webview.

4. **Profile (own)** — same `ProfileView`, self flavor
   - The user's own profile: identicon, wallet address from `listAccounts()`, editable display name, shareable QR others can scan to add you.
   - This page is the seed for future identity features (bio, socials, verification, messaging keys) — hence "Profile", not "Me".

5. **Settings** (lightweight sheet/page, reachable from Profile)
   - Import / Export JSON, About, version, GitHub link, licenses. Kept separate so Profile stays identity-focused.

### Import / Export

Export document (not a bare array):

```json
{
  "app": "NimConnect",
  "version": 1,
  "exportedAt": 1730000000000,
  "profiles": [ ... ]
}
```

Import validates `app`/`version`, migrates old versions forward, skips duplicates by address (report count to user).

## Data model

One `Profile` type; the user's own record lives in the same table flagged `isSelf`, so `ProfileView` renders anything.

```ts
interface Profile {
  id: string            // crypto.randomUUID()
  address: string       // normalized NQ.., unique index
  name: string
  type: 'person' | 'business' | 'merchant' | 'other'  // default 'person'
  isSelf: boolean       // exactly one true record (created on first SDK connect)
  notes: string
  tags: string[]        // plain strings for MVP; richer tags (color/icon) come via a tags table + migration later
  favorite: boolean
  createdAt: number
  updatedAt: number
  lastInteractionAt?: number  // set by Send/Request/History; powers Recent + future smart sorting
}
```

- **No generic `meta` blob.** Future fields (bio, website, github, x, verified, messagingPublicKey…) are added as typed columns through Dexie's versioned migrations.
- **No stored avatar** — identicons are derived from the address, always.
- Tags feed an `allTags` computed getter for autocomplete; no tag table in MVP.

## Architecture

```
src/
  pages/        ContactsPage, ProfileDetailsPage, ProfileFormPage, MyProfilePage, SettingsPage
  components/   ProfileView, ProfileRow, Identicon, TagChips, QrScanner, QrCode,
                ActionButton, SearchBar, EmptyState…
  stores/       profiles.ts   ← single source of truth; all CRUD goes through here
  services/     nimiq.ts (SDK init/accounts/send), history.ts (tx list), links.ts (request links)
  db/           db.ts (Dexie schema v1 + future migrations)
  types/        profile.ts
```

- **Pinia `profiles` store** is the app's API: `add / update / remove / toggleFavorite / touchInteraction / search`, backed by Dexie `liveQuery` so UI always reflects IndexedDB. Cloud sync later is another consumer of the same store/db — no interface ceremony now.
- **`services/nimiq.ts`** wraps `@nimiq/mini-app-sdk` `init()` with a not-inside-Nimiq-Pay fallback: in a plain browser the app runs fully (judging/dev), and Send shows a friendly "open in Nimiq Pay" state.
- **`services/history.ts`** fetches transactions between the user and a profile via the provider RPC, falling back to a public explorer API if needed; results cached per profile for offline viewing.
- **Offline:** everything except Send/History works offline by construction.

## Dependencies (all official or tiny)

`@nimiq/mini-app-sdk`, `@nimiq/utils`, `@nimiq/identicons`, `dexie`, `pinia`, `vue-router`, `qrcode` (render), `barcode-detector` polyfill or `qr-scanner` (scan; native `BarcodeDetector` where available). Vue 3 + TypeScript + Vite.

## Design language

Nimiq's identity, not generic crypto: radiant gold/blue palette, soft rounded cards, Mulish-style typography, identicons as the visual signature. Mobile-first, light/dark aware, touch targets ≥ 44px, bottom nav, skeleton loading states, subtle micro-transitions. Should feel like a native Nimiq Pay tab.

## Testing

Vitest unit tests for load-bearing logic only: store CRUD + duplicate rejection, smart search, import/export round-trip (including version migration path), address normalization. No E2E for MVP.

## Risks & containment

| Risk | Containment |
|---|---|
| `@nimiq/mini-app-sdk` is v0.1.0, API may shift | All SDK contact isolated in `services/nimiq.ts` |
| Provider RPC may not expose tx-by-address | `services/history.ts` isolates it; explorer API fallback; History degrades to hidden if neither works |
| Camera blocked in Nimiq Pay webview | QR scan degrades to paste-address, which always works |

## Future phases (context, not scope)

Phase 2: richer own-Profile (bio, socials, share links), cloud sync (per-record `updatedAt` already supports last-write-wins). Phase 3: payment requests with amounts, split bills, invoices, tips, merchant profiles. Phase 4: E2E messaging. Phase 5: verification, reputation, communities. All attach to the Profile model — no separate modules.
