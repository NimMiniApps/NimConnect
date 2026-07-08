# NimConnect backend

Go REST API for NimConnect: CoinGecko-backed exchange rates and encrypted cloud backup storage.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/rates` | NIM/fiat rates (60s cache) |
| `GET` | `/api/backup/{address}` | Download encrypted backup ciphertext |
| `PUT` | `/api/backup/{address}` | Upload backup (requires wallet signature) |
| `HEAD` | `/api/backup/{address}` | Check if backup exists |

Backup uploads must sign: `nimconnect-backup:v1:{address}:{exported_at}`

The server stores only encrypted blobs — it cannot read contact data.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Listen port |
| `COINGECKO_API_BASE` | CoinGecko v3 URL | Rates source |
| `ALLOWED_ORIGIN` | `*` | CORS origins (comma-separated) |
| `BACKUP_DIR` | `/data/backups` | Filesystem path for backup JSON files |

## Local development

```bash
cd backend
go run .
# curl http://localhost:8787/api/health
```

Frontend dev proxy (see root `vite.config.ts`) forwards `/api` to `localhost:8787`.

## Deployment

1. Copy `docker-compose.homelab.yml.example` → `docker-compose.homelab.yml`
2. Set Traefik host to your API domain (e.g. `api-nimconnect.maestroi.cc`)
3. `docker stack deploy -c docker-compose.homelab.yml nimconnect`
4. Set GitHub repo variable `VITE_API_BASE_URL` for Pages builds

## Tests

```bash
go test ./...
```
