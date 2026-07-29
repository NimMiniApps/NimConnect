# Admin Stats: Claimed Handles

## Goal

Extend the hidden admin stats page so it reports adoption of the shared
on-chain handle registry as well as app usage.

The page will show:

- a `Claimed handles` headline total for unique handles that are currently
  owned; and
- a daily `Handles claimed` count grouped by the current winning claim's UTC
  date.

## Source of truth

Claim metrics come from `HandleRegistry`, not the usage-oriented `Stats` JSON
file. The registry rebuild already replays the complete fetched transaction
history in chain order and applies the canonical claim, release, and reclaim
rules.

The Nimiq RPC transaction response includes a millisecond Unix `timestamp`.
The backend will retain that timestamp on each current winning `HandleClaim`.
Existing warm-start registry files remain compatible because the new field is
optional when decoding old JSON. The next successful full sweep backfills it.

## Metric semantics

`unique_handles` is the size of the registry's current handle-to-owner map.
Each handle contributes at most once regardless of repeated or rejected claim
transactions.

Daily `handles` groups those same current winning claims by the UTC date of
their transaction timestamp. Consequently:

- a valid release removes the handle from the total and from its previous
  claim date;
- a valid reclaim adds it under the reclaim transaction's date;
- rejected duplicate claims do not affect either metric; and
- daily handle counts sum to the headline total after timestamps have been
  backfilled.

Claims loaded from a legacy cache with no timestamp remain included in the
headline total but are omitted from daily buckets until the next successful
chain sweep.

## Backend and API

`rpcTx` gains the timestamp returned by the RPC. `HandleClaim` persists the
winning claim timestamp.

`HandleRegistry` exposes a read-locked summary method that returns the current
unique-handle total and UTC-day counts. It returns copied aggregate data rather
than exposing the internal registry map.

`GET /api/stats` receives the registry as a dependency and merges its day
buckets with usage days. The response adds:

- `unique_handles` at the top level; and
- `handles` on each day.

Dates containing only handle claims are included with zero wallets and opens.
When the registry is disabled, the endpoint returns zero handle metrics while
preserving the existing stats response shape plus the new fields.

## Frontend

`StatsSummary` and `DayStats` gain the new numeric fields. The admin page:

- changes its description to mention claimed handles;
- renders a third `Claimed handles` total card; and
- renders a `Handles claimed` table column.

The totals grid remains responsive and allows three equal columns at the
current desktop width.

## Verification

Backend tests will first prove:

- RPC timestamps survive registry rebuild and persistence;
- releases and reclaims update current total and daily attribution;
- the stats summary merges usage-only and claim-only days; and
- a disabled registry produces zero handle metrics.

Frontend tests will first prove the new headline total and daily column render
from the API contract. Existing authentication and error-state behavior remain
unchanged.

After focused red-green cycles, run all backend Go tests, the frontend test
suite, the production frontend build, and `git diff --check`.
