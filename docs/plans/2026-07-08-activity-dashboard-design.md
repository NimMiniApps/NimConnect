# NimConnect Activity Dashboard Design

**Date:** 2026-07-08
**Status:** Approved direction, first implementation slice

## Goal

Make NimConnect useful before it has many users by turning hidden per-contact payment work into visible follow-up work. The first slice adds an Activity surface for pending invoices, a small dashboard on Contacts, and contact-row badges for open payment work.

## Approach

Use the existing local-first data model. Invoices already persist in Dexie and belong to payer addresses, so Activity can be a read/write view over the invoices store without adding backend state or changing request-link behavior.

The bottom navigation changes from a global Split shortcut to Contacts / Activity / Profile. Split remains available from profiles, while Activity becomes the daily operational surface: see what is open, copy payment links, mark invoices paid, delete stale invoices, and jump back to the contact.

## UX

- Contacts opens with a compact status strip: pending invoice count, total open NIM, and recent contact count.
- Contact rows show a pending badge when that profile has unpaid invoices.
- Activity lists pending invoices across all contacts, newest first.
- Each Activity item shows contact name, invoice description, NIM amount, optional fiat amount, created date, and direct actions.
- Empty Activity gives first-run direction instead of a blank list.

## Non-goals

- No backend sync.
- No automatic chain reconciliation for invoices.
- No messaging or reminders beyond copying existing request links.
- No new invoice schema fields unless needed by tests.

## Testing

Unit-test the invoices store for pending summaries and totals. UI is manually verified with the Vite app because this repo currently has no component or E2E test harness.
