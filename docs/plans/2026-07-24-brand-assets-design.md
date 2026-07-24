# Brand assets v2 — design

**Date:** 2026-07-24  
**Status:** Approved

## Goal

Wire the corrected NimConnect brand pack (`assets/`) into the app and the Nimiq Mini Apps catalog so favicons, OG/Twitter cards, in-app logo, and catalog icon/banner all use the new contained exports.

## Approach

Install the pack under `public/brand/` (per `assets/README.md`). Point `index.html`, the public landing logo, and the Mini Apps catalog at those URLs. Leave legacy `public/icon.svg` / `public/banner.*` in place only until nothing depends on them; prefer new brand paths everywhere we touch.

## Surfaces

1. **Static pack** — copy selected exports into `public/brand/`.
2. **HTML metadata** — favicon, apple-touch-icon, Open Graph, Twitter card.
3. **In-app UI** — `OpenInNimiqPayLanding` and `index.html` boot splash use a brand PNG icon.
4. **Catalog** — after assets are on `main` / production, update `icon_url`, `banner_url`, and `media` for slug `nimconnect`.

## Catalog URL preference

Prefer production URLs once deployed:

- Icon: `https://nimconnect.nimiqminiapps.com/brand/app-icon-512x512.png`
- Banner: `https://nimconnect.nimiqminiapps.com/brand/header-1600x500.png`
- Media: social card + header

Fallback while waiting on deploy: raw GitHub `main` paths under `public/brand/`.
