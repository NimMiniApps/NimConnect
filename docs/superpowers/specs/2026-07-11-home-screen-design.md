# Home screen: Activity becomes Home

**Date:** 2026-07-11 · **Status:** approved

## Why

NimConnect's core loop is settling up with people (split bills, requests,
pay by name), not browsing an address book. The screen that shows money in
flight should be the home screen. ActivityPage already renders 80% of it.

## Design

### Routes & nav

- `/` → HomePage (ActivityPage renamed, retitled "Home").
- `/contacts` → ContactsPage.
- Bottom nav: Home 🏠 · Contacts 👥 · Scan · Split · Profile.
  Inbox badge moves to Home. No separate Activity tab — Home is activity.
- Contacts' status strip (pending stats) is deleted; Home owns that.

### Home page structure (top → bottom)

1. **Quick send row** (new) — horizontal avatar circles: favorites first,
   then recent, deduped, cap 8. Tap → `/profile/:id` (Send/Request/Tip
   already live there).
2. Requests for you (unchanged)
3. Open invoices + payment detection (unchanged)
4. Incoming payments (unchanged)

### Empty state

Zero contacts and zero activity → page-level empty state with
"Add contact" / "Share profile" actions (reused from Contacts).
App.vue onboarding/restore sheets untouched.

### Deliberately not doing

- No new page file — rename + extend ActivityPage.
- No net-balance ledger math.
- No tap-to-send sheet from avatar row (profile page has the actions).

### Reference fixes

- `SplitBillSheet.vue:231` link `/activity` → `/`.
- `ActivityPage.vue` "Choose contact" link `/` → `/contacts`.
- `App.vue` nav links, active classes, badge placement.

## Testing

`npm run test` + manual route walk; change is composition, not logic.
