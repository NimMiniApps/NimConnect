# Admin Stats Chart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the always-visible daily stats table with an accessible selectable-metric chart while retaining the exact table in a closed disclosure.

**Architecture:** A focused `AdminStatsChart` component owns 30-day UTC normalization, metric selection, SVG geometry, and point interaction. `AdminStatsPage` supplies API days, places the chart after totals, and moves the unchanged full table into native `<details>`.

**Tech Stack:** Vue 3 Composition API, TypeScript, responsive SVG, Vitest, Vue Test Utils.

---

### Task 1: Accessible selectable-metric chart

**Files:**
- Create: `src/components/AdminStatsChart.vue`
- Create: `src/components/AdminStatsChart.test.ts`

**Step 1: Write the failing component tests**

Mount with two observations 30 calendar days apart and assert:

- Opens is selected by default.
- Exactly 30 chart points render, with missing days represented by zero.
- The final point exposes the newest date and opens value.
- Clicking Wallets and Handles updates the chart label and point values.
- Focusing/clicking a point updates visible exact date/value text.
- An empty `days` prop renders `No daily stats yet.`

Use stable selectors such as `data-chart-metric`, `data-chart-point`,
`data-chart-tooltip`, and `data-chart-empty`.

**Step 2: Run the component test and verify RED**

Run:

```bash
npx vitest run src/components/AdminStatsChart.test.ts
```

Expected: FAIL because `AdminStatsChart.vue` does not exist.

**Step 3: Implement the minimal component**

Define a `days: DayStats[]` prop and a local metric descriptor list for opens,
wallets, and handles. Normalize to the latest 30 UTC dates ending on the
newest response date and fill missing observations with zeros.

Render:

- a labelled three-button metric control;
- an SVG with baseline, maximum guide, area, line, sparse date labels, and 30
  focusable/clickable points;
- a visible exact-value readout for the active point; and
- a text empty state.

Use a fixed viewBox with responsive width, no animations, and existing CSS
tokens. Reset the active point to the newest day when the metric changes.

**Step 4: Run the component test and verify GREEN**

Run:

```bash
npx vitest run src/components/AdminStatsChart.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/AdminStatsChart.vue src/components/AdminStatsChart.test.ts
git commit -m "feat: add selectable admin stats chart"
```

### Task 2: Chart-first page and collapsed exact table

**Files:**
- Modify: `src/pages/AdminStatsPage.vue`
- Modify: `src/pages/AdminStatsPage.test.ts`

**Step 1: Write the failing page tests**

In the loaded-state test, assert:

- `AdminStatsChart` is present;
- a native `details[data-daily-table]` exists and is not open initially;
- its summary reads `View daily table`; and
- the daily rows remain inside the disclosure.

Open the disclosure with `setValue(true)` or by assigning `open` and assert
the exact values remain accessible.

**Step 2: Run the page test and verify RED**

Run:

```bash
npx vitest run src/pages/AdminStatsPage.test.ts
```

Expected: FAIL because the chart is absent and the table is not disclosed.

**Step 3: Integrate the chart and disclosure**

Import `AdminStatsChart`, render it with `summary.days`, and wrap the current
table in:

```html
<details class="daily-table-disclosure" data-daily-table>
  <summary>View daily table</summary>
  <!-- existing complete table -->
</details>
```

Style the disclosure summary as a clear keyboard-focusable secondary control.
Keep the handle directory below it unchanged.

**Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run src/components/AdminStatsChart.test.ts src/pages/AdminStatsPage.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/pages/AdminStatsPage.vue src/pages/AdminStatsPage.test.ts
git commit -m "feat: make admin daily stats chart-first"
```

### Task 3: Full verification

**Step 1: Run focused admin tests**

```bash
npx vitest run src/services/adminAuth.test.ts src/components/AdminStatsChart.test.ts src/pages/AdminStatsPage.test.ts
```

Expected: PASS.

**Step 2: Run all frontend tests**

```bash
npx vitest run --passWithNoTests --exclude '.worktrees/**'
```

Expected: all root test files pass.

**Step 3: Run the production build**

```bash
npm run build
```

Expected: PASS.

**Step 4: Run backend tests**

```bash
cd backend && go test ./...
```

Expected: PASS.

**Step 5: Inspect the branch**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted feature files.
