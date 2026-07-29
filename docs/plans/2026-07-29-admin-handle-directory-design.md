# Admin Handle Directory

## Goal

Let an authenticated administrator inspect every handle that is currently
owned in the shared on-chain registry.

The first release is admin-only. A public directory can be considered later
without changing the registry or claim semantics.

## Source of truth

The directory reads a snapshot of `HandleRegistry`. It does not introduce a
second database or derive ownership from profiles, app usage, or submitted
claim requests.

Only current winning claims are listed. Handles removed by a valid release are
absent; a valid reclaim appears with its new owner, claim transaction, and
claim timestamp.

## Backend

`HandleRegistry` exposes a read-locked method that copies its current claims
into a slice and sorts it alphabetically by handle. Callers never receive the
registry's internal map.

A new `GET /api/admin/handles` endpoint returns:

```json
{
  "handles": [
    {
      "handle": "alice",
      "address": "NQ...",
      "tx_hash": "...",
      "claimed_at": 1785270866171
    }
  ]
}
```

The endpoint uses the same `X-Admin-Session` validation as `GET /api/stats`.
It returns `401` for a missing or invalid session. When the registry is
disabled, it returns an empty list rather than exposing an unavailable public
route.

No pagination, server-side search, or public endpoint is included. The
registry already holds the current set in memory and the initial list is
small.

## Frontend

The admin service gains a typed `fetchAdminHandles()` call using the stored
admin session and existing API-origin helper. A `401` clears the session and
raises the same `AdminSessionExpiredError` used by stats.

The admin stats page loads stats and the handle directory together after
authentication. Beneath the daily stats table it renders:

- `Current handles (N)`;
- a client-side search field matching handle or wallet address; and
- an alphabetical table with handle, owner address, claim date, and claim
  transaction.

Handles link to their public profile. Transaction hashes link to the existing
mainnet transaction explorer in a new tab. Addresses and hashes are visually
truncated but remain available in full through their link/title values.

An empty registry shows a quiet `No handles are currently claimed.` state. A
search with no matches shows `No matching handles.` The page's existing
loading, retry, and reconnect states cover both requests so it never presents
partial admin data as a complete snapshot.

## Verification

Backend tests cover deterministic alphabetical copying, release/reclaim
behavior, session authentication, and the disabled-registry empty response.

Frontend service tests cover URL/header behavior and `401` session clearing.
Page tests cover rendering, alphabetical data, handle/address filtering, empty
states, and public/explorer links.

After focused red-green cycles, run the complete backend test suite, the root
frontend suite with nested worktrees excluded, the production build, and
`git diff --check`.
