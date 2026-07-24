# NimConnect README Branding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the NimConnect README the same branded opening structure as NimBomber while retaining the existing NimConnect documentation.

**Architecture:** Use repository-relative HTML image elements and centered paragraphs at the top of `README.md`, followed by the existing Markdown sections. Add one concise brand-assets section near the end that points to the source pack.

**Tech Stack:** GitHub-flavored Markdown, repository-local PNG assets, shell-based link validation

---

### Task 1: Add the branded README opening

**Files:**
- Modify: `README.md:1-16`

**Step 1: Run the pre-change structure check**

Run:

```bash
rg -q 'assets/header-1500x500\\.png' README.md
```

Expected: FAIL because the branded header is not referenced yet.

**Step 2: Replace the plain opening**

Replace the top-level Markdown heading, tagline, live links, and introductory
paragraphs with centered HTML containing:

- `assets/header-1500x500.png` at full width
- `assets/nimconnect-logo-full.png` at 420px width
- A centered product description
- Live, Nimiq Pay, catalog, and backend documentation links
- A horizontal divider

Keep the existing `## What it is` section and everything below it.

**Step 3: Run the structure check**

Run:

```bash
rg -q 'assets/header-1500x500\\.png' README.md &&
rg -q 'assets/nimconnect-logo-full\\.png' README.md &&
rg -q 'nimpay\\.app/miniapps/open/nimconnect\\.nimiqminiapps\\.com' README.md
```

Expected: PASS.

### Task 2: Document the brand pack

**Files:**
- Modify: `README.md`

**Step 1: Add the brand-assets section**

Immediately before `## License`, add `## Brand assets` with a short description
and links to `assets/` and `assets/README.md`.

**Step 2: Verify local README targets**

Run a shell check that extracts the intended repository-local image and document
targets and confirms each exists:

```bash
test -f assets/header-1500x500.png &&
test -f assets/nimconnect-logo-full.png &&
test -f assets/README.md &&
test -f backend/README.md
```

Expected: PASS.

**Step 3: Check the diff**

Run:

```bash
git diff --check -- README.md
git diff -- README.md
```

Expected: no whitespace errors; only the branded opening and brand-assets
section are changed.
