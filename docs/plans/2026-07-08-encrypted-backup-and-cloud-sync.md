# Encrypted Backup & Cloud Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users recover contacts/invoices after an app reset via encrypted local backups and optional wallet-bound cloud sync, backed by a NimConnect-owned Go API (rates + backup storage) copied from NimiqLens.

**Architecture:** Phase 1 adds client-side E2E encryption (Web Crypto PBKDF2 + AES-GCM) around the existing `ExportDocument` format, with restore prompts on empty DB. Phase 2 adds a Go backend cloned from NimiqLens (`/api/rates` + `/api/backup/{address}`) that stores only ciphertext; uploads are authorized by a Nimiq wallet `sign()` over a deterministic challenge. Rates move from the shared NimiqLens API to NimConnect's own deployment.

**Tech Stack:** Vue 3, Dexie, Web Crypto API, Go 1.22 stdlib HTTP, Docker/Swarm (Traefik), `@nimiq/mini-app-sdk` `sign()`.

---

## Overview

| Phase | What | Backend? |
|-------|------|----------|
| 1 | Encrypted `.nimconnect` files, restore on empty DB, Settings UX | No |
| 2 | Cloud backup PUT/GET, auto-sync on change, own `/api/rates` | Yes — copy NimiqLens `backend/` |

**Security model (both phases):**
- Plaintext never leaves the device unencrypted
- Passphrase → PBKDF2 (100k iterations, random 16-byte salt) → AES-256-GCM key
- Cloud server stores `{ ciphertext, exportedAt, publicKey, signature }` only
- `PUT /api/backup/{address}` requires valid Nimiq `sign()` over `nimconnect-backup:v1:{address}:{exportedAt}`
- `GET /api/backup/{address}` returns ciphertext only (safe without passphrase; hides existence minimally via 404 when empty)

---

## Phase 1 — Encrypted Local Backup

### Task 1: Crypto helpers

**Files:**
- Create: `src/services/crypto.ts`
- Create: `src/services/crypto.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, deriveKey } from './crypto'

describe('crypto', () => {
  it('round-trips JSON through encrypt/decrypt', async () => {
    const plain = JSON.stringify({ hello: 'world' })
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveKey('test-passphrase', salt)
    const blob = await encrypt(plain, key)
    expect(await decrypt(blob, key)).toBe(plain)
  })

  it('fails decrypt with wrong passphrase', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveKey('right', salt)
    const blob = await encrypt('secret', key)
    const wrong = await deriveKey('wrong', salt)
    await expect(decrypt(blob, wrong)).rejects.toThrow()
  })
})
```

**Step 2: Run test — expect FAIL**

Run: `npm test -- src/services/crypto.test.ts`

**Step 3: Implement**

```typescript
// src/services/crypto.ts
const PBKDF2_ITERATIONS = 100_000

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export async function encrypt(plaintext: string, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext),
  )
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return out
}

export async function decrypt(blob: Uint8Array, key: CryptoKey): Promise<string> {
  const iv = blob.slice(0, 12)
  const ct = blob.slice(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(plain)
}
```

**Step 4: Run test — expect PASS**

**Step 5: Commit**

```bash
git add src/services/crypto.ts src/services/crypto.test.ts
git commit -m "feat: add Web Crypto encrypt/decrypt helpers for backups"
```

---

### Task 2: Encrypted backup file format

**Files:**
- Create: `src/services/backup.ts`
- Create: `src/services/backup.test.ts`
- Modify: `src/types/profile.ts` (add `EncryptedBackup` type)

**Step 1: Add type**

```typescript
// src/types/profile.ts — append
export interface EncryptedBackup {
  app: 'NimConnect'
  format: 'encrypted-backup'
  version: 1
  /** Normalized NQ address — metadata only, not secret */
  address?: string
  salt: string       // base64
  exportedAt: number
  ciphertext: string // base64
}
```

**Step 2: Write failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '../db/db'
import { useProfilesStore } from '../stores/profiles'
import { createEncryptedBackup, parseEncryptedBackup } from './backup'

const A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000 0000'

describe('backup', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.profiles.clear()
    await db.invoices.clear()
  })

  it('round-trips export through encrypt/decrypt import', async () => {
    const store = useProfilesStore()
    await store.load()
    await store.add({ address: A, name: 'Alice' })
    const file = await createEncryptedBackup('secret', A)
    expect(file.format).toBe('encrypted-backup')

    await db.profiles.clear()
    setActivePinia(createPinia())
    const store2 = useProfilesStore()
    await store2.load()
    const doc = await parseEncryptedBackup(file, 'secret')
    await store2.importDocument(doc)
    expect(store2.profiles).toHaveLength(1)
    expect(store2.profiles[0].name).toBe('Alice')
  })
})
```

**Step 3: Implement `backup.ts`**

```typescript
import type { EncryptedBackup, ExportDocument } from '../types/profile'
import { useProfilesStore } from '../stores/profiles'
import { deriveKey, encrypt, decrypt } from './crypto'

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}
function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

export async function createEncryptedBackup(passphrase: string, address?: string): Promise<EncryptedBackup> {
  const store = useProfilesStore()
  const doc = await store.exportDocument()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt)
  const ciphertext = await encrypt(JSON.stringify(doc), key)
  return {
    app: 'NimConnect',
    format: 'encrypted-backup',
    version: 1,
    address,
    salt: b64(salt),
    exportedAt: doc.exportedAt,
    ciphertext: b64(ciphertext),
  }
}

export async function parseEncryptedBackup(file: EncryptedBackup, passphrase: string): Promise<ExportDocument> {
  if (file.app !== 'NimConnect' || file.format !== 'encrypted-backup' || file.version !== 1) {
    throw new Error('invalid-backup')
  }
  const salt = fromB64(file.salt)
  const key = await deriveKey(passphrase, salt)
  const plain = await decrypt(fromB64(file.ciphertext), key)
  return JSON.parse(plain) as ExportDocument
}
```

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add src/types/profile.ts src/services/backup.ts src/services/backup.test.ts
git commit -m "feat: encrypted backup file format around ExportDocument"
```

---

### Task 3: Backup preferences

**Files:**
- Modify: `src/services/prefs.ts`
- Create: `src/services/backup-prefs.ts`

Track in localStorage:
- `nimconnect:backup-passphrase-set` — boolean flag (never store the passphrase itself)
- `nimconnect:last-local-backup-at` — timestamp
- `nimconnect:last-cloud-sync-at` — timestamp (Phase 2)
- `nimconnect:cloud-backup-enabled` — boolean

```typescript
// src/services/backup-prefs.ts
import { ref, watch } from 'vue'

const ENABLED_KEY = 'nimconnect:cloud-backup-enabled'
const LOCAL_AT_KEY = 'nimconnect:last-local-backup-at'
const CLOUD_AT_KEY = 'nimconnect:last-cloud-sync-at'

export const cloudBackupEnabled = ref(globalThis.localStorage?.getItem(ENABLED_KEY) === '1')
export const lastLocalBackupAt = ref(Number(globalThis.localStorage?.getItem(LOCAL_AT_KEY) || 0))
export const lastCloudSyncAt = ref(Number(globalThis.localStorage?.getItem(CLOUD_AT_KEY) || 0))

watch(cloudBackupEnabled, v => {
  try { globalThis.localStorage?.setItem(ENABLED_KEY, v ? '1' : '0') } catch {}
})
export function markLocalBackup() {
  lastLocalBackupAt.value = Date.now()
  try { globalThis.localStorage?.setItem(LOCAL_AT_KEY, String(lastLocalBackupAt.value)) } catch {}
}
export function markCloudSync() {
  lastCloudSyncAt.value = Date.now()
  try { globalThis.localStorage?.setItem(CLOUD_AT_KEY, String(lastCloudSyncAt.value)) } catch {}
}
```

**Commit:** `feat: backup preference keys in localStorage`

---

### Task 4: Settings UI — encrypted export/import

**Files:**
- Modify: `src/pages/SettingsPage.vue`

Changes:
1. Replace plain JSON export with encrypted `.nimconnect` download (prompt for passphrase if first time; confirm passphrase twice on setup)
2. Import accepts both legacy plain JSON **and** `.nimconnect` encrypted files
3. Show "Last backed up: …" from `lastLocalBackupAt`
4. Keep plain JSON export as "Advanced → Export unencrypted JSON" (collapsed section) for power users

Download helper:

```typescript
async function exportEncrypted() {
  const passphrase = await promptPassphrase() // modal component
  const address = store.self?.address
  const file = await createEncryptedBackup(passphrase, address)
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
  // ... trigger download as nimconnect-backup-YYYY-MM-DD.nimconnect
  markLocalBackup()
}
```

Import detects format:

```typescript
const parsed = JSON.parse(text)
if (parsed.format === 'encrypted-backup') {
  const passphrase = await promptPassphrase()
  const doc = await parseEncryptedBackup(parsed, passphrase)
  await store.importDocument(doc)
} else {
  await store.importDocument(parsed) // existing path
}
```

**Commit:** `feat: encrypted backup export/import in Settings`

---

### Task 5: Restore prompt on empty database

**Files:**
- Create: `src/components/RestoreBackupSheet.vue`
- Modify: `src/App.vue`

After `bootstrapWallet()`, if `profiles.length === 0` (and no `nimconnect:skipped-restore` flag), show a bottom sheet:

> "No contacts found. Restore from an encrypted backup?"

Actions:
- **Choose file** → import encrypted backup flow
- **Try cloud restore** (Phase 2 — disabled/hidden until backend exists)
- **Start fresh** → set `nimconnect:skipped-restore=1`

```typescript
// App.vue onMounted
await bootstrapWallet()
const store = useProfilesStore()
await store.load()
if (store.profiles.length === 0 && !localStorage.getItem('nimconnect:skipped-restore')) {
  restoreOpen.value = true
}
```

**Commit:** `feat: offer restore when database is empty on launch`

---

## Phase 2 — NimConnect Backend (copy NimiqLens)

### Task 6: Scaffold backend from NimiqLens

**Files:**
- Create: `backend/` (copy from `../NimiqLens/backend/`)
- Modify: service name → `nimconnect-backend`
- Create: `backend/go.mod` (module `nimconnect-backend`)
- Create: `backend/Dockerfile` (copy NimiqLens)
- Create: `.env.example`
- Create: `docker-compose.homelab.yml.example`

**Copy these files verbatim (rename service strings):**
- `main.go`, `handlers.go`, `rates.go`, `rates_test.go`, `cache.go`, `cache_test.go`
- `cors.go`, `cors_test.go`, `logging.go`, `version.go`
- `Dockerfile`, `.dockerignore`

**Omit from NimConnect v1:** `balance.go` — NimConnect doesn't need balance proxy (wallet handles that). Can add later.

**Update `main.go` root endpoints:**

```go
"endpoints": map[string]string{
    "health":  "/api/health",
    "rates":   "/api/rates",
    "backup":  "/api/backup/{address}",
    "version": "/api/version",
},
```

**Update CORS** in `cors.go` to allow `PUT` and custom headers:

```go
w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Nimiq-Signature, X-Nimiq-Public-Key")
```

**Commit:** `feat: scaffold Go backend from NimiqLens (rates + health)`

---

### Task 7: Backup storage handler

**Files:**
- Create: `backend/backup.go`
- Create: `backend/backup_test.go`
- Create: `backend/auth.go`
- Create: `backend/auth_test.go`
- Modify: `backend/main.go`
- Modify: `backend/handlers.go`

**Storage:** filesystem at `BACKUP_DIR` (default `/data/backups`), one file per normalized address:
`{address-without-spaces}.json`

**Record shape:**

```json
{
  "address": "NQ07...",
  "exported_at": 1710000000000,
  "ciphertext": "<base64>",
  "public_key": "<hex>",
  "signature": "<hex>"
}
```

**Endpoints:**

| Method | Path | Auth | Response |
|--------|------|------|----------|
| `GET` | `/api/backup/{address}` | None | `200` record or `404` |
| `PUT` | `/api/backup/{address}` | Signature | `200` `{ "ok": true, "exported_at": ... }` |
| `HEAD` | `/api/backup/{address}` | None | `200` if exists, `404` if not |

**PUT body:**

```json
{
  "exported_at": 1710000000000,
  "ciphertext": "<base64>",
  "public_key": "<hex>",
  "signature": "<hex>"
}
```

**Challenge signed by wallet:**

```
nimconnect-backup:v1:{normalizedAddress}:{exported_at}
```

**Auth verification (`auth.go`):**
1. Decode hex `public_key` (32 bytes) and `signature` (64 bytes)
2. Verify Ed25519 signature over UTF-8 challenge
3. Derive Nimiq address from public key and compare to path `{address}` (normalize both — strip spaces, case-insensitive)
4. Use `github.com/nimiq/core-go/pkg/address` or port the short address derivation (see Nimiq Core `PublicKey.toAddress()`)

If signature lib is heavy, acceptable v1 fallback: require `public_key` to match a previously stored key for that address (first upload sets owner), still verify Ed25519 signature on every PUT.

**Tests:**
- PUT with valid mock signature → 200
- PUT with bad signature → 401
- PUT older `exported_at` than stored → 409 Conflict
- GET returns stored record
- GET unknown address → 404

**Commit:** `feat: backup PUT/GET with wallet signature auth`

---

### Task 8: Docker & CI

**Files:**
- Create: `.github/workflows/docker-build.yml` (copy NimiqLens, rename images to `nimconnect-backend`)
- Create: `docker-compose.homelab.yml.example`

```yaml
# docker-compose.homelab.yml.example
services:
  backend:
    image: ghcr.io/<github-username>/nimconnect-backend:latest
    environment:
      - PORT=8787
      - COINGECKO_API_BASE=https://api.coingecko.com/api/v3
      - ALLOWED_ORIGIN=https://nimminiapps.github.io,https://maestroi.github.io
      - BACKUP_DIR=/data/backups
    volumes:
      - nimconnect_backups:/data/backups
    networks:
      - traefik
    deploy:
      labels:
        - traefik.http.routers.nimconnect-api.rule=Host(`api-nimconnect.example.com`)
        # ... same Traefik pattern as NimiqLens

volumes:
  nimconnect_backups:
```

**Commit:** `ci: build and push nimconnect-backend Docker image`

---

### Task 9: Frontend API client

**Files:**
- Create: `src/services/api.ts`
- Modify: `src/services/rates.ts`
- Modify: `vite.config.ts` (dev proxy)
- Modify: `.env.example`

```typescript
// src/services/api.ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export function resolveApiBase(): string {
  return API_BASE.replace(/\/$/, '')
}
```

```typescript
// vite.config.ts — add for local dev
server: {
  proxy: {
    '/api': { target: 'http://localhost:8787', changeOrigin: true },
  },
},
```

```typescript
// src/services/rates.ts — change RATES_URL
import { resolveApiBase } from './api'
const RATES_URL = `${resolveApiBase()}/api/rates`
```

When `VITE_API_BASE_URL` is empty, dev proxy serves `/api/rates` locally. Production build sets `https://api-nimconnect.maestroi.cc`.

**Commit:** `feat: configurable API base URL, dev proxy for rates`

---

### Task 10: Cloud sync client

**Files:**
- Create: `src/services/cloud-backup.ts`
- Create: `src/services/cloud-backup.test.ts`
- Modify: `src/services/nimiq.ts` (add `signChallenge()`)

**`nimiq.ts` addition:**

```typescript
export async function signChallenge(message: string): Promise<{ publicKey: string; signature: string }> {
  const provider = await getProvider()
  if (!provider) throw new Error('Not running inside Nimiq Pay')
  const result = await provider.sign(message)
  if (isErrorResponse(result)) throw new Error(result.error.message)
  return { publicKey: result.publicKey, signature: result.signature }
}
```

**`cloud-backup.ts`:**

```typescript
import { resolveApiBase } from './api'
import { createEncryptedBackup, parseEncryptedBackup } from './backup'
import { signChallenge } from './nimiq'
import type { EncryptedBackup } from '../types/profile'

function challenge(address: string, exportedAt: number) {
  return `nimconnect-backup:v1:${address.replace(/\s+/g, '')}:${exportedAt}`
}

export async function uploadCloudBackup(passphrase: string, address: string): Promise<void> {
  const file = await createEncryptedBackup(passphrase, address)
  const { publicKey, signature } = await signChallenge(challenge(address, file.exportedAt))
  const res = await fetch(`${resolveApiBase()}/api/backup/${encodeURIComponent(address)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      exported_at: file.exportedAt,
      ciphertext: file.ciphertext,
      public_key: publicKey,
      signature,
    }),
  })
  if (!res.ok) throw new Error(`cloud-backup ${res.status}`)
}

export async function downloadCloudBackup(address: string): Promise<EncryptedBackup | null> {
  const res = await fetch(`${resolveApiBase()}/api/backup/${encodeURIComponent(address)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`cloud-backup ${res.status}`)
  const body = await res.json()
  return {
    app: 'NimConnect',
    format: 'encrypted-backup',
    version: 1,
    address: body.address,
    salt: '', // cloud stores only ciphertext blob — see Task 10b
    exportedAt: body.exported_at,
    ciphertext: body.ciphertext,
  }
}
```

**Task 10b: Include salt in cloud payload**

The encrypted backup salt must round-trip. Update PUT body to store the full `EncryptedBackup` fields:

```json
{
  "exported_at": 1710000000000,
  "salt": "<base64>",
  "ciphertext": "<base64>",
  "public_key": "<hex>",
  "signature": "<hex>"
}
```

**Commit:** `feat: cloud backup upload/download client`

---

### Task 11: Auto-sync on data changes

**Files:**
- Modify: `src/stores/profiles.ts`
- Modify: `src/stores/invoices.ts`

Debounce cloud upload (30s) after any write when `cloudBackupEnabled` and wallet address known:

```typescript
// src/services/cloud-backup.ts
let syncTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleCloudSync(passphrase: string, address: string) {
  if (!cloudBackupEnabled.value) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    uploadCloudBackup(passphrase, address).then(markCloudSync).catch(() => {})
  }, 30_000)
}
```

Passphrase handling: keep in memory only for the session after user enters it in Settings ("Enable cloud backup"). Never persist passphrase. If session ends, next sync prompts again.

Hook from store mutations:

```typescript
// profiles.ts — end of add/update/remove
import { scheduleCloudSync, getBackupSession } from '../services/cloud-backup'
// ...
const session = getBackupSession()
if (session) scheduleCloudSync(session.passphrase, session.address)
```

**Commit:** `feat: debounced auto cloud sync after profile changes`

---

### Task 12: Settings cloud backup UI

**Files:**
- Modify: `src/pages/SettingsPage.vue`
- Modify: `src/components/RestoreBackupSheet.vue`

Settings additions:
- Toggle: "Cloud backup" (requires Nimiq Pay + passphrase)
- Status: "Last synced 2 hours ago" / "Not enabled"
- Buttons: "Sync now", "Restore from cloud"
- Passphrase entry modal (same component for export/import)

Restore sheet Phase 2 button:
- Connect wallet → `downloadCloudBackup(address)` → prompt passphrase → `importDocument`

**Commit:** `feat: cloud backup controls in Settings and restore sheet`

---

### Task 13: Deploy & point rates at new API

**Manual steps (document in `backend/README.md`):**

1. `cp docker-compose.homelab.yml.example docker-compose.homelab.yml` — set `api-nimconnect.maestroi.cc`
2. `docker stack deploy -c docker-compose.homelab.yml nimconnect`
3. Set GitHub repo variable `VITE_API_BASE_URL=https://api-nimconnect.maestroi.cc` for Pages build (or update `.github/workflows/pages.yml` build-arg)
4. Verify: `curl https://api-nimconnect.maestroi.cc/api/rates`
5. Verify: encrypted backup round-trip through cloud in Nimiq Pay

**Commit:** `docs: backend deployment and API URL configuration`

---

## Testing checklist

- [ ] `npm test` — all existing + crypto/backup/cloud tests pass
- [ ] `go test ./...` in `backend/`
- [ ] Export `.nimconnect` → reset app → import → contacts restored
- [ ] Wrong passphrase shows clear error, no partial import
- [ ] Legacy plain JSON import still works
- [ ] Empty DB on launch shows restore sheet
- [ ] Cloud PUT rejected without wallet signature
- [ ] Cloud GET + correct passphrase restores data
- [ ] Rates load from new API URL in production build
- [ ] Offline: app works, cloud sync fails silently, local export still works

---

## File tree (new)

```
NimConnect/
├── backend/
│   ├── main.go
│   ├── handlers.go
│   ├── rates.go
│   ├── backup.go
│   ├── auth.go
│   ├── cors.go
│   ├── cache.go
│   ├── Dockerfile
│   └── README.md
├── docker-compose.homelab.yml.example
├── .env.example
├── .github/workflows/docker-build.yml
├── src/
│   ├── services/
│   │   ├── api.ts
│   │   ├── crypto.ts
│   │   ├── backup.ts
│   │   ├── cloud-backup.ts
│   │   └── backup-prefs.ts
│   └── components/
│       └── RestoreBackupSheet.vue
```

---

## Notes

- **No secrets on server:** Backup ciphertext is useless without the user's passphrase.
- **Wallet ≠ passphrase:** Wallet signature proves who can *write* backups for an address; passphrase proves who can *read* them. A user needs both to set up cloud sync.
- **Device ID:** Do not use `requestDeviceIdentifier()` for backup auth — README explicitly says it's device-scoped, not user identity.
- **Conflict policy:** Server rejects PUT if `exported_at` < stored `exported_at` (409). Client shows "Cloud backup is newer — download first?" if local is older.
- **GitHub Pages:** Frontend stays static; only `VITE_API_BASE_URL` changes. No nginx API proxy needed (same as NimiqLens).
