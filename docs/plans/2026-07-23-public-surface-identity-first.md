# Public Surface Identity-First Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Overhaul the shared public shell so identity leads and pay/actions follow across all four logged-out surfaces, without changing routes or data contracts.

**Architecture:** Restyle `PublicSurface.vue` into a full-bleed identity stage + soft pay band; update the four consumers and two chrome helpers for sizes, desktop-light pay-band row, and copy cleanup. Keep slots/props. Prefer failing source/DOM tests first, then minimal CSS/template changes.

**Tech Stack:** Vue 3, Vite, Vitest + `@vue/test-utils`, existing Nimiq tokens / `.nq-button` in `src/assets/main.css`

**Design:** `docs/plans/2026-07-23-public-surface-identity-first-design.md`

**Skills:** @nimiq-ui-kit for tokens; @design-taste-frontend for anti-slop checks during review

---

### Task 1: Lock shell structure expectations in tests

**Files:**
- Modify: `src/components/PublicSurface.test.ts`
- Test: `src/components/PublicSurface.test.ts`

**Step 1: Write the failing test**

Add assertions that the shell is full-bleed identity-first (not a nested heavy panel card as the centerpiece):

```ts
it('styles the canvas as a full-height content column without a heavy nested panel card look', () => {
  expect(publicSurfaceSource).toMatch(/\.public-surface__canvas\s*\{[\s\S]*?min-height:\s*calc\(100dvh/)
  expect(publicSurfaceSource).toMatch(/\.public-surface__panel\s*\{[\s\S]*?/)
  // Soft band: no multi-layer box-shadow competing with identity
  const panelBlock = publicSurfaceSource.match(/\.public-surface__panel\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  expect(panelBlock).not.toMatch(/box-shadow:\s*\n\s*var\(--shadow\)/)
  expect(publicSurfaceSource).toMatch(/@media \(min-width:\s*48rem\)[\s\S]*?\.public-surface__panel--split|\.public-surface__panel\.is-split|grid-template-columns/)
})
```

Also keep existing slot/footer/focus/glow tests; do not remove token-migration coverage.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/components/PublicSurface.test.ts`

Expected: FAIL on the new shell/panel assertions (current panel still has heavy `box-shadow` and no desktop split).

**Step 3: Commit the failing test**

```bash
git add src/components/PublicSurface.test.ts
git commit -m "$(cat <<'EOF'
test(public): lock identity-first shell expectations

EOF
)"
```

---

### Task 2: Restyle `PublicSurface` shell

**Files:**
- Modify: `src/components/PublicSurface.vue`
- Test: `src/components/PublicSurface.test.ts`

**Step 1: Implement minimal shell CSS/template to pass Task 1**

In `PublicSurface.vue` scoped styles:

1. Keep outer `.public-surface` on `--nimiq-blue-bg` with safe-area padding.
2. `.public-surface__canvas`: full content column, `min-height: calc(100dvh - …)`, soft radius (~1.25rem), `--bg`, light border; keep `::before` glow at low opacity + `pointer-events: none`.
3. `.public-surface__identity`: more vertical room (`margin-bottom` ~2rem+), centered.
4. `.public-surface__panel`: soft band — tinted `--card` or hairline border, **remove** competing multi-layer `box-shadow` (single subtle shadow or none).
5. Desktop (`min-width: 48rem`): widen canvas max-width to ~34rem; add a class toggle or `:has()` / deep selector so when panel contains a QR + meta, layout can go row — prefer adding `data-public-panel` styles:

```css
@media (min-width: 48rem) {
  .public-surface__canvas { max-width: 34rem; }
  .public-surface__panel {
    align-items: center;
    column-gap: 1.25rem;
    grid-template-columns: auto minmax(0, 1fr);
    justify-items: stretch;
    text-align: left;
  }
}
```

If slotted QR/meta don’t grid cleanly without wrapper markup, add an optional inner wrapper only in consumers (Task 4–6) and keep panel as `display: grid` with a consumer-provided `.panel__pay-row` class documented in comments.

6. Preserve enter animation + `prefers-reduced-motion: reduce`.
7. Preserve focus-visible and footer button `min-height: 2.75rem`.
8. Do **not** reintroduce `--public-*` tokens.

**Step 2: Run tests**

Run: `npm test -- src/components/PublicSurface.test.ts`

Expected: PASS

**Step 3: Commit**

```bash
git add src/components/PublicSurface.vue src/components/PublicSurface.test.ts
git commit -m "$(cat <<'EOF'
feat(public): restyle PublicSurface as identity-first stage

EOF
)"
```

---

### Task 3: Update public profile sizing tests, then page

**Files:**
- Modify: `src/pages/PublicProfilePage.test.ts`
- Modify: `src/pages/PublicProfilePage.vue`

**Step 1: Write failing size/copy tests**

Replace the old 80/180 size assertion with:

```ts
it('uses the 96px avatar and 200px QR code sizes', () => {
  expect(publicProfilePageSource).toMatch(/<Identicon :address="payAddress" :size="96"/)
  expect(publicProfilePageSource).toMatch(/<QrCode :text="payUri" :size="200"/)
})
```

Add a source assertion that footer copy has no em-dash (`—` or `–`):

```ts
it('keeps footer copy free of em/en dashes', () => {
  expect(publicProfilePageSource).not.toMatch(/[—–]/)
})
```

**Step 2: Run to verify fail**

Run: `npm test -- src/pages/PublicProfilePage.test.ts`

Expected: FAIL on sizes (still 80/180).

**Step 3: Update `PublicProfilePage.vue`**

- Identicon `size="96"`; QrCode `size="200"`.
- If desktop pay-row needs a wrapper, wrap QR + meta in `.panel__pay-row` (or equivalent) matching shell CSS.
- Tighten identity CSS: title scale appropriate for hero; keep glow `pointer-events: none` and no animation on glow.
- Ensure primary CTA still uses `.nq-button`; secondary light-blue + outline unchanged.
- Footer: hyphen or period only (no em-dash).

**Step 4: Run tests**

Run: `npm test -- src/pages/PublicProfilePage.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/PublicProfilePage.vue src/pages/PublicProfilePage.test.ts
git commit -m "$(cat <<'EOF'
feat(public): enlarge profile hero and soft-band pay panel

EOF
)"
```

---

### Task 4: Shared profile landing

**Files:**
- Modify: `src/components/PublicProfileLanding.test.ts`
- Modify: `src/components/PublicProfileLanding.vue`
- Possibly: `src/components/PublicLandings.test.ts` (only if DOM expectations break)

**Step 1: Update / add failing source tests**

Mirror sizing: Identicon 96, QrCode 200, `.nq-button` on primary actions, no em/en dash in template strings.

**Step 2: Run fail, then implement**

Align identity hierarchy and footer copy with the design. Reuse the same pay-row wrapper class if introduced in Task 3.

**Step 3: Run**

Run: `npm test -- src/components/PublicProfileLanding.test.ts src/components/PublicLandings.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add src/components/PublicProfileLanding.vue src/components/PublicProfileLanding.test.ts src/components/PublicLandings.test.ts
git commit -m "$(cat <<'EOF'
feat(public): align shared profile landing with identity-first shell

EOF
)"
```

---

### Task 5: Payment request landing

**Files:**
- Modify: `src/components/PublicPayLanding.vue`
- Modify: `src/components/PublicLandings.test.ts` (payment cases)

**Step 1: Failing expectations**

- Identicon 96; QR 200
- Amount remains the visual headline inside the panel/band
- No em/en dashes in footer copy
- Primary still `.nq-button`

**Step 2: Implement template/CSS**

Keep identity as “{label} requests a payment”; amount large in band; desktop pay-row if applicable.

**Step 3: Run**

Run: `npm test -- src/components/PublicLandings.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add src/components/PublicPayLanding.vue src/components/PublicLandings.test.ts
git commit -m "$(cat <<'EOF'
feat(public): restyle payment request landing for soft pay band

EOF
)"
```

---

### Task 6: Handoff / Open in Nimiq Pay landing

**Files:**
- Modify: `src/components/OpenInNimiqPayLanding.vue`
- Modify: `src/components/PublicLandings.test.ts` (handoff cases)

**Step 1: Failing expectations for copy + band chrome**

- Hero stays NimConnect mark + “People, not wallet addresses.”
- Panel/band uses same soft chrome (inherits from shell); fix any local styles that assume old heavy card or `--public-*`
- Remove em/en dashes from visible copy
- Keep lookup/error/loading behaviors

**Step 2: Implement, run tests, commit**

Run: `npm test -- src/components/PublicLandings.test.ts`

```bash
git add src/components/OpenInNimiqPayLanding.vue src/components/PublicLandings.test.ts
git commit -m "$(cat <<'EOF'
feat(public): restyle handoff landing on identity-first shell

EOF
)"
```

---

### Task 7: Chrome helpers + token regression

**Files:**
- Modify: `src/components/PublicAddressCopy.vue` (if contrast/spacing assumes old panel)
- Modify: `src/components/PublicStoreLinks.vue` (if needed)
- Test: `src/publicSurfaceTokens.test.ts` (should still pass unchanged)

**Step 1: Run token regression**

Run: `npm test -- src/publicSurfaceTokens.test.ts`

Expected: PASS (no `--public-*` reintroduced)

**Step 2: Visual/CSS pass on helpers**

Ensure address copy and store links read clearly on the soft band in both themes (use `--text`, `--nq-light-blue`, borders from tokens). No new palette.

**Step 3: Commit if changed**

```bash
git add src/components/PublicAddressCopy.vue src/components/PublicStoreLinks.vue
git commit -m "$(cat <<'EOF'
fix(public): tune address copy and store links for soft pay band

EOF
)"
```

---

### Task 8: Full suite + manual checklist

**Step 1: Run full unit tests**

Run: `npm test`

Expected: all PASS

**Step 2: Manual check in `npm run dev`**

- `/u/<known-handle>` — identity hero, soft pay band, CTA in first viewport; light + dark OS theme
- Shared profile link / payment request route used in `PublicLandings.test.ts`
- Handoff landing + lookup error state
- Desktop ≥768px: pay band QR beside meta
- Reduced motion: no stagger/enter animation

**Step 3: Final commit only if polish leftovers**

```bash
git add -A
git status
# commit only if there are intentional leftovers
```

---

## Pre-flight (design taste)

Before calling done:

- [ ] Zero em/en dashes in visible public-surface copy
- [ ] One theme family (no mid-page invert)
- [ ] One accent system (Nimiq gold / light-blue as today)
- [ ] No nested heavy card competing with identity
- [ ] No scroll cues / version stamps / section-number eyebrows
- [ ] Primary CTA reachable with identity on first viewport
- [ ] Desktop is stack + pay-row only (no full split hero)
