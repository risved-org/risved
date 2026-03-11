# Project Build Log

`Current Status`
=================
**Last Updated:** 2026-03-11
**Tasks Completed:** 7
**Current Task:** TASK-3 Complete

----------------------------------------------

## Session Log

### 2026-03-11 — TASK-3: Onboarding: Domain Setup
- Created `settings` table in `src/lib/server/db/schema.ts` — key-value store for app configuration
- Created `src/lib/server/settings.ts` — getSetting, setSetting, isOnboardingComplete helpers
- Created `src/routes/onboarding/domain/+page.server.ts` — domain config form action with validation for subdomain/dedicated/ip modes
- Created `src/routes/onboarding/domain/+page.svelte` — three radio cards (subdomain recommended, dedicated, IP-only), prefix picker (risved/deploy/apps/custom), live URL preview showing dashboard and app URL patterns
- Updated `src/hooks.server.ts` — onboarding flow now uses `isOnboardingComplete()` instead of just `isFirstRun()` to allow multi-step onboarding after admin account creation
- Updated `playwright.config.ts` — sequential test execution with global DB reset setup
- Renamed e2e tests to `01-onboarding.test.ts` and `02-domain.test.ts` for ordered execution
- 23 new unit tests (6 settings + 17 domain), 153 total unit tests passing
- 6 new e2e tests, 11 total e2e tests passing
- Screenshots: `.agent/screenshots/TASK-3-1.png`, `.agent/screenshots/TASK-3-2.png`

## Session Log

### 2026-03-11 — TASK-2: Onboarding: Create Admin Account
- Created `src/routes/onboarding/+page.svelte` — admin account creation form with email, password (12-char min), and confirm password fields
- Created `src/routes/onboarding/+page.server.ts` — server action with validation, first-run guard, BetterAuth signUpEmail integration, redirects to `/onboarding/domain` on success
- Created `src/routes/onboarding/StepIndicator.svelte` — reusable 4-step progress indicator (Account → Domain → Verify → Deploy) with active/completed/upcoming states
- Client-side validation: password length counter, mismatch detection, disabled submit button
- Server-side validation: empty email, password < 12 chars, password mismatch, duplicate admin check
- Updated `playwright.config.ts` — added webServer config for reliable e2e test startup
- 15 unit tests + 5 e2e tests passing, 130 total unit tests passing
- Screenshot: `.agent/screenshots/TASK-2-1.png`

### 2026-03-11 — TASK-18: Authentication (BetterAuth)
- Updated `src/lib/server/auth.ts` — email+password with 12-char minimum, autoSignIn, removed GitHub OAuth (deferred to Phase 2)
- Created `src/lib/server/auth-utils.ts` — `isFirstRun()` and `getUserCount()` helpers using drizzle count query
- Updated `src/hooks.server.ts` — added `handleAuth` middleware:
  - First-run detection: redirects to `/onboarding` if no admin user exists
  - Route protection: unauthenticated users redirected to `/login`
  - Public paths: `/onboarding`, `/login`, `/api/auth` accessible without session
  - Blocks `/onboarding` access after admin is created
- Created `src/lib/auth-client.ts` — BetterAuth SvelteKit client for frontend use
- Removed unused GitHub OAuth env vars from `.env`
- 12 unit tests passing, 115 total project tests passing
- No screenshots (backend-only task)

### 2026-03-11 — TASK-1: Installation & Onboarding Script
- Created `scripts/install.sh` — the `curl | sh` entry point for new users
- Checks: root, OS (Ubuntu/Debian), RAM (2GB min/4GB rec), disk (10GB min), ports 80/443
- Installs Docker Engine from official repo (not snap), Deno via official installer
- Creates `risved` Docker network, starts Caddy container, starts Risved control plane
- Idempotent: safe to re-run, checks for existing installs/containers/networks
- Colored output with banner, info/ok/warn/err/fatal helpers
- RISVED_TESTING=1 guard allows sourcing functions for unit testing
- 36 unit tests passing, 103 total project tests passing
- No screenshots (backend-only task)

### 2026-03-11 — TASK-10: Caddy Route Management
- Created `src/lib/server/caddy/` module for managing Caddy reverse proxy via JSON admin API
- `CaddyClient` class with injectable fetch for testability
- Operations: addRoute, removeRoute, updateRoute, addWildcardRoute, removeWildcardRoute, listRoutes, health, ensureServer
- Routes use `@id` for individual addressing via Caddy's `/id/` endpoint
- 25 unit tests passing, 67 total project tests passing
- No screenshots (backend-only task)

### 2026-03-11 — TASK-8: Dockerfile Generation
- Created `src/lib/server/dockerfile/` module with tier-based Dockerfile generation
- Three template strategies: `deno` (Fresh, Hono, Lume), `hybrid` (SvelteKit, Astro), `node` (Next.js, Nuxt, SolidStart)
- Framework-specific build configs encoding output dirs, commands, and serve strategies
- Supports custom install/build commands and port overrides
- 21 unit tests passing, 42 total project tests passing
- Fixed pre-existing TS error in `src/hooks.ts`
- Removed broken `vitest.config.ts` (leftover React config)
- No screenshots (backend-only task)

### 2026-03-11 — TASK-7: Framework Detection
- Created `src/lib/server/detection/` module with tier-based detection system
- Supports 8 frameworks: SvelteKit, Fresh, Astro, Hono, Next.js, Nuxt, Lume, SolidStart
- Phase 1 focus: SvelteKit, Fresh, Astro, Hono (others included for Phase 2)
- Three tiers: `deno` (pure Deno), `hybrid` (Node build + Deno serve), `node` (Node build + Node serve)
- Three confidence levels: high, medium, low
- `DetectionContext` interface allows filesystem or in-memory scanning
- 20 unit tests passing
- No screenshots (backend-only task)
