# Ecosystem Profile Client Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a thin `@nimconnect/profile-client` read package in NimConnect and wire NimBomber to enrich Profile/Lobby/Leaderboard identity from it, while keeping game stats local to Bomber.

**Architecture:** NimConnect remains the write authority for handles + signed public profiles. A small TypeScript package wraps the existing public GET APIs. NimBomber calls that client from the frontend and merges results with its own `/profile` stats. No microservice split; no stats write-back.

**Tech Stack:** TypeScript, Vitest, existing NimConnect Go HTTP APIs, Vue 3 + Pinia (NimBomber), npm workspaces / `file:` dependency.

**Design:** @docs/plans/2026-07-16-ecosystem-profile-client-design.md

---

### Task 1: Document the public read API contract

**Files:**
- Create: `docs/api/public-profile-read.md`

**Step 1: Write the contract doc**

Document these endpoints with request/response shapes matching current handlers in `backend/handles_handlers.go`:

- `GET /api/resolve/{handle}` → handle claim JSON or 404
- `GET /api/profile/{address}` → `{ address, updated_at, profile }` where `profile` is JSON object with optional `display_name`, `bio`, `website`, `github`, `x`, `tags`
- `GET /api/handles/by-address/{address}` → handle claim or 404

Also note:

- Cache: `Cache-Control: public, max-age=60`, ETag support
- CORS: `ALLOWED_ORIGIN` (default `*`; comma-separated allow-list supported)
- Consumers must not call write endpoints (PUT/DELETE profile, claim submit) from other apps

**Step 2: Commit (NimConnect repo)**

```bash
git add docs/api/public-profile-read.md docs/plans/2026-07-16-ecosystem-profile-client-design.md docs/plans/2026-07-16-ecosystem-profile-client.md
git commit -m "$(cat <<'EOF'
docs: add ecosystem profile read API contract and plan

EOF
)"
```

---

### Task 2: Scaffold `@nimconnect/profile-client` package

**Files:**
- Create: `packages/profile-client/package.json`
- Create: `packages/profile-client/tsconfig.json`
- Create: `packages/profile-client/vitest.config.ts`
- Create: `packages/profile-client/src/index.ts`
- Modify: `package.json` (root) — add workspaces + test script hook

**Step 1: Add package skeleton**

`packages/profile-client/package.json`:

```json
{
  "name": "@nimconnect/profile-client",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "~5.7.2",
    "vitest": "^3.0.8"
  },
  "license": "MIT"
}
```

`packages/profile-client/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

Root `package.json` changes:

```json
{
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "test:profile-client": "npm run test -w @nimconnect/profile-client"
  }
}
```

`packages/profile-client/src/index.ts` — empty export placeholder:

```ts
export {}
```

**Step 2: Install workspace deps**

```bash
cd /home/maestro/Documents/projects/NimConnect && npm install
```

Expected: workspace links `@nimconnect/profile-client`.

**Step 3: Commit**

```bash
git add package.json package-lock.json packages/profile-client
git commit -m "$(cat <<'EOF'
chore: scaffold @nimconnect/profile-client package

EOF
)"
```

---

### Task 3: Client types + `getProfileByAddress` (TDD)

**Files:**
- Create: `packages/profile-client/src/types.ts`
- Create: `packages/profile-client/src/client.ts`
- Create: `packages/profile-client/src/index.ts` (replace placeholder)
- Test: `packages/profile-client/src/client.test.ts`

**Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createProfileClient } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getProfileByAddress', () => {
  it('returns parsed profile on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        address: 'NQ01 TEST',
        updated_at: 1,
        profile: { display_name: 'Ada', bio: 'hi' },
      }),
    }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    const result = await client.getProfileByAddress('NQ01 TEST')
    expect(result).toEqual({
      address: 'NQ01 TEST',
      updatedAt: 1,
      profile: { display_name: 'Ada', bio: 'hi' },
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://nc.example/api/profile/NQ01TEST',
      expect.any(Object),
    )
  })

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const client = createProfileClient({ baseUrl: 'https://nc.example' })
    expect(await client.getProfileByAddress('NQ01 MISSING')).toBeNull()
  })
})
```

Note: compact address helper should strip spaces (match NimConnect `compactAddress` behavior).

**Step 2: Run test — expect FAIL**

```bash
npm run test -w @nimconnect/profile-client
```

**Step 3: Implement minimal client**

`types.ts` — `PublicProfileFields`, `StoredPublicProfile`, `HandleClaim`, `DisplayIdentity`, `ProfileClientOptions`.

`client.ts` — `createProfileClient({ baseUrl })` with:

- `compactAddress(address)`
- `getProfileByAddress(address)`
- (stubs for other methods can throw `not implemented` until next tasks, or implement empty)

Export from `index.ts`.

**Step 4: Run tests — expect PASS**

**Step 5: Commit**

```bash
git add packages/profile-client
git commit -m "$(cat <<'EOF'
feat(profile-client): add getProfileByAddress

EOF
)"
```

---

### Task 4: Handle resolve + by-address + `getDisplayIdentity` (TDD)

**Files:**
- Modify: `packages/profile-client/src/client.ts`
- Modify: `packages/profile-client/src/client.test.ts`

**Step 1: Add failing tests** for:

- `resolveHandle('ada')` → claim / null
- `getHandleByAddress(address)` → claim / null
- `getDisplayIdentity(address)`:
  - merges handle + profile
  - `displayName` from `profile.display_name`
  - returns `{ address, handle: undefined, displayName: undefined, ... }` when both 404
  - does not throw on network of one side missing (404 = absent)

**Step 2: Run — FAIL**

**Step 3: Implement**

Parallelize the two GETs inside `getDisplayIdentity` with `Promise.all`.

**Step 4: Run — PASS**

**Step 5: Commit**

```bash
git add packages/profile-client
git commit -m "$(cat <<'EOF'
feat(profile-client): resolve handles and display identity

EOF
)"
```

---

### Task 5: Build package + default base URL

**Files:**
- Modify: `packages/profile-client/src/client.ts`
- Modify: `packages/profile-client/package.json` (ensure `build` works)

**Step 1: Default `baseUrl` to production NimConnect origin**

Use `https://nimconnect.nimiqminiapps.com` (same as `PUBLIC_APP_ORIGIN` default in `backend/main.go`) when options omit `baseUrl`.

**Step 2: Build**

```bash
npm run build -w @nimconnect/profile-client
```

Expected: `packages/profile-client/dist/` with `.js` + `.d.ts`.

**Step 3: Commit** (include dist only if you choose to publish from git; prefer build-on-install / CI build — do **not** commit `dist/` if root `.gitignore` already ignores it; add `packages/profile-client/dist` to gitignore if needed)

```bash
git add packages/profile-client
git commit -m "$(cat <<'EOF'
feat(profile-client): default baseUrl and build output

EOF
)"
```

---

### Task 6: Optionally refactor NimConnect app to use the package (light touch)

**Files:**
- Modify: `package.json` — dependency `"@nimconnect/profile-client": "*"`
- Modify: `src/services/handles.ts` — only if a clean re-export is trivial; **YAGNI**: skip full refactor in v1 if it risks large churn. Prefer leaving NimConnect app on its existing helpers for now.

**Step 1: Prefer skip** unless `resolveHandle` / `handleForAddress` can re-export from the package in <15 lines without breaking tests.

**Step 2: If skipped, commit nothing for this task** (mark done in plan notes).

---

### Task 7: Add client to NimBomber frontend

**Repo:** `/home/maestro/Documents/projects/NimBomber`

**Files:**
- Modify: `apps/frontend/package.json`
- Create: `apps/frontend/src/services/ecosystemProfile.ts`
- Create: `apps/frontend/src/services/ecosystemProfile.test.ts` (optional thin wrapper tests)

**Step 1: Depend on the package**

While unpublished, use a file dependency:

```json
"@nimconnect/profile-client": "file:../../../NimConnect/packages/profile-client"
```

Adjust relative path from `apps/frontend` to the sibling NimConnect checkout. Document in a short comment in `ecosystemProfile.ts` that production should use a published version.

```bash
cd apps/frontend && npm install
```

**Step 2: Wrapper service**

```ts
import { createProfileClient, type DisplayIdentity } from '@nimconnect/profile-client'

const client = createProfileClient({
  baseUrl: import.meta.env.VITE_NIMCONNECT_API_URL || 'https://nimconnect.nimiqminiapps.com',
})

export async function fetchDisplayIdentity(address: string): Promise<DisplayIdentity> {
  return client.getDisplayIdentity(address)
}

export function pickDisplayName(
  identity: DisplayIdentity | null | undefined,
  localNickname?: string,
  address?: string,
): string {
  if (identity?.displayName) return identity.displayName
  if (identity?.handle) return `@${identity.handle}`
  if (localNickname) return localNickname
  return address ? address.replace(/\s+/g, '').slice(0, 8) : 'Unknown'
}
```

**Step 3: Commit (NimBomber)**

```bash
git add apps/frontend/package.json apps/frontend/package-lock.json apps/frontend/src/services/ecosystemProfile.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add NimConnect ecosystem profile client wrapper

EOF
)"
```

---

### Task 8: Enrich ProfileView with ecosystem identity + edit link

**Files:**
- Modify: `apps/frontend/src/views/ProfileView.vue`
- Modify: `apps/frontend/src/stores/player.ts` (only if needed for cached display fields)

**Step 1: On profile load**, after `api.getProfile()`:

- `fetchDisplayIdentity(auth.address)`
- Show `@handle` / ecosystem display name above or beside local nickname
- Keep stats/rewards from Bomber API unchanged
- Add link: “Edit ecosystem profile” → `https://nimconnect.nimiqminiapps.com/#/u/{handle}` when handle exists, else NimConnect app root / profile edit entry

**Step 2: Manual check** — Profile still shows Bomber stats when NimConnect returns 404.

**Step 3: Commit**

```bash
git add apps/frontend/src/views/ProfileView.vue
git commit -m "$(cat <<'EOF'
feat(frontend): show ecosystem identity on profile page

EOF
)"
```

---

### Task 9: Enrich Lobby player names (client-side)

**Files:**
- Modify: `apps/frontend/src/views/LobbyView.vue`

**Step 1: When lobby `players` updates**, for each non-bot player fetch `getDisplayIdentity` (small fan-out; max ~4). Cache in a `Map<address, DisplayIdentity>` on the view/composable.

**Step 2: Render** `pickDisplayName(identity, player.nickname, player.id)` instead of raw `player.nickname` alone.

**Step 3: Bots unchanged** (keep bot nickname from server).

**Step 4: Commit**

```bash
git add apps/frontend/src/views/LobbyView.vue
git commit -m "$(cat <<'EOF'
feat(frontend): resolve lobby names from NimConnect profiles

EOF
)"
```

---

### Task 10: Enrich Leaderboard names (client-side)

**Files:**
- Modify: `apps/frontend/src/views/LeaderboardView.vue`

**Step 1: After loading leaderboard entries**, resolve identities for unique addresses (cap concurrency if list is long; simple sequential/pool of 4 is fine for v1).

**Step 2: Display** ecosystem name with fallback to `entry.nickname` / address slice. **Ranks and win counts stay from Bomber API.**

**Step 3: Commit**

```bash
git add apps/frontend/src/views/LeaderboardView.vue
git commit -m "$(cat <<'EOF'
feat(frontend): decorate leaderboard with ecosystem display names

EOF
)"
```

---

### Task 11: Verification

**NimConnect:**

```bash
cd /home/maestro/Documents/projects/NimConnect
npm run test -w @nimconnect/profile-client
npm run build -w @nimconnect/profile-client
```

**NimBomber:**

```bash
cd /home/maestro/Documents/projects/NimBomber/apps/frontend
npm test
npm run typecheck
```

Manual:

1. User with published NimConnect profile → Bomber Profile/Lobby shows their display name / @handle
2. User without profile → fallback to nickname / address prefix; stats still load
3. Stats never appear in NimConnect; editing identity is via NimConnect link only

---

## Out of scope (do not implement in this plan)

- Batch profile API
- Moving Bomber stats into NimConnect
- Extracting contacts/backup/inbox
- Real Ed25519 verify in Bomber auth
- Publishing `@nimconnect/profile-client` to npm (local `file:` is enough until you create the org)
