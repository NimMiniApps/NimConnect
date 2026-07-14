# Public Profile Page Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public `/@chuck` pages anyone can open — identicon, name, bio, socials, Send-NIM QR, add-to-NimConnect — with OG meta tags for link previews (spec §4 of `docs/superpowers/specs/2026-07-14-public-profiles-and-pay-links-design.md`). Requires plans 2 (registry backend, executed) and 3 (claim/publish flow — provides `src/services/handles.ts`).

**Architecture:** Three layers: (1) the Go backend serves `GET /p/{handle}` — a tiny HTML shell with OG meta tags (crawlers read these) that immediately redirects humans to the SPA route `/#/u/<handle>`; (2) the SPA gets a `PublicProfilePage` at `/u/:handle` that fetches resolve + profile from the public API and renders for logged-out visitors (App.vue bypasses the install landing for `/u/` routes, same pattern as the public pay page); (3) nginx maps the pretty URL `/@chuck` to the backend shell.

**Tech Stack:** Go `html/template` (stdlib, auto-escaping), Vue 3 + vue-router, existing `Identicon`/`QrCode` components and `handles`/`links` services.

## Global Constraints

- Backend files in `backend/`, package `main`, no new dependencies. Handlers follow `handles_handlers.go` conventions.
- Frontend: no component tests (repo convention); service logic is already tested in plan 3. Components build-verified + manual.
- The OG shell must never echo unescaped user content — use `html/template` only (it contextually auto-escapes HTML and JS).
- `/@handle` pretty URLs only exist behind nginx (prod). In dev, test the shell directly at `localhost:8787/p/<handle>` and the SPA page at `localhost:5173/#/u/<handle>` (Vite reserves `/@…` for internals — do NOT add a Vite proxy for it).
- Run npm at repo root, Go in `backend/`.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: OG shell endpoint — `GET /p/{handle}`

**Files:**
- Create: `backend/public_page.go`
- Test: `backend/public_page_test.go`
- Modify: `backend/main.go` (route inside the `registryAddress != ""` block)

**Interfaces:**
- Consumes: `HandleRegistry.Resolve`, `ProfileStore.Get`, `isValidHandle` (existing).
- Produces: `publicPageHandler(registry *HandleRegistry, profiles *ProfileStore, appOrigin string) http.HandlerFunc` — 200 HTML with OG tags for known handles, 404 HTML (still redirecting to the app) for unknown ones. Env `PUBLIC_APP_ORIGIN` (default `https://nimconnect.nimiqminiapps.com`) controls the redirect target and `og:url`.

- [ ] **Step 1: Write the failing test**

Create `backend/public_page_test.go`:

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func publicPageMux(t *testing.T, registry *HandleRegistry, profiles *ProfileStore) *http.ServeMux {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /p/{handle}", publicPageHandler(registry, profiles, "https://nimconnect.example"))
	return mux
}

func TestPublicPageServesOGTags(t *testing.T) {
	// seededRegistry owns @chuck (see handles_handlers_test.go); no published
	// profile, so this asserts the fallback title/description path.
	registry := seededRegistry(t)
	profiles := NewProfileStore(t.TempDir())

	rec := httptest.NewRecorder()
	publicPageMux(t, registry, profiles).ServeHTTP(rec, httptest.NewRequest("GET", "/p/chuck", nil))
	if rec.Code != 200 {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{
		`og:title`, `@chuck`, `nimconnect.example/#/u/chuck`, `og:description`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q:\n%s", want, body)
		}
	}
}

func TestPublicPageUnknownHandleIs404ButRedirects(t *testing.T) {
	registry := seededRegistry(t)
	rec := httptest.NewRecorder()
	publicPageMux(t, registry, NewProfileStore(t.TempDir())).ServeHTTP(rec, httptest.NewRequest("GET", "/p/ghost", nil))
	if rec.Code != 404 {
		t.Fatalf("want 404, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "nimconnect.example") {
		t.Error("404 page should still link to the app")
	}
}

func TestPublicPageInvalidHandle(t *testing.T) {
	registry := seededRegistry(t)
	rec := httptest.NewRecorder()
	publicPageMux(t, registry, NewProfileStore(t.TempDir())).ServeHTTP(rec, httptest.NewRequest("GET", "/p/NOT_valid!", nil))
	if rec.Code != 400 {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestPublicPageEscapesProfileContent(t *testing.T) {
	// A handle whose owner we control end-to-end: seed registry claim from a
	// signer-derived address, publish a bio containing HTML, expect it escaped.
	profiles := NewProfileStore(t.TempDir())
	req, address := putReq(t, 1000, `{"display_name":"Evil","bio":"<script>alert(1)</script>"}`)
	if err := profiles.Put(req); err != nil {
		t.Fatal(err)
	}
	registry := newTestRegistry(t)
	registry.Rebuild([]rpcTx{claimTx("t1", address, "evil", 5, 0)})

	rec := httptest.NewRecorder()
	publicPageMux(t, registry, profiles).ServeHTTP(rec, httptest.NewRequest("GET", "/p/evil", nil))
	body := rec.Body.String()
	if strings.Contains(body, "<script>alert(1)</script>") {
		t.Fatal("profile content must be HTML-escaped")
	}
	if !strings.Contains(body, "Evil") {
		t.Error("display name should appear (escaped)")
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./... -run TestPublicPage -v`
Expected: compile FAILURE — `publicPageHandler` undefined.

- [ ] **Step 3: Implement**

Create `backend/public_page.go`:

```go
package main

import (
	"encoding/json"
	"html/template"
	"net/http"
)

// publicPageTemplate is the OG shell: crawlers read the meta tags, humans get
// redirected to the SPA. html/template contextually escapes all fields.
var publicPageTemplate = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
<meta property="og:type" content="profile">
<meta property="og:title" content="{{.Title}}">
<meta property="og:description" content="{{.Description}}">
<meta property="og:url" content="{{.URL}}">
<meta property="og:site_name" content="NimConnect">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0;url={{.Redirect}}">
</head>
<body>
<p><a href="{{.Redirect}}">Continue to {{.Title}} on NimConnect</a></p>
<script>location.replace({{.Redirect}});</script>
</body>
</html>`))

type publicPageData struct {
	Title       string
	Description string
	URL         string
	Redirect    string
}

func publicPageHandler(registry *HandleRegistry, profiles *ProfileStore, appOrigin string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := r.PathValue("handle")
		if !isValidHandle(handle) {
			writeJSONError(w, http.StatusBadRequest, "invalid handle")
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=300")

		claim, ok := registry.Resolve(handle)
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_ = publicPageTemplate.Execute(w, publicPageData{
				Title:       "NimConnect",
				Description: "This handle isn't claimed yet.",
				URL:         appOrigin,
				Redirect:    appOrigin,
			})
			return
		}

		data := publicPageData{
			Title:       "@" + handle + " — NimConnect",
			Description: "Send NIM to @" + handle + " on NimConnect.",
			URL:         appOrigin + "/@" + handle,
			Redirect:    appOrigin + "/#/u/" + handle,
		}
		if stored, err := profiles.Get(claim.Address); err == nil {
			var p struct {
				DisplayName string `json:"display_name"`
				Bio         string `json:"bio"`
			}
			if json.Unmarshal([]byte(stored.Profile), &p) == nil {
				if p.DisplayName != "" {
					data.Title = p.DisplayName + " (@" + handle + ") — NimConnect"
				}
				if p.Bio != "" {
					data.Description = p.Bio
				}
			}
		}
		_ = publicPageTemplate.Execute(w, data)
	}
}
```

In `backend/main.go`, inside the `registryAddress != ""` block, add:

```go
		publicOrigin := getEnv("PUBLIC_APP_ORIGIN", "https://nimconnect.nimiqminiapps.com")
		mux.HandleFunc("GET /p/{handle}", publicPageHandler(registry, profiles, publicOrigin))
```

- [ ] **Step 4: Verify**

Run: `go vet ./... && go test ./...`
Expected: PASS (4 new tests).

- [ ] **Step 5: Commit**

```bash
git add public_page.go public_page_test.go main.go
git commit -m "feat(backend): OG shell for public @handle pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PublicProfilePage in the SPA

**Files:**
- Create: `src/pages/PublicProfilePage.vue`
- Modify: `src/router.ts` (one route)
- Modify: `src/App.vue` (public-route bypass, next to the `publicPayRequest` branch)

**Interfaces:**
- Consumes: `resolveHandle`, `fetchPublicProfile`, types from `src/services/handles.ts` (plan 3); `makeRequestLink`, `makeNimiqPayDeepLink`, `makeAppAddLink`, `shortAddress`, `transactionExplorerUrl` from `links.ts`; `Identicon`, `QrCode`.
- Produces: route `/u/:handle` rendering for anyone — including visitors outside Nimiq Pay without browser-mode opt-in.

- [ ] **Step 1: Create the page**

Create `src/pages/PublicProfilePage.vue`:

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import Identicon from '../components/Identicon.vue'
import QrCode from '../components/QrCode.vue'
import {
  resolveHandle,
  fetchPublicProfile,
  type HandleClaim,
  type PublicProfile,
} from '../services/handles'
import {
  makeRequestLink,
  makeNimiqPayDeepLink,
  makeAppAddLink,
  shortAddress,
  transactionExplorerUrl,
} from '../services/links'

const route = useRoute()
const state = ref<'loading' | 'ready' | 'notfound' | 'error'>('loading')
const claim = ref<HandleClaim | null>(null)
const profile = ref<PublicProfile | null>(null)

const handle = computed(() => String(route.params.handle ?? '').toLowerCase())
const displayName = computed(() => profile.value?.display_name || `@${handle.value}`)
const payUri = computed(() => (claim.value ? makeRequestLink(claim.value.address) : ''))

// The backend rejects non-http(s) website URLs at publish time; this guard
// keeps javascript:/data: URIs out of href even if served data is ever stale.
const safeWebsite = computed(() => {
  try {
    const u = new URL(profile.value?.website ?? '')
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
})

onMounted(async () => {
  try {
    const resolved = await resolveHandle(handle.value)
    if (!resolved) {
      state.value = 'notfound'
      return
    }
    claim.value = resolved
    profile.value = (await fetchPublicProfile(resolved.address))?.profile ?? null
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
})
</script>

<template>
  <div class="public-profile">
    <p v-if="state === 'loading'" class="status">Loading @{{ handle }}…</p>
    <p v-else-if="state === 'notfound'" class="status">
      @{{ handle }} isn't claimed yet.
      <router-link to="/">Claim it in NimConnect →</router-link>
    </p>
    <p v-else-if="state === 'error'" class="status">Couldn't load this profile — try again in a moment.</p>

    <template v-else-if="claim">
      <header class="who">
        <Identicon :address="claim.address" :size="80" />
        <h1>{{ displayName }}</h1>
        <p class="handle">@{{ claim.handle }}</p>
        <p v-if="profile?.bio" class="bio">{{ profile.bio }}</p>
        <ul v-if="safeWebsite || profile?.github || profile?.x" class="socials">
          <li v-if="safeWebsite">
            <a :href="safeWebsite" target="_blank" rel="noopener noreferrer nofollow">🌐 Website</a>
          </li>
          <li v-if="profile?.github">
            <a :href="`https://github.com/${profile.github}`" target="_blank" rel="noopener noreferrer">GitHub</a>
          </li>
          <li v-if="profile?.x">
            <a :href="`https://x.com/${profile.x}`" target="_blank" rel="noopener noreferrer">X</a>
          </li>
        </ul>
        <ul v-if="profile?.tags?.length" class="tags">
          <li v-for="tag in profile.tags" :key="tag">{{ tag }}</li>
        </ul>
      </header>

      <section class="pay-card">
        <h2>Send NIM to {{ displayName }}</h2>
        <QrCode :text="payUri" :size="200" />
        <p class="scan-hint">Scan with any Nimiq wallet</p>
        <p class="address" :title="claim.address">{{ shortAddress(claim.address) }}</p>
        <a class="verified" :href="transactionExplorerUrl(claim.tx_hash)" target="_blank" rel="noopener">
          ✓ Handle verified on the Nimiq chain
        </a>
        <a :href="makeNimiqPayDeepLink(claim.address)" class="primary-btn">Send in Nimiq Pay</a>
        <a :href="makeAppAddLink(claim.address)" class="secondary-btn">Add to NimConnect</a>
      </section>

      <footer class="brand">
        <p><strong>NimConnect</strong> — a relationship manager for your wallet.</p>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.public-profile {
  max-width: 560px;
  margin: 0 auto;
  min-height: 100dvh;
  padding: 32px 20px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.status { padding: 40px 0; text-align: center; color: var(--text-2); }
.who { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; }
.who h1 { margin: 8px 0 0; font-size: 26px; line-height: 1.2; color: var(--text); }
.handle { margin: 0; font-size: 15px; font-weight: 800; color: var(--nq-gold-dark); }
.bio { margin: 6px 0 0; max-width: 380px; font-size: 15px; line-height: 1.5; color: var(--text-2); }
.socials { display: flex; gap: 14px; margin: 8px 0 0; padding: 0; list-style: none; }
.socials a { font-size: 14px; font-weight: 700; color: var(--nq-light-blue); text-decoration: none; }
.tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
.tags li {
  padding: 3px 10px; border-radius: var(--nimiq-radius-pill); font-size: 12px; font-weight: 700;
  background: var(--bg); border: 1px solid var(--border); color: var(--text-2);
}
.pay-card {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 20px 16px; border-radius: 16px;
  background: var(--card); border: 1px solid var(--border); box-shadow: var(--shadow);
}
.pay-card h2 { margin: 0; font-size: 17px; color: var(--text); }
.scan-hint { margin: 0; font-size: 13px; color: var(--text-2); }
.address { margin: 0; font-size: 13px; font-family: monospace; color: var(--text); }
.verified { font-size: 12px; font-weight: 700; color: var(--nq-green); text-decoration: none; }
.primary-btn {
  display: flex; align-items: center; justify-content: center; width: 100%;
  min-height: 50px; border-radius: var(--nimiq-radius-pill); text-decoration: none;
  font-size: 16px; font-weight: 800; color: var(--nimiq-white);
  background: var(--nimiq-gold-bg); box-shadow: var(--nimiq-shadow);
}
.secondary-btn {
  display: flex; align-items: center; justify-content: center; width: 100%;
  min-height: 44px; border-radius: var(--nimiq-radius-pill); text-decoration: none;
  font-size: 14px; font-weight: 700; color: var(--text);
  border: 1px solid var(--border); background: var(--card);
}
.brand { margin-top: auto; text-align: center; font-size: 13px; color: var(--text-2); }
.brand strong { color: var(--nq-gold-dark); }
</style>
```

- [ ] **Step 2: Register the route**

In `src/router.ts`, add before the catch-all redirect:

```ts
    { path: '/u/:handle', component: () => import('./pages/PublicProfilePage.vue') },
```

- [ ] **Step 3: Bypass the install landing for public profile routes**

In `src/App.vue` — read the current file first; a parallel session has been editing it. Locate the landing branch (the `PublicPayLanding` / `OpenInNimiqPayLanding` `v-if` chain added by the pay-page plan).

1. Add a computed next to `publicPayRequest`:

```ts
// Public profile pages render for everyone — no install wall.
const publicProfileRoute = computed(() => router.currentRoute.value.path.startsWith('/u/'))
```

2. Insert a branch ABOVE the `OpenInNimiqPayLanding` element:

```vue
  <router-view v-if="!insideNimiqPay && !browserMode && publicProfileRoute" />
```

(Ordering: `PublicPayLanding` branch, then this, then `OpenInNimiqPayLanding` as `v-else-if`, then the main `.app` div as `v-else` — same chain, one new link.)

- [ ] **Step 4: Build + tests + manual check**

Run: `npm run build && npm run test -- --run`
Expected: PASS.

Manual: start backend (with `REGISTRY_ADDRESS` + a claimed handle from plan 3's manual flow, or seed `/tmp/h.json` with `{"chuck":{"handle":"chuck","address":"NQ07 0000 0000 0000 0000 0000 0000 0000 0000","tx_hash":"t1","block_height":5,"tx_index":0}}`) and `npm run dev`, then open `http://localhost:5173/#/u/chuck` in a private window (no browser-mode opt-in): expect the public profile card, QR, and buttons — no install wall. `http://localhost:5173/#/u/ghost` → "isn't claimed yet". Check the OG shell: `curl -s localhost:8787/p/chuck | grep og:` → title/description/url tags.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PublicProfilePage.vue src/router.ts src/App.vue
git commit -m "feat: public @handle profile page at /u/:handle — no app required

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Pretty URLs — nginx `/@chuck` → backend shell

**Files:**
- Modify: `nginx.conf`
- Modify: `docker-compose.homelab.yml.example` (document `PUBLIC_APP_ORIGIN` + `REGISTRY_ADDRESS` env on the backend service — read the file first, a parallel session touched it)

**Interfaces:**
- Consumes: Task 1's `/p/{handle}` endpoint; the `backend` service name from the compose stack.
- Produces: `https://nimconnect.nimiqminiapps.com/@chuck` serving the OG shell.

- [ ] **Step 1: Add the nginx location**

In `nginx.conf`, add ABOVE the `location /` block:

```nginx
    # On-chain @handle public pages — OG shell served by the backend.
    location ~ "^/@(?<handle>[a-z0-9_]{3,26})$" {
        proxy_pass http://backend:8787/p/$handle;
        proxy_set_header Host $host;
    }
```

(`backend` is the service name on the stack network. If the frontend container starts before the backend exists, nginx fails to resolve at startup — both are in the same stack, deployed together, so this is acceptable; note it in the compose comment.)

- [ ] **Step 2: Document the env in the compose example**

In `docker-compose.homelab.yml.example`, under the backend service `environment:`, add (matching the file's comment style):

```yaml
      # On-chain @handle registry (optional — unset disables the feature)
      # - REGISTRY_ADDRESS=NQxx your registry address
      # - PUBLIC_APP_ORIGIN=https://nimconnect.nimiqminiapps.com
```

- [ ] **Step 3: Verify config syntax**

Run: `docker run --rm -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t` — expected: `syntax is ok` (the `host not found in upstream "backend"` error is expected outside the stack network; if it aborts the test, verification happens at deploy instead — note the result either way).

- [ ] **Step 4: Commit**

```bash
git add nginx.conf docker-compose.homelab.yml.example
git commit -m "feat: /@handle pretty URLs — nginx proxy to backend OG shell

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
