# Unified Onboarding Wizard Design

## Goal

Replace today's two disconnected first-run flows with one slick, full-screen guided wizard: claim a handle, fill in your profile, back up your wallet, share your public profile, add your first contact — in that order, with a professional shared shell instead of stitched-together bottom sheets.

## Current State (problem)

Two independently-triggered mechanisms exist today:

1. **First-run modal sequence** (`src/App.vue`): Restore contacts → `OnboardingSheet.vue` (fill profile) → `BackupOnboardingSheet.vue` (backup). Runs once at launch via `needsOnboarding`/`needsBackupOnboarding` (`src/services/onboarding.ts`).
2. **Persistent Home checklist** (`IdentitySetupCard.vue` + `src/services/identity-setup.ts`): Claim handle → Add first contact → Share public profile. A dismissible/snoozable card on `HomePage.vue`.

Claiming a handle isn't part of the first-run sequence at all. And "share completion" (`identity-setup.ts`'s `share-profile` step) means only that the user tapped share/copy at some point — it doesn't verify a rich public profile was actually published first. The two systems don't share step order, chrome, or completion tracking.

**Supersedes:** the step order in `src/services/identity-setup.ts:108` (claim handle → first contact → share) is replaced by claim handle → fill profile → back up wallet → share profile → add contact. Backup moves ahead of the social/growth steps deliberately: protecting the wallet's keys is a safety concern, and losing access before backing up costs everything regardless of whether a profile was shared or a contact was added. Growth actions can wait a step; key safety shouldn't.

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

### Per-step actions and the event contract

Each step has a primary CTA that performs the step's real action, a **"Skip for now"** text link, and the wizard-level top **✕**. Getting this right requires fixing a real bug the existing components have: `OnboardingSheet.skip()` and `BackupOnboardingSheet.skip()` both call their `mark*Done()` function before emitting `close` (`src/components/OnboardingSheet.vue:38`, `src/components/BackupOnboardingSheet.vue:90`). That's correct for their current standalone use (dismissing the first-run prompt for good), but wrong for the wizard: if "Skip for now" marks the step permanently done, it becomes indistinguishable from actually completing it, and the resume banner can never offer it again.

**Fix:** give each reusable component (`ClaimHandleSheet`, `OnboardingSheet`, `BackupOnboardingSheet`) a second, embedded-only event contract, gated by the new `embedded` prop:

- `complete` — the step's real action succeeded (handle claimed / profile saved / backup confirmed). The wizard advances and this is the only path that's allowed to persist a done-state.
- `defer` — "Skip for now" was tapped. Emitted instead of calling `mark*Done()` / `close`. The wizard advances without persisting anything for that step, so it's correctly reported as not-done next time `resolveIdentitySetup()` runs.
- `request-exit` — the user wants to leave the wizard entirely. In embedded mode there is no independent close affordance (no backdrop click, no drag-to-dismiss, no internal ✕ — `ActionSheet`'s `embedded` mode already removes all of those); `request-exit` only fires from the wizard chrome's own ✕, one level up, not from inside the step component.

Non-embedded (standalone) usage is untouched: `close`/`complete`/`claimed` keep meaning exactly what they mean today, so `/me?sheet=claim` and any other direct entry point behaves exactly as it does now.

### Component reuse (no rebuild of existing forms)

Add one new prop, `embedded?: boolean`, to `ActionSheet.vue`:

- `embedded: false` (default): today's behavior — teleport, backdrop, drag-to-dismiss, bottom-sheet radius.
- `embedded: true`: renders header + slot content in-flow, no teleport/backdrop/drag, no page-scroll lock, no independent close affordance.

`ClaimHandleSheet.vue`, `OnboardingSheet.vue`, and `BackupOnboardingSheet.vue` each gain an `embedded` prop that they forward to their internal `ActionSheet`, and which switches their internal handlers to the `complete`/`defer`/`request-exit` contract above. No form markup, validation, or API-call logic is duplicated. `OnboardingWizard.vue` mounts these three components directly as step bodies with `embedded`. Their existing standalone entry points (e.g. claiming a handle later from `/me?sheet=claim`) keep working unchanged as real bottom sheets with the old event contract.

**Exception — nested passphrase modal:** `BackupOnboardingSheet` opens `PassphraseSheet` as a separate `ActionSheet` for cloud-backup passphrase entry (`src/components/BackupOnboardingSheet.vue:277`). Embedding that too would mean redesigning a conditional, sensitive-input sub-flow inline into the backup step's layout for one code path. Instead, this is an explicit, permitted exception: `PassphraseSheet` keeps popping up as a real (non-embedded) modal on top of the full-screen wizard when the cloud-backup path needs a passphrase — the same way a native permission prompt can interrupt a full-screen flow. This is the one intentional break in "everything lives in the shared shell," and it's scoped to a single conditional sub-step, not a pattern to repeat elsewhere.

### New step bodies

- **Share profile** (`ShareProfileStep.vue`, new, small): shows the public profile URL and a "Share profile" button wired to the existing `shareOrCopy` service (`src/services/share.ts`) — same call `HomePage.vue`'s current `shareIdentityProfile` makes. Uses `makePublicHandleLink()` if the handle step was completed, otherwise falls back to `makeProfileShareLink()` (address-based, `src/services/profile-share.ts`) so the step still works if claim-handle was skipped.
- **Add contact**: no new embedded form. The step's CTA navigates to `/add?from=onboarding` → `ProfileFormPage.vue`. This is the one step without the wizard's progress-bar chrome — an accepted trade-off to avoid duplicating `ProfileFormPage`'s contact-creation logic (QR scan, tags, links) in a second, thinner form. `/add` is a routed page today with no wizard-aware return contract — `ProfileFormPage.save()` currently `router.replace`s to `/profile/:id` on success (`src/pages/ProfileFormPage.vue:717`) and its Back control relies on browser history, neither of which tells the wizard anything. This needs an explicit contract, not an implicit one:
  - `from=onboarding` on the query string is the intent flag `ProfileFormPage` checks.
  - On successful `store.add(...)` under that flag, redirect to `/` (Home) instead of `/profile/:id` — landing on a single new contact's page reads as a dead end mid-onboarding; Home shows the completed/updated resume state instead. `profilesStore.contacts.length > 0` is already the real completion signal `resolveIdentitySetup()` reads (`src/services/identity-setup.ts:116`), so no new event or flag is needed for this — it's a routing-destination change, not a new persistence mechanism.
  - Back/cancel under `from=onboarding` also routes to `/` rather than raw browser history, and is treated the same as "Skip for now" elsewhere: nothing is persisted, `contactCount` stays whatever it already was, and the step reappears as not-done.

### Replaces

- `App.vue`'s `maybeShowOnboarding` / `maybeShowBackupOnboarding` sequencing is replaced by a single `maybeShowOnboardingWizard` that opens `OnboardingWizard.vue` once, after the restore gate.
- `IdentitySetupCard.vue`'s multi-item checklist card is replaced by a single slim "Finish setting up" resume banner: one line of copy plus a button that reopens `OnboardingWizard.vue` at the first incomplete step. It uses the same visibility/snooze rules as today (`identitySetupVisible`, `snoozeIdentitySetup`).

### State and data flow

Step completion is a per-step **derived predicate**, not a dismissal flag — this is what makes "Skip for now" safe (nothing is persisted on defer) and what makes legacy users classify correctly:

- **Handle claimed** → `selfHandle` / registry lookup (unchanged, already a real signal).
- **Profile filled** → `self.name !== 'Me'` (the same stub-name check `needsOnboarding()` already uses, `src/services/onboarding.ts:39`) — **not** `markOnboardingDone()`. The existing `DONE_KEY` only ever meant "the first-run prompt was dismissed," which is why reusing it directly would both (a) let "Skip for now" read as complete and (b) misclassify a legacy user who already has a real name but never triggered that key (e.g. edited their profile before this wizard existed) as not-done. Deriving from the actual name field fixes both at once, with no migration step required — it's already correct for every existing account today. `markOnboardingDone()`/`DONE_KEY` is no longer read for step-completion; leave it in place only if something else still depends on it (check remaining call sites during implementation), otherwise remove it.
- **Backup done** → `backupPassphraseSet` / `cloudBackupEnabled` / `lastLocalBackupAt` (unchanged — these were already real signals, not a dismissal flag, so no change needed here).
- **Profile shared** → `SHARED_KEY` via `markPublicProfileShared()`, only ever set from the `complete` path (real share/copy action), never from `defer`.
- **Contact added** → `profilesStore.contacts.length > 0` (unchanged, already a real signal).

`resolveIdentitySetup()` in `src/services/identity-setup.ts` is extended to report all five predicates above (adding profile-filled and backup-done to the existing three), producing the 5-step (or 4-step) list `OnboardingWizard.vue` and the resume banner both read. No new persisted keys are introduced for "deferred" as a distinct state — a deferred step and a never-visited step are the same thing (not-done), which is all the resume banner needs to know. `OnboardingWizard.vue` holds transient in-memory `currentStepIndex` for wizard position — not persisted, since a fresh app launch re-derives the first incomplete step from the predicates above.

## Error Handling

- Each embedded step surfaces errors the same way its source component does today (inline error text — see `ClaimHandleSheet.vue`'s `error` state, `BackupOnboardingSheet.vue`'s `message`/`messageIsError`). The wizard does not intercept or replace these.
- Network/registry failures on the claim-handle step keep the existing "debug info" affordance.
- If `handlesEnabled()` flips mid-session (API base becomes unavailable), the wizard does not renumber steps mid-flow — the step count is fixed at wizard open.

## Testing

- `OnboardingWizard.test.ts`: step ordering (including the 4-step handles-disabled path), `defer` advances without persisting any done-state, `complete` advances and persists, `request-exit` only fires from the wizard's own ✕ (not from inside a step), progress bar / step counter reflect current index.
- `ActionSheet.test.ts`: add cases for `embedded` — no teleport/backdrop, no independent close affordance, header still renders.
- `OnboardingSheet.test.ts` / `BackupOnboardingSheet.test.ts` / `ClaimHandleSheet.test.ts`: embedded mode emits `complete`/`defer`/`request-exit` and never calls `mark*Done()` on `defer`; non-embedded mode is unchanged (regression case — standalone `/me?sheet=claim` still marks done on its own skip/close, exactly as today).
- `identity-setup.test.ts`: profile-filled predicate is `self.name !== 'Me'`, independent of `markOnboardingDone()`/`DONE_KEY` — explicit **legacy-user case**: a profile with a real name and `DONE_KEY` never set reports the step as done.
- `ProfileFormPage.test.ts`: `from=onboarding` redirects to `/` on save instead of `/profile/:id`; Back/cancel under that flag also routes to `/` without mutating `profilesStore`.
- Update `IdentitySetupCard.test.ts` for the new slim resume-banner shape (single CTA reopening the wizard) — replaces the current multi-CTA checklist tests.
- `ShareProfileStep.test.ts`: renders public URL (handle-based if claimed, address-based fallback if deferred), calls `shareOrCopy` on click, advances on success.
- Manual verification: run the app, walk the full wizard end-to-end (mobile viewport) including deferring at least one step and confirming it reappears on the resume banner; confirm the shared chrome looks identical across steps 1–4; confirm the cloud-backup passphrase modal correctly interrupts and returns to the backup step; confirm step 5's `/add?from=onboarding` handoff lands back on Home and marks the step done only on an actual save.
