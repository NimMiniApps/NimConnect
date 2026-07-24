# Brand Assets v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship NimConnect brand pack v2 into `public/brand/`, wire HTML/UI metadata, and update the Mini Apps catalog.

**Architecture:** Static assets live under Vite `public/brand/`. HTML and Vue use `/brand/...` (respecting `import.meta.env.BASE_URL` where needed). Catalog points at production (or raw GitHub) brand URLs after push/deploy.

**Tech Stack:** Vite public assets, Vue 3, Nimiq Mini Apps MCP (`admin_update_app`)

---

### Task 1: Install brand pack into `public/brand/`

**Files:**
- Create: `public/brand/*` (copied from `assets/`)

**Step 1:** Create `public/brand/` and copy:

- `favicon.ico`
- `apple-touch-icon.png`
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`
- `app-icon-512x512.png`
- `thumbnail-240x240.png`
- `nimconnect-icon-16x16.png`
- `nimconnect-icon-32x32.png`
- `nimconnect-icon-192x192.png`
- `nimconnect-logo-full.png`
- `header-1500x500.png`
- `header-1600x500.png`
- `social-card-1200x630.png`

**Step 2:** Confirm files exist with `ls public/brand`.

---

### Task 2: Wire `index.html` metadata and boot splash

**Files:**
- Modify: `index.html`

**Step 1:** Replace favicon/apple-touch links with brand pack links from `assets/README.md`.

**Step 2:** Add OG/Twitter meta tags pointing at `/brand/social-card-1200x630.png`.

**Step 3:** Point boot splash `<img>` at `/brand/nimconnect-icon-192x192.png`.

---

### Task 3: Update landing logo URL

**Files:**
- Modify: `src/components/OpenInNimiqPayLanding.vue`
- Test: `src/components/OpenInNimiqPayLanding.test.ts` (no path assertion today; keep logo size)

**Step 1:** Change `iconUrl` from `icon.svg` to `brand/nimconnect-icon-192x192.png` (with `BASE_URL`).

**Step 2:** Run `npm test -- src/components/OpenInNimiqPayLanding.test.ts`.

---

### Task 4: Commit, push, update catalog

**Step 1:** Commit brand files + HTML/UI wiring.

**Step 2:** Push to `origin` so GitHub raw / deploy can serve `/brand/*`.

**Step 3:** Call `admin_update_app` for slug `nimconnect` with new `icon_url`, `banner_url`, and `media`.

**Step 4:** Verify with `get_app` slug `nimconnect`.
