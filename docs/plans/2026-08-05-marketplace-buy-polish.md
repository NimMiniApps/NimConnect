# Marketplace Buy Confirmation Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish the handle purchase confirmation screen while preserving the existing signed reservation and escrow workflow.

**Architecture:** Keep all behavior in `DesktopMarketplaceBuyPage.vue`; add no dependencies and change no marketplace API contracts. Extend the component tests first, then implement semantic markup, state-specific content, and scoped token-driven responsive CSS.

**Tech Stack:** Vue 3 Composition API, Vue Router, Vitest, Vue Test Utils, scoped CSS, existing Nimiq design tokens.

---

### Task 1: Specify the polished confirmation experience

**Files:**
- Modify: `src/pages/desktop/DesktopMarketplaceBuyPage.test.ts`

1. Add tests for the marketplace back link, handle and amount hierarchy, buyer identity, escrow explanation, and `Reserve @handle` CTA.
2. Add tests for the loading and unavailable cards.
3. Run `npm test -- --run src/pages/desktop/DesktopMarketplaceBuyPage.test.ts` and confirm the new assertions fail against the bare page.

### Task 2: Implement the Nimiq-styled confirmation card

**Files:**
- Modify: `src/pages/desktop/DesktopMarketplaceBuyPage.vue`

1. Add formatting helpers for NIM and the compact wallet address.
2. Replace the bare template with semantic loading, unavailable, and confirmation cards.
3. Add the wallet summary, three escrow steps, trust notice, error alert, and full-width reservation CTA.
4. Add scoped responsive styles using existing project/Nimiq variables, visible focus, stable hover states, and reduced-motion handling.
5. Run the focused tests until green.

### Task 3: Verify the frontend

**Files:**
- Verify: `src/pages/desktop/DesktopMarketplaceBuyPage.vue`
- Verify: `src/pages/desktop/DesktopMarketplaceBuyPage.test.ts`

1. Run the focused component tests.
2. Run the full frontend test suite.
3. Run the repository type-check and production build.
4. Inspect the final diff and ensure unrelated files are absent.
