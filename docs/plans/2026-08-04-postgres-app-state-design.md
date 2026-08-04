# Postgres app-state persistence — design

Date: 2026-08-04
Status: approved

## Goal

Replace file-backed JSON / JSONL app state with **Postgres** so marketplace,
profiles, stats, inbox, handle cache, and upcoming friends graph share one
durable, queryable, multi-instance-ready store — while encrypted wallet backups
stay on the filesystem.

## Decisions

| Topic | Choice |
|---|---|
| Database | Postgres (Compose/Swarm service + volume) |
| Scope | All app-owned state + handle warm-start cache |
| Migration style | Big-bang cutover (low user count; no long dual-write) |
| Schema style | Normalized tables (not JSONB document lift-and-shift) |
| Handles | Cache table in Postgres; purge + chain rebuild supported |
| Backups (encrypted blobs) | Stay on `BACKUP_DIR` volume |
| Friends | Born on Postgres; supersedes planned `/data/friends.json` |
| Fail mode | No production JSON fallback; DB required to start |

## Motivation

JSON + mutex stores worked for MVP, but marketplace already needs real
transactions, and stacking friends / more features on more JSON files is the
wrong default. Postgres gives atomic transitions, constraints, backups
(`pg_dump`), and a clear path for multi-instance later.

## Non-goals

- Moving encrypted wallet backups into Postgres
- Changing public API shapes (except optional admin handle resync)
- Multi-region / read replicas in this slice
- Incremental dual-write coexistence with JSON in production

## Architecture

```text
Client / admin / ecosystem apps
        │
        ▼
NimConnect backend (Go)
        │
        ├── Postgres  ← marketplace, ledger, profiles, stats,
        │               inbox, handle_claims, friendships
        │
        ├── /data/backups  ← encrypted blobs only
        │
        └── Nimiq RPC / escrow signer  ← unchanged
```

**Runtime**

1. Require `DATABASE_URL`.
2. On boot: connect → run migrations → if DB empty and legacy files exist,
   one-shot import → quarantine/rename source files (do not delete on first
   deploy).
3. Serve traffic. Store call sites stay similar; internals use SQL
   transactions.
4. Fail closed: migrate/import/DB errors exit the process.

**Handles**

Chain remains source of truth. `handle_claims` is a warm-start / lookup cache
written by the existing registry rebuild. Admin (or ops) can purge the table
and force a full resync for speed and correctness after drift.

## Schema (logical)

| Table | Notes |
|---|---|
| `marketplace_listings` | PK `handle`; partial unique on active status |
| `marketplace_trades` | PK `id`; unique `reference`; version for optimistic transitions |
| `marketplace_nonces` | PK `nonce` |
| `escrow_ledger` | PK `sequence`; append-only; never UPDATE existing rows |
| `profiles` | PK compact address; signed payload + metadata |
| `stats_days` | PK UTC day; opens counter |
| `stats_day_wallets` | PK (day, address) |
| `inbox_messages` | PK `id`; indexed by recipient; dedupe constraints as today |
| `handle_claims` | PK `handle`; cache only |
| `friendships` | As friends design (`pending` / `accepted` / `declined`) |

Constraints replace mutex guarantees: one active listing per handle, at most
one active trade per listing, unique nonces, append-only ledger.

## Cutover

See the step-by-step checklist in [`backend/README.md`](../../backend/README.md#postgres-cutover).

1. Add Postgres to Compose / Swarm; wire `DATABASE_URL` + secrets.
2. Deploy backend that migrates on boot.
3. Short maintenance window: snapshot existing volumes, deploy, verify import
   logs (`*.imported-*` renames), smoke health/ready/resolve/profile/listings/stats/inbox.
4. Quarantined legacy files retained until ops confirms; then remove.

## Errors

| Failure | Behavior |
|---|---|
| DB unreachable / migrate fail | Process exits |
| Import fail | Exit; leave files untouched for retry |
| Constraint violation | Same HTTP 4xx semantics as today |
| Mid-mutation SQL error | Transaction rollback; no partial write |

## Testing

- Integration tests against real Postgres (CI service or testcontainers).
- Importer fixtures from current JSON / JSONL shapes.
- Existing marketplace / handle / inbox / stats behavior tests retargeted to
  DB-backed stores.

## Ops

- App-state backup: `pg_dump` (or Postgres volume snapshots).
- Encrypted wallet backups: unchanged volume.
- Optional readiness: DB ping so orchestrators do not route before migrate.

## Relation to other plans

- Supersedes file persistence notes in
  `docs/plans/2026-08-04-friends-social-graph-design.md` (friends store →
  Postgres `friendships`).
- Marketplace escrow security model in `docs/escrow-architecture.md` is
  unchanged; only the persistence substrate moves.
