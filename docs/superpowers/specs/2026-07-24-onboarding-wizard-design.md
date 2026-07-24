# Unified Onboarding Wizard Design

## Goal

Replace today's two disconnected first-run flows with one slick, full-screen guided wizard: claim a handle, fill in your profile, back up your wallet, share your public profile, add your first contact — in that order, with a professional shared shell instead of stitched-together bottom sheets.

## Current State (problem)

Two independently-triggered mechanisms exist today:

1. **First-run modal sequence** (`src/App.vue`): Restore contacts → `OnboardingSheet.vue` (fill profile) → `BackupOnboardingSheet.vue` (backup). Runs once at launch via `needsOnboarding`/`needsBackupOnboarding` (`src/services/onboarding.ts`).
2. **Persistent Home checklist** (`IdentitySetupCard.vue` + `src/services/identity-setup.ts`): Claim handle → Add first contact → Share public profile. A dismissible/snoozable card on `HomePage.vue`.

Claiming a handle isn't part of the first-run sequence at all, and sharing a profile can be surfaced before the user has anything on it. The two systems don't share step order, chrome, or completion tracking.

## Design

### Shell

New `OnboardingWizard.vue`, a full-screen (not bottom-sheet) orchestrator:

- Top chrome: thin gold progress bar + "STEP X OF N" counter, back arrow (previous step), close **✕** (exits the whole wizard early).
- Slide transition between step bodies.
- `N` is dynamic: 5 steps normally, 4 if `handlesEnabled()` is false (claim-handle step omitted).

### Step order

1. Claim your @handle *(omitted if handles disabled)*
2. Set up your profile (name/type/bio)
3. Back up your wallet
4. Share your public profile
5. Add your first contact

Restore-from-backup is **not** a wizard step — it stays exactly as today, a gate screen shown before the wizard starts, for returning users on a new device (`RestoreBackupSheet.vue`, unchanged).

### Per-step actions

Each step has:
- A primary CTA that performs the step's real action (claim, save profile, confirm backup, share, add contact). Success advances to the next step.
- A **"Skip for now"** text link below the CTA, which advances without completing the action.
- The top-level **✕**, which exits the wizard entirely at any point.

Skipped or abandoned steps are picked up later by the Home resume banner (see below) — there is no "forced completion."

### Component reuse (no rebuild of existing forms)

Add one new prop, `embedded?: boolean`, to `ActionSheet.vue`:

- `embedded: false` (default): today's behavior — teleport, backdrop, drag-to-dismiss, bottom-sheet radius.
- `embedded: true`: renders header + slot content in-flow, no teleport/backdrop/drag, no page-scroll lock.

`ClaimHandleSheet.vue`, `OnboardingSheet.vue`, and `BackupOnboardingSheet.vue` each gain an `embedded` prop that they forward to their internal `ActionSheet`. No form markup, validation, or API-call logic is duplicated. `OnboardingWizard.vue` mounts these three components directly as step bodies with `embedded`. Their existing standalone entry points (e.g. claiming a handle later from `/me?sheet=claim`) keep working unchanged as real bottom sheets.

### New step bodies

- **Share profile** (`ShareProfileStep.vue`, new, small): shows the public profile URL and a "Share profile" button wired to the existing `shareOrCopy` service (`src/services/share.ts`) — same call `HomePage.vue`'s current `shareIdentityProfile` makes. Uses `makePublicHandleLink()` if the handle step was completed, otherwise falls back to `makeProfileShareLink()` (address-based, `src/services/profile-share.ts`) so the step still works if claim-handle was skipped.
- **Add contact**: no new embedded form. The step's CTA navigates to the existing `/add` → `ProfileFormPage.vue` flow, same as today's `addContactFromIdentity`. Since it's the last step, saving (or skipping) a contact there completes onboarding. This is the one step without the wizard's progress-bar chrome — an accepted trade-off to avoid duplicating `ProfileFormPage`'s contact-creation logic (QR scan, tags, links) in a second, thinner form.

### Replaces

- `App.vue`'s `maybeShowOnboarding` / `maybeShowBackupOnboarding` sequencing is replaced by a single `maybeShowOnboardingWizard` that opens `OnboardingWizard.vue` once, after the restore gate.
- `IdentitySetupCard.vue`'s multi-item checklist card is replaced by a single slim "Finish setting up" resume banner: one line of copy plus a button that reopens `OnboardingWizard.vue` at the first incomplete step. It uses the same visibility/snooze rules as today (`identitySetupVisible`, `snoozeIdentitySetup`).

### State and data flow

No new persistence primitives — step completion still derives from existing signals:

- Handle claimed → `selfHandle` / registry lookup (unchanged).
- Profile filled → `markOnboardingDone()` (unchanged key).
- Backup done → `backupPassphraseSet` / `cloudBackupEnabled` / `lastLocalBackupAt` (unchanged).
- Profile shared → `SHARED_KEY` via `markPublicProfileShared()` (unchanged).
- Contact added → `profilesStore.contacts.length > 0` (unchanged).

`resolveIdentitySetup()` in `src/services/identity-setup.ts` is extended to also report profile-filled and backup-done, producing the 5-step (or 4-step) list `OnboardingWizard.vue` and the resume banner both read. `OnboardingWizard.vue` additionally holds transient in-memory `currentStepIndex` for wizard position — not persisted, since a fresh app launch re-derives the first incomplete step from the signals above.

## Error Handling

- Each embedded step surfaces errors the same way its source component does today (inline error text — see `ClaimHandleSheet.vue`'s `error` state, `BackupOnboardingSheet.vue`'s `message`/`messageIsError`). The wizard does not intercept or replace these.
- Network/registry failures on the claim-handle step keep the existing "debug info" affordance.
- If `handlesEnabled()` flips mid-session (API base becomes unavailable), the wizard does not renumber steps mid-flow — the step count is fixed at wizard open.

## Testing

- `OnboardingWizard.test.ts`: step ordering (including the 4-step handles-disabled path), skip-per-step advances without marking complete, ✕ exits and preserves progress for the resume banner, progress bar / step counter reflect current index.
- `ActionSheet.test.ts`: add cases for `embedded` — no teleport/backdrop, header still renders.
- Update `IdentitySetupCard.test.ts` for the new slim resume-banner shape (single CTA reopening the wizard) — replaces the current multi-CTA checklist tests.
- `ShareProfileStep.test.ts`: renders public URL, calls `shareOrCopy` on click, advances on success.
- Manual verification: run the app, walk the full wizard end-to-end (mobile viewport), confirm the shared chrome (thin bar, step counter, back/✕) looks identical across steps 1–4, and that step 5's handoff to `/add` completes onboarding correctly.
