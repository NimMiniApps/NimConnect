# NimConnect

A relationship manager for your wallet — a Nimiq Pay Mini App.

**Live demo:** https://nimminiapps.github.io/NimConnect/

People don't remember addresses; they remember people. NimConnect turns every
wallet address into a Profile: avatar (Nimiq identicon), name, tags, notes —
with live **Send**, **Request payment**, and **payment History** built on the
Nimiq Pay Mini App SDK.

## Features

- 👥 Profiles with identicons, favorites, tags, private notes
- 🔍 Smart search across name, address, notes, tags
- 🕘 Recent / Favorites / All sections
- 💸 Send NIM (inside Nimiq Pay), 📥 request via `nimiq:` link + QR
- 📷 Add contacts by QR scan, share your own profile QR
- 💾 Local-first: IndexedDB, works offline, JSON import/export
- 🌗 Light/dark, mobile-first, no backend

## Development

```bash
npm install
npm run dev     # plain-browser mode: everything works except live Send
npm run test    # vitest unit tests
npm run build
npm run build:pages   # production build for GitHub Pages (/NimConnect/ base)
```

## GitHub Pages

Pushes to `main` deploy automatically via [GitHub Actions](.github/workflows/pages.yml).

1. In the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. After the first successful workflow run, the site is at https://nimminiapps.github.io/NimConnect/

The app uses hash routing, so deep links work without server rewrites. Open inside Nimiq Pay for live Send; the hosted demo works in a normal browser for everything else.

## Architecture

One Pinia store (`src/stores/profiles.ts`) is the app's API, write-through to
Dexie (`src/db`). Services isolate IO: `nimiq.ts` (Mini App SDK), `links.ts`
(request links), `history.ts` (chain history). `ProfileView` renders any
profile — yours or a contact's — so future features (messaging, invoices,
reputation) attach to Profiles, not new modules.
