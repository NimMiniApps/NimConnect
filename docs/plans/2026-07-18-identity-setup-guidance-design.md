# Identity setup guidance — Design

**Date:** 2026-07-18  
**Status:** Approved  
**Context:** Light-touch UX for Mini Apps Competition scoring (Design & UX / onboarding clarity) without redesigning layout, navigation, or the existing visual system. Reinforces **identity → share → relationships → payments**.

---

## Goal

Guide new (and incomplete) users through NimConnect’s early value on Home:

1. Claim `@handle`
2. Share public profile
3. Connect with first contact

…using one evolving card, then get out of the way. Preserve the polished UI. No wizard, no nav changes, no feature flags.

---

## Product story

```text
Claim your @handle
        ↓
Share your public profile
        ↓
Add your first contact
        ↓
Start paying / splitting with people
```

Naming in code: **IdentitySetup** (not “onboarding”) — this is completing core identity value, not a disposable first-run tour. Existing `services/onboarding.ts` (name sheet / backup prompts) stays as-is; this feature is separate.

---

## Section 1 — Home identity-setup card

### When it appears

Show the card on Home when the user has **not** completed all applicable checklist steps, and the card is not currently snoozed.

**Never show** if the user already satisfies every applicable step (covers already-onboarded users upgrading into this feature).

### Checklist (outcome-oriented)

| Step | Label | Completion source |
|---|---|---|
| 1 | Claim your `@handle` | **Derived** — handle present for self (and handles feature enabled). If handles disabled, this step is omitted entirely. |
| 2 | Connect with your first contact | **Derived** — `contacts.length > 0` |
| 3 | Share your public profile | **Persisted** — `publicProfileShared` boolean (cannot derive reliably) |

### Next-step priority (first incomplete wins)

1. **No handle** (handles enabled)  
   - Primary: **Claim your `@handle`**  
   - Secondary: **Why claim one?** / **Learn more** (positive framing — **no “Skip for now”**)  
   - Card remains dismissible via snooze (see Storage)

2. **Has handle, no contacts**  
   - Primary: **Add your first contact**  
   - Secondary: **Share your public profile** (only once handle exists)

3. **Just claimed** → celebration variant (Section 2)

4. **All applicable steps done** → card auto-hides permanently (no stored “dismiss forever” needed)

### Title / framing

Aspirational, not “setup progress” / “configure software”:

- Default: **Build your Nimiq identity** (or **Complete your identity** / **Getting started** — pick one string in implementation and stick to it)
- Celebration: see Section 2

### Progress UX

- Show the full checklist with completed items checked.
- Only the **current** next step gets a primary button.
- Completing a step: animate checkmark → immediately advance CTA (calm — no extra confetti on the card).
- Completing any checklist item **cancels snooze** and recalculates the next step immediately.

### Fresh empty state (Home)

When `freshUser` (no contacts / invoices / inbox activity):

- If **no handle** (handles enabled): primary **Claim your `@handle`**, secondary **Add your first contact**
- If **has handle**: primary **Add your first contact**, secondary **Share your public profile**
- Do **not** offer Share as primary before a handle exists

---

## Section 2 — Post-claim celebration (same card)

After a successful handle claim (existing `celebrate()` confetti stays; **no extra card animations** beyond checkmark + CTA fade):

### Content

- Title (pick one consistent string): **You’re now @handle** / **Welcome, @handle!** / **Your public profile is live!**
- Show tangible URL under the title using existing `makePublicHandleLink(handle)` (e.g. production `…/@chuck`)
- Primary: **Share your public profile**
- Secondary: **Add your first contact** (clear action verb)

### Tiny state machine (celebration only)

```text
claimed  →  shared  →  (normal identity-setup next step)
```

No extra branches.

### After Share

Immediate calm feedback on the card:

```text
✓ Public profile shared
Next recommended step
[ Add your first contact ]
```

Set `publicProfileShared = true`. Advance checklist. Celebration phase ends (`shared` → normal).

---

## Section 3 — Context-aware Split empty state

- **Keep** Split in the bottom nav unchanged (no visual demotion).
- When Split opens with **zero contacts**: do **not** show a disabled form. Show a clean empty state inside the existing sheet:

```text
Split bills with people, not wallet addresses.

Add your first contact to start splitting expenses.

[ Add your first contact ]
```

- If they already have a handle, keep the same framing (personalization is copy continuity, not a second CTA).
- **Do not** mention `@handle` inside Split — identity guidance belongs on Home.
- When contacts exist: unchanged Split UI.

---

## Section 4 — State, storage, non-goals

### Derive wherever possible

| Fact | Source |
|---|---|
| Handle claimed | Profile / handle services (derived) |
| Has contact | `contacts.length > 0` (derived) |
| Public profile shared | Persisted boolean only |
| Celebration phase | Tiny persisted/ephemeral: `claimed` \| `shared` \| absent |
| Snooze | Persisted until timestamp |

**No duplicate onboarding state.** Persist only what cannot be inferred: `publicProfileShared`, temporary snooze, and celebration phase.

### Snooze (deterministic)

- Dismiss = **snooze for 24 hours** (wall-clock).
- Completing any checklist item **immediately cancels snooze** and recalculates next step.
- Do **not** permanently hide before checklist completion.

### Reuse

- Home `EmptyState` / `home-panel` visual language
- `ClaimHandleSheet` + existing confetti
- `makePublicHandleLink` / share helpers
- Existing profile name onboarding + backup sheets unchanged

### Non-goals

- No nav structure changes; no Split demotion
- No multi-step wizard, new routes, or feature flags
- No Home redesign for power users after setup completes
- No permanent dismiss before completion
- No handle tip inside Split
- No duplicate “onboarding” flag layer mirroring derived checklist items

### Testing (required)

- Next-step priority order (handle → contact → share)
- Handles **disabled** → checklist starts at “Connect with your first contact”
- Already complete user → card never appears
- Snooze 24h; cancel on checklist progress
- Post-claim → share → add contact transitions
- Split empty state when `contacts.length === 0`
- Share sets `publicProfileShared` and advances CTA

---

## Visual constraints

- No redesign of colors, typography, bottom nav, or sheet chrome
- Card should feel like existing Home panels / banners
- Motion: checkmark + subtle CTA fade only on the card; confetti only on claim (existing)

---

## Success criteria

- A new user can see one clear next step on Home within seconds
- Claiming a handle feels like creating something shareable (URL visible)
- Split empty state reinforces people-first positioning without competing with identity setup
- Power users with handle + contacts + shared profile never see the card
