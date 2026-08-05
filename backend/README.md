# NimConnect backend

Go REST API for NimConnect: CoinGecko-backed exchange rates, encrypted cloud backup storage, and (when configured) on-chain @handle registry with signed public profiles.

Handle marketplace / escrow is the most operationally sensitive part of this
service — see [`docs/escrow-architecture.md`](../docs/escrow-architecture.md)
for the trade state machine, the escrow wallet's security model, and known
gaps before touching anything in `marketplace_*.go` or `escrow_wallet.go`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness check (process up; no DB) |
| `GET` | `/api/ready` | Readiness check (`Ping` Postgres; 503 if DB unreachable) |
| `GET` | `/api/rates` | NIM/fiat rates (60s cache) |
| `GET` | `/api/backup/{address}` | Download encrypted backup ciphertext |
| `PUT` | `/api/backup/{address}` | Upload backup (requires wallet signature) |
| `HEAD` | `/api/backup/{address}` | Check if backup exists |
| `POST` | `/api/admin/login` | Wallet-signed admin login → session token |
| `POST` | `/api/session` | Wallet-signed user session → `X-NimConnect-Session` token (friends auth) |
| `DELETE` | `/api/session` | Revoke user session |
| `POST` | `/api/auth/challenges` | Create a five-minute scoped authorization challenge |
| `POST` | `/api/auth/sessions` | Exchange a signed challenge for a seven-day bearer grant |
| `GET` / `DELETE` | `/api/auth/session` | Inspect or revoke the current `Authorization: Bearer` grant |
| `DELETE` | `/api/auth/sessions` | Revoke all scoped grants for the wallet |
| `GET` | `/api/friends` | Accepted friends (requires `X-NimConnect-Session`) |
| `GET` | `/api/friends/requests` | Incoming + outgoing pending friend requests |
| `POST` | `/api/friends/requests` | Send friend request by handle or address |
| `POST` | `/api/friends/requests/{id}/accept` | Accept a pending request (recipient only) |
| `POST` | `/api/friends/requests/{id}/decline` | Decline a pending request (recipient only) |
| `DELETE` | `/api/friends/{address}` | Remove an accepted friendship |
| `GET` | `/api/stats` | Usage stats (requires `X-Admin-Session` header from `/api/admin/login`) |
| `GET` | `/api/admin/handles` | On-chain handle claims (requires `X-Admin-Session`) |
| `GET` | `/api/admin/marketplace` | Trades by state (with a `stuck` flag), ledger vs. on-chain escrow balance (requires `X-Admin-Session`, `ESCROW_ADDRESS`) |
| `GET` | `/api/resolve/{handle}` | Resolve @handle → address (requires `REGISTRY_ADDRESS`) |
| `GET` | `/api/pay/resolve/{handle}` | Freshly resolve @handle → payment address; returns 503 rather than stale data when chain refresh fails |
| `GET` | `/api/profile/{address}` | Fetch signed public profile JSON |
| `PUT` | `/api/profile/{address}` | Store signed profile (wallet signature) |
| `DELETE` | `/api/profile/{address}` | Delete profile (signed headers) |
| `GET` | `/api/handles/check?h=` | Advisory handle availability check |
| `POST` | `/api/handles/claims` | Submit claim tx hash or Hub raw_hex for fast indexing |
| `GET` | `/api/chain/height` | Current chain tip height (cached 2s) |
| `POST` | `/api/marketplace/listings` | List an owned @handle for sale (requires `ESCROW_ADDRESS`) |
| `GET` | `/api/marketplace/listings` | Active listings |
| `POST` | `/api/marketplace/trades` | Reserve a listing, returns escrow deposit details |
| `GET` | `/api/marketplace/trades/{tradeID}` | Trade status |
| `GET` | `/api/marketplace/trades/by-wallet/{address}` | Trades for a wallet (signed lookup) |
| `POST` | `/api/marketplace/trades/{tradeID}/release` | Submit the seller's release transaction |
| `POST` | `/api/marketplace/trades/{tradeID}/claim` | Submit the buyer's claim transaction |

### Health vs readiness

- **`/api/health`** — liveness. Returns 200 as long as the HTTP server is running. Use for "is the process alive?" probes that should not fail when Postgres is briefly unavailable.
- **`/api/ready`** — readiness. Returns 200 only when Postgres responds to `Ping`. Use for orchestrator startup/readiness gates (Docker, Swarm, k8s) before routing traffic.

Backup uploads must sign: `nimconnect-backup:v1:{address}:{exported_at}`

Nimiq Pay prefixes and SHA-256-hashes that string before Ed25519 signing (same as Hub `signMessage`). The backend verifies using that Nimiq message format, not a raw Ed25519 sign of the challenge string.

The server stores only encrypted blobs — it cannot read contact data.

The normal `/api/resolve/{handle}` endpoint is cacheable identity data. Payment
clients should use `/api/pay/resolve/{handle}` immediately before showing and
again before signing a payment. The payment resolver performs the existing
rate-limited registry sweep, responds with `Cache-Control: no-store`, and
refuses to serve the warm-start claim if the RPC refresh fails.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Listen port |
| `DATABASE_URL` | _(required)_ | Postgres connection string (e.g. `postgres://user:pass@host:5432/nimconnect?sslmode=disable`) |
| `COINGECKO_API_BASE` | CoinGecko v3 URL | Rates source |
| `ALLOWED_ORIGIN` | `*` | CORS origins (comma-separated) |
| `BACKUP_DIR` | `/data/backups` | Filesystem path for backup JSON files |
| `STATS_FILE` | `/data/stats.json` | **Import-only / deprecated** — legacy stats JSON for one-shot migration |
| `ADMIN_ADDRESSES` | _(unset)_ | Comma-separated Nimiq addresses allowed to sign in at `/api/admin/login`; unset = `/api/stats` always returns 401 |
| `REGISTRY_ADDRESS` | _(unset)_ | Enables handle registry + profile API; unset = routes 404 |
| `NIMIQ_RPC_URL` | `https://rpc-mainnet.nimiqscan.com` | JSON-RPC endpoint for claim indexing |
| `HANDLES_FILE` | `/data/handles.json` | **Import-only / deprecated** — legacy handle cache for one-shot migration |
| `PROFILES_DIR` | `/data/profiles` | **Import-only / deprecated** — legacy profile JSON files for one-shot migration |
| `RESERVED_HANDLES_FILE` | `/data/reserved-handles.json` | Optional JSON array overriding builtin reserved handles |
| `ESCROW_ADDRESS` | _(unset)_ | Enables the handle marketplace; unset = marketplace routes 404. See [escrow architecture](../docs/escrow-architecture.md) |
| `NIMIQ_WALLET_KEY` | _(unset, required with `ESCROW_ADDRESS`)_ | Escrow account's private key (hex) — imported into `ESCROW_SIGNER_RPC_URL`'s node at startup, never sent anywhere else |
| `ESCROW_SIGNER_RPC_URL` | _(unset, required with `ESCROW_ADDRESS`)_ | Our own node's RPC — must never be a public gateway |
| `ESCROW_SIGNER_RPC_USER` / `ESCROW_SIGNER_RPC_PASSWORD` | _(unset, optional)_ | RPC basic auth, on top of network isolation |
| `MARKETPLACE_MAX_FEE_BPS` | `1000` (10%) | Cap on the seller-set marketplace fee |
| `MARKETPLACE_FILE` | `/data/marketplace.json` | **Import-only / deprecated** — legacy listings/trades JSON for one-shot migration |
| `MARKETPLACE_LEDGER_FILE` | `/data/marketplace_ledger.jsonl` | **Import-only / deprecated** — legacy escrow ledger JSONL for one-shot migration |

Friends API details: [`docs/api/friends.md`](../docs/api/friends.md).
Scoped authorization, registered origins, migration order, compatibility, and
the on-chain exclusion: [`docs/api/scoped-authorization.md`](../docs/api/scoped-authorization.md).

## Local development

```bash
cd backend
go run .
# curl http://localhost:8787/api/health
```

Or with Docker (from repo root):

```bash
docker compose up --build
# curl http://localhost:8787/api/health
```

Backups persist in `./data/backups` (gitignored).

Frontend dev proxy (see root `vite.config.ts`) forwards `/api` to `localhost:8787`.

## Deployment (Docker Swarm + Traefik)

1. Set GitHub repo variable `VITE_API_BASE_URL=https://api-nimconnect.nimiqminiapps.com`
2. Push to `main` — CI builds `nimconnect-backend` and `nimconnect-frontend` images on GHCR
3. Copy `docker-compose.homelab.yml.example` → `docker-compose.homelab.yml`
4. Point DNS: `nimconnect.nimiqminiapps.com` (frontend), `api-nimconnect.nimiqminiapps.com` (API)
5. `docker stack deploy -c docker-compose.homelab.yml nimconnect`
6. After deploys, rollout services to pick up new images (Swarm caches `:latest`)

## Postgres cutover

One-shot migration from legacy JSON/JSONL on `/data` to Postgres. The backend
runs `Migrate` on boot, then `ImportLegacyIfEmpty` when core tables are empty.

1. **Snapshot legacy data** — copy or snapshot the `/data` volume (`marketplace.json`, `marketplace_ledger.jsonl`, `stats.json`, `handles.json`, `profiles/`, `inbox/`) before deploy.
2. **Deploy Postgres + backend** — set `DATABASE_URL`; start Postgres before or with the backend so migrations and import can run.
3. **Confirm import logs** — on first boot with legacy files present, successfully imported sources are renamed to `*.imported-<unix>` beside the original path. Import failures exit the process and leave sources untouched for retry.
4. **Smoke test** — `/api/health`, `/api/ready`, `/api/resolve/{handle}`, `/api/profile/{address}`, `/api/marketplace/listings`, `/api/stats` (admin session), inbox send/receive.
5. **Clean up** — keep `*.imported-*` quarantine files until ops confirms Postgres data; then delete the originals and quarantine copies.

Legacy env vars (`MARKETPLACE_FILE`, `STATS_FILE`, etc.) are import-only; runtime
state lives in Postgres.

## Backups

| Data | Method |
|------|--------|
| App state (marketplace, ledger, profiles, stats, inbox, handle cache) | `pg_dump` of the Postgres database, or volume snapshots of the Postgres data directory |
| Encrypted wallet backups | Unchanged — `BACKUP_DIR` volume |

## Tests

```bash
go test ./...
```

## Inbox rate limiting

App-level inbox limits (100/mailbox, 10/sender, nonce idempotency) are
wallet-independent. Per-IP rate limiting is deliberately left to the reverse
proxy — add to the nginx server block in front of the API:

    limit_req_zone $binary_remote_addr zone=inbox:1m rate=10r/m;
    location /api/inbox/ { limit_req zone=inbox burst=20 nodelay; proxy_pass ...; }

Mount `INBOX_DIR` (default `/data/inbox`) on the same volume as backups.
