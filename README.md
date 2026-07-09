# NimConnect

A relationship manager for your wallet — a Nimiq Pay Mini App.

**Live:** https://nimconnect.nimiqminiapps.com · **GitHub Pages demo:** https://nimminiapps.github.io/NimConnect/

People don't remember addresses; they remember people. NimConnect turns every
wallet address into a Profile: avatar (Nimiq identicon), name, tags, notes —
with live **Send**, **Request payment**, and **payment History** built on the
Nimiq Pay Mini App SDK.

## Features

- 👥 Profiles with identicons, favorites, tags, private notes
- 🔍 Smart search across name, address, notes, tags
- 🕘 Recent / Favorites / All sections
- 💸 Send NIM with an optional message (inside Nimiq Pay), 📥 request via `nimiq:` link + QR
- 💛 One-tap tips with preset amounts
- 🍕 Split bills — equal or custom shares, per-person request QR/link
- 🧾 Tracked invoices per contact (pending/paid), backed by a Dexie v2 migration
- 📷 Add contacts by QR scan, share your own profile QR
- 💾 Local-first: IndexedDB, works offline, JSON import/export
- 🌗 Light/dark, mobile-first, no backend

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

With Docker, encrypted cloud backup and live exchange rates work locally without installing Go.

## Deployment

### Homelab (primary) — `nimconnect.nimiqminiapps.com`

Docker Swarm stack with Traefik, same pattern as [NimiqLens](https://github.com/NimMiniApps/NimiqLens):

1. Set repo variable `VITE_API_BASE_URL=https://api-nimconnect.nimiqminiapps.com`
2. Push to `main` — [docker-build.yml](.github/workflows/docker-build.yml) publishes frontend + backend to GHCR
3. `cp docker-compose.homelab.yml.example docker-compose.homelab.yml`
4. `docker stack deploy -c docker-compose.homelab.yml nimconnect`

See [backend/README.md](backend/README.md) for API details.

### GitHub Pages (demo mirror)

Pushes to `main` also deploy via [pages.yml](.github/workflows/pages.yml) when `VITE_API_BASE_URL` is set.

The app uses hash routing, so deep links work without server rewrites. Open inside Nimiq Pay for live Send.

## Architecture

One Pinia store (`src/stores/profiles.ts`) is the app's API, write-through to
Dexie (`src/db`). Services isolate IO: `nimiq.ts` (Mini App SDK), `links.ts`
(request links), `history.ts` (chain history). `ProfileView` renders any
profile — yours or a contact's — so future features (messaging, invoices,
reputation) attach to Profiles, not new modules.
