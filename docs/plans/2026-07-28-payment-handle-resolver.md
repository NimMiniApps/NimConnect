# Payment Handle Resolver Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a payment-grade public handle resolver that refreshes the shared on-chain registry before returning the current owner.

**Architecture:** Reuse `HandleSyncer.Sweep` and `HandleRegistry.Resolve` behind a dedicated no-cache GET endpoint. Keep the existing cacheable identity resolver unchanged for normal profile reads, and expose the payment route through `@nimconnect/profile-client`.

**Tech Stack:** Go, `net/http`, TypeScript, Vitest, existing Nimiq RPC and handle registry.

---

### Task 1: Add the payment resolver handler

**Files:**
- Modify: `backend/handles_handlers.go`
- Modify: `backend/handles_handlers_test.go`

**Steps:**
1. Write handler tests for an on-demand sweep, a missing handle, and an upstream RPC failure.
2. Run `go test ./...` and confirm the new tests fail because the handler does not exist.
3. Implement a GET handler that validates the handle, sweeps the registry, returns `503` on refresh failure, resolves the claim, and sends `Cache-Control: no-store`.
4. Run `go test ./...` and confirm all tests pass.

### Task 2: Publish the route and public CORS contract

**Files:**
- Modify: `backend/main.go`
- Modify: `backend/cors.go`
- Modify: `backend/cors_test.go`
- Modify: `backend/README.md`

**Steps:**
1. Add failing coverage showing `/api/pay/resolve/` is a public GET path.
2. Register `GET /api/pay/resolve/{handle}` with the live syncer and registry.
3. Document the payment resolver and its freshness/error semantics.
4. Run `go test ./...`.

### Task 3: Expose payment resolution in the profile client

**Files:**
- Modify: `packages/profile-client/src/client.ts`
- Modify: `packages/profile-client/src/client.test.ts`
- Modify: `packages/profile-client/README.md`
- Modify: `docs/api/public-profile-read.md`
- Modify: `packages/profile-client/package.json`
- Modify: `package-lock.json`
- Rebuild: `packages/profile-client/dist`

**Steps:**
1. Add failing client tests for success, unknown handle, and unavailable fresh resolution.
2. Add `resolveHandleForPayment(handle)` using the no-cache payment route.
3. Document the review-and-revalidate payment flow.
4. Bump the package to `0.4.0` and rebuild `dist`.
5. Do not publish the package without separate approval.

### Task 4: Verify and prepare review

**Steps:**
1. Run `gofmt` on modified Go files.
2. Run `go test ./...`.
3. Run the repository `npm test` suite.
4. Review the diff and commit the feature.
