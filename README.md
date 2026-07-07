# NimConnect

A relationship manager for your wallet — a Nimiq Pay Mini App.

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
```

## Architecture

One Pinia store (`src/stores/profiles.ts`) is the app's API, write-through to
Dexie (`src/db`). Services isolate IO: `nimiq.ts` (Mini App SDK), `links.ts`
(request links), `history.ts` (chain history). `ProfileView` renders any
profile — yours or a contact's — so future features (messaging, invoices,
reputation) attach to Profiles, not new modules.
