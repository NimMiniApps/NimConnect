# NimConnect backend

Go REST API for NimConnect: CoinGecko-backed exchange rates, encrypted cloud backup storage, and (when configured) on-chain @handle registry with signed public profiles.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/rates` | NIM/fiat rates (60s cache) |
| `GET` | `/api/backup/{address}` | Download encrypted backup ciphertext |
| `PUT` | `/api/backup/{address}` | Upload backup (requires wallet signature) |
| `HEAD` | `/api/backup/{address}` | Check if backup exists |
| `GET` | `/api/stats` | Usage stats (requires `X-Admin-Token` header) |
| `GET` | `/api/resolve/{handle}` | Resolve @handle → address (requires `REGISTRY_ADDRESS`) |
| `GET` | `/api/profile/{address}` | Fetch signed public profile JSON |
| `PUT` | `/api/profile/{address}` | Store signed profile (wallet signature) |
| `DELETE` | `/api/profile/{address}` | Delete profile (signed headers) |
| `GET` | `/api/handles/check?h=` | Advisory handle availability check |
| `POST` | `/api/handles/claims` | Submit claim tx hash for fast indexing |

Backup uploads must sign: `nimconnect-backup:v1:{address}:{exported_at}`

Nimiq Pay prefixes and SHA-256-hashes that string before Ed25519 signing (same as Hub `signMessage`). The backend verifies using that Nimiq message format, not a raw Ed25519 sign of the challenge string.

The server stores only encrypted blobs — it cannot read contact data.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Listen port |
| `COINGECKO_API_BASE` | CoinGecko v3 URL | Rates source |
| `ALLOWED_ORIGIN` | `*` | CORS origins (comma-separated) |
| `BACKUP_DIR` | `/data/backups` | Filesystem path for backup JSON files |
| `STATS_FILE` | `/data/stats.json` | Usage stats persistence file |
| `ADMIN_TOKEN` | _(unset)_ | Enables `/api/stats`; unset = endpoint returns 401 |
| `REGISTRY_ADDRESS` | _(unset)_ | Enables handle registry + profile API; unset = routes 404 |
| `NIMIQ_RPC_URL` | `https://rpc-mainnet.nimiqscan.com` | JSON-RPC endpoint for claim indexing |
| `HANDLES_FILE` | `/data/handles.json` | Persisted handle→claim map (warm-start cache) |
| `PROFILES_DIR` | `/data/profiles` | One signed profile JSON file per address |
| `RESERVED_HANDLES_FILE` | `/data/reserved-handles.json` | Optional JSON array overriding builtin reserved handles |

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
