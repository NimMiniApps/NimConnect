# NimConnect

A digital identity and relationship manager for Nimiq — a Nimiq Pay Mini App.

**Live:** https://nimconnect.nimiqminiapps.com · **GitHub Pages demo:** https://nimminiapps.github.io/NimConnect/

People don’t remember addresses; they remember people. NimConnect turns wallets into
**profiles** you can recognize, pay, and share — while keeping private notes and
relationship data on your device.

Open it inside **Nimiq Pay** for live Send and wallet features. In a normal browser you
can still manage contacts, backups, and public pages.

## What it is

NimConnect answers four questions:

1. **Who am I?** — your public identity (`@handle`, bio, links)
2. **Who do I know?** — contacts with notes that never leave the device
3. **How do we pay?** — send, request, tip, split, invoice
4. **How do we save together?** — shared trip buckets

Public identity and private relationship are separate on purpose. You choose what
appears on your public page; notes, private tags, and contact history stay local.

## Features

### Identity
- Claim an on-chain `@handle` and publish a public profile
- Live preview while editing — toggle fields Public / Private
- Share via QR, link, or “Open live” public page (`/@handle`)
- Verified status when your handle is confirmed

### Relationships
- Contacts with Nimiq identicons, favorites, tags, and private notes
- Adaptive lists: Favorites → Recently active → Everyone
- Import public info when adding someone by address or `@handle`
- Scan QR codes for addresses, pay links, profiles, and invoices

### Payments
- Send NIM with an optional message (inside Nimiq Pay)
- Request payment via `nimiq:` link + QR
- Tips, split bills (equal or custom), tracked invoices
- Home activity for recent incoming payments

### Shared trips
- Buckets with goals, contribution QR/links, and progress
- Mark complete when the group hits the target

### Privacy & backup
- Local-first IndexedDB storage; works offline for contacts
- Encrypted local export/import
- Optional signed cloud backup (API + Nimiq Pay signature)
- Settings spells out: contacts stay on device; notes are never public

### App polish
- Mobile-first UI, light/dark
- Milestone celebrations (handle claim, first publish, first split, bucket complete)
- Skeletons for loading states; smooth sheet and progress motion

## Development

```bash
npm install

# Terminal 1 — API (pick one)
docker compose up --build          # Docker, http://localhost:8787
# cd backend && go run .           # or native Go

# Terminal 2 — frontend
npm run dev          # http://localhost:5173 — proxies /api to :8787
npm run dev:https    # HTTPS on LAN — for mobile QR camera testing

npm run test
npm run build
npm run build:pages   # production build for GitHub Pages (/NimConnect/ base)
```

With Docker, encrypted cloud backup, exchange rates, and handle/profile APIs work
locally without installing Go. See [backend/README.md](backend/README.md).

### Ecosystem package

`packages/profile-client` is a small TypeScript client for resolving handles and
reading public profiles — usable from other Nimiq apps.

## Deployment

**Production:** https://nimconnect.nimiqminiapps.com (and API at `api-nimconnect.nimiqminiapps.com`).

**GitHub Pages demo:** pushes to `main` deploy via [pages.yml](.github/workflows/pages.yml)
when `VITE_API_BASE_URL` is set → https://nimminiapps.github.io/NimConnect/

The app uses hash routing, so deep links work without server rewrites. For the Go API
locally, see [backend/README.md](backend/README.md).

## Architecture

**Local-first UI** with an optional Go API for rates, cloud backup, handle resolution,
and signed public profiles.

| Layer | Role |
|--------|------|
| Pinia stores | `profiles`, `invoices`, `buckets`, `inbox` — write-through to Dexie |
| Services | `nimiq` (Mini App SDK), `handles` / public profiles, `history`, `links`, `cloud-backup`, `delight` |
| Pages | Home, Contacts, Profile (`/me`), public `/u/:handle`, Pay, Settings |
| Public surface | Shared landing components for pay links and `@handle` pages |

`ProfileView` renders any profile — yours or a contact’s — so payment and relationship
features attach to people, not separate product silos.

Private data (notes, private tags, contact list) stays in IndexedDB. The backup API
stores only encrypted blobs; public profile payloads contain only fields you chose to share.

## License

MIT
