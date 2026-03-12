# Project Build Log

`Current Status`
=================
**Last Updated:** 2026-03-12
**Tasks Completed:** 19
**Current Task:** TASK-25 Complete

----------------------------------------------

## Session Log

### 2026-03-12 — TASK-25: Settings Screen
- Created `src/routes/settings/+page.server.ts` — load returns user info, hostname, timezone, masked API token from settings table; five actions: general (save hostname/timezone), email (update admin email with validation), password (change via BetterAuth changePassword API with 12-char min), generateToken (create rsv_ prefixed 64-char hex token), revokeToken (clear token)
- Created `src/routes/settings/+page.svelte` — settings page with four sections: General (hostname input, timezone dropdown), Admin Email (email input with update), Change Password (current/new/confirm password fields), API Token (generate/regenerate/revoke with one-time token display, copy button, masked view)
- 15 unit tests (3 load, 6 action, 6 source assertions), 6 e2e tests (general section, email/password sections, token section, generate token, save general, no console errors)
- 432 unit tests passing, 78 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-25-1.png` (full settings page), `.agent/screenshots/TASK-25-2.png` (generated API token)

### 2026-03-12 — TASK-24: Domains Screen
- Created `src/routes/projects/[slug]/domains/+page.server.ts` — load fetches project by slug, domains list, and server IP; four actions: add (hostname validation, uniqueness check, Caddy route), verify (DNS A record check, SSL status update), primary (toggle primary domain), remove (delete domain + Caddy route cleanup)
- Created `src/routes/projects/[slug]/domains/+page.svelte` — domain management page with active domains table (hostname, primary badge, SSL status badges with color coding: active/provisioning/pending/error, set-primary/check-DNS/remove buttons), add domain form (hostname input, DNS record card with A record type/name/value and copy button, routing diagram showing Browser → DNS → Caddy → App flow)
- Added "Manage" link to project detail page domains section
- Fixed unused `goto` import in project detail page
- 14 unit tests (3 load, 3 action, 8 source assertions), 6 e2e tests (domain list, add form with DNS instructions, nav from project detail, check DNS/remove buttons, set primary button, no console errors)
- 417 unit tests passing, 72 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-24-1.png` (domain list), `.agent/screenshots/TASK-24-2.png` (add domain form with DNS + routing diagram)

### 2026-03-12 — TASK-17: Webhook Delivery Log
- Created `src/routes/projects/[slug]/webhooks/deliveries/+page.server.ts` — load fetches project by slug, queries webhook_deliveries ordered by createdAt desc with limit 50, returns mapped deliveries
- Created `src/routes/projects/[slug]/webhooks/deliveries/+page.svelte` — delivery list table with event column, status badges (deployed/rejected/skipped/received), action text, relative time, clickable rows linking to detail page, back link to webhook config
- Created `src/routes/projects/[slug]/webhooks/deliveries/[did]/+page.server.ts` — load fetches delivery by id with JSON-parsed headers/payload; redeliver action re-verifies signature, logs new delivery, triggers pipeline if valid
- Created `src/routes/projects/[slug]/webhooks/deliveries/[did]/+page.svelte` — detail page with metadata grid (ID, event, timestamp, action, signature badge), request headers terminal block, JSON payload with syntax highlighting (keys blue, strings green, numbers accent), redeliver button with loading/success states
- Added "View delivery log" link to webhook config page
- 19 unit tests (8 list + 11 detail), 6 e2e tests (list rows, detail metadata/headers/payload, redeliver button, nav config→deliveries, nav list→detail, no console errors)
- 403 unit tests passing, 66 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-17-1.png` (delivery list), `.agent/screenshots/TASK-17-2.png` (delivery detail)

### 2026-03-12 — TASK-16: Webhook Configuration UI
- Created `src/routes/projects/[slug]/webhooks/+page.server.ts` — load returns project webhook data (secret, branch, event toggles) and payload URL using risved domain setting; regenerate action generates new webhook secret; update action persists branch filter and event toggle changes
- Created `src/routes/projects/[slug]/webhooks/+page.svelte` — webhook config page with payload URL + copy button, webhook secret + copy/regenerate, tabbed provider setup guides (GitHub, GitLab, Forgejo, Gitea, Codeberg, Bitbucket with numbered steps), branch filter input, push/PR merged event toggles, save button
- 15 unit tests (3 load, 2 regenerate, 2 update, 8 source assertions), 6 e2e tests (payload URL, secret, provider tabs, branch/toggles, navigation, no console errors)
- 384 unit tests passing, 60 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-16-1.png` (full page), `.agent/screenshots/TASK-16-2.png` (settings section)

### 2026-03-12 — TASK-23: Project Detail Screen
- Created `src/routes/projects/[slug]/+page.server.ts` — load resolves project by slug, fetches deployments (reverse-chronological), domains, masked env vars, last webhook delivery; delete action removes all associated data and redirects
- Created `src/routes/projects/[slug]/+page.svelte` — single scrollable page: header (name, status dot, framework badge, domain link), deployments list (commit SHA, status, time ago, duration, links to build log), webhook status bar, env vars code-editor block (blue keys, green values, masked secrets), domains list (hostname, primary badge, SSL status), danger zone (delete with confirmation)
- 12 unit tests (3 load/action, 8 source assertions, 1 db call check), 7 e2e tests (header, deployments, webhook, env vars, domains, danger zone, no console errors)
- 369 unit tests passing, 54 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-23-1.png` (full detail page), `.agent/screenshots/TASK-23-2.png` (delete confirmation)

### 2026-03-12 — TASK-22: Build Log Screen
- Created `src/routes/projects/[slug]/deployments/[did]/+page.server.ts` — load resolves project by slug, fetches deployment + build logs + primary domain, returns phase list with ordered pipeline steps
- Created `src/routes/projects/[slug]/deployments/[did]/+page.svelte` — hero build log UI with horizontal phase indicator (completed/active/pending/failed states with glow dots and connectors), metadata bar (status badge, commit SHA, elapsed timer), full terminal output (JetBrains Mono, timestamps in dim grey, commands in blue, errors in red, auto-scroll with cursor blink), SSE streaming via EventSource for live deployments, error summary with retry button on failure, success actions (open live site, view project) on success
- 12 unit tests (4 load, 8 source assertions), 5 e2e tests (phase indicator, metadata, terminal content, success actions, no console errors)
- 357 unit tests passing, 47 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-22-1.png` (phase indicator + terminal), `.agent/screenshots/TASK-22-2.png` (success state)

### 2026-03-12 — TASK-21: New Project Screen
- Created `src/routes/new/+page.server.ts` — load returns framework list from detectors and risved domain setting; default action validates input, creates project with slug/port/webhook, saves env vars, triggers pipeline, redirects to dashboard
- Created `src/routes/new/+page.svelte` — single scrollable form with Git Source section (repo URL, branch, root dir), Framework section (detection result display + manual override dropdown), Configuration section (project name auto-derived from URL, domain preview), Environment Variables section (dark code-editor-style block with key/value/secret toggle, add/remove rows), and Deploy button
- 14 unit tests (2 load, 4 action, 8 source assertions), 5 e2e tests (form sections, back link, framework options, env var add/remove, no console errors)
- 345 unit tests passing, 42 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-21-1.png` (full form), `.agent/screenshots/TASK-21-2.png` (env vars state)

### 2026-03-12 — TASK-20: Dashboard Screen
- Created `src/routes/+page.server.ts` — load function with system health metrics (CPU, memory, disk, uptime, container count via os/execSync), projects with latest deployment status and primary domains
- Updated `src/routes/+page.svelte` — dashboard with health bar (horizontal mono strip), project table (dense grid rows with status dot, name, framework badge, domain link, commit SHA, time ago, redeploy/open actions), empty state with New Project CTA
- Fixed `tests/05-success.test.ts` — updated waitForURL to handle auth redirect now that `/` has a server load
- 14 unit tests (4 load, 2 health, 2 framework names, 7 source assertions), 4 e2e tests (health bar, empty state, project rows, no console errors)
- 331 unit tests passing, 37 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-20-1.png` (empty state), `.agent/screenshots/TASK-20-2.png` (project table)

## Session Log

### 2026-03-12 — TASK-19: Login Screen
- Created `src/routes/login/+page.server.ts` — load function redirects if authed, queries project/running counts for status footer; default action calls `auth.api.signInEmail` with error handling
- Created `src/routes/login/+page.svelte` — centered login card (380px max-width), RISVED wordmark (all caps, letter-spaced), email/password form with `use:enhance`, error display, "Forgot password?" with CLI command reference, fixed status footer with health dot and project count in JetBrains Mono
- 11 unit tests (2 load, 3 action, 6 source assertions), 6 e2e tests (form display, forgot password, status footer, auth redirect, invalid credentials error, no console errors)
- 317 unit tests passing, 33 e2e tests passing
- Screenshots: `.agent/screenshots/TASK-19-1.png` (login form), `.agent/screenshots/TASK-19-2.png` (error state)

### 2026-03-12 — TASK-9: Build Pipeline & Orchestration
- Added `projects`, `deployments`, and `build_logs` tables to `src/lib/server/db/schema.ts`
- Created `src/lib/server/pipeline/types.ts` — PipelinePhase, LogEntry, PipelineConfig, PipelineResult, CommandRunner interfaces
- Created `src/lib/server/pipeline/port.ts` — port allocator for 3001-3999 range using DB queries
- Created `src/lib/server/pipeline/docker.ts` — gitClone, getCommitSha, dockerBuild, dockerRun, dockerStop, waitForHealthy, createCommandRunner
- Created `src/lib/server/pipeline/log.ts` — createLogCollector (in-memory + stream), persistLogs (batch DB insert)
- Created `src/lib/server/pipeline/index.ts` — runPipeline() orchestrator with 8 phases: clone → detect → build → start → health → route → cutover → live. Zero-downtime container swap, health check rollback, Caddy route integration
- Updated `tests/global-setup.ts` — added cleanup for new tables
- 27 new unit tests (16 docker + 11 pipeline), 242 total unit tests passing
- 27 e2e tests passing (no regression)
- No screenshots (backend-only task)

### 2026-03-12 — TASK-6: Onboarding: Success Screen
- Created `src/routes/onboarding/success/+page.server.ts` — load function with first-run and deploy-config guards, parses domain config to build app URL, dashboard action sets `onboarding_complete` and redirects to `/`
- Created `src/routes/onboarding/success/+page.svelte` — success checkmark icon, "You're all set" heading, conditional app URL display with mono font, three "What's next" cards (deploy another, custom domain, webhooks), "Open dashboard" CTA with `use:enhance`
- Updated `src/routes/onboarding/deploy/+page.server.ts` — starter and repo actions now redirect to `/onboarding/success` instead of setting `onboarding_complete` and redirecting to `/`; skip action unchanged
- Fixed domain config field name (`baseDomain` not `domain`) in URL generation
- Updated `playwright.config.ts` — health check URL uses `/@vite/client` to avoid auth redirect loop
- 12 new unit tests, 215 total unit tests passing
- 4 new e2e tests, 27 total e2e tests passing
- Screenshot: `.agent/screenshots/TASK-6-1.png`

### 2026-03-12 — TASK-5: Onboarding: First Deploy
- Created `src/routes/onboarding/deploy/templates.ts` — StarterTemplate type and 4 starter templates (Fresh, Hono, SvelteKit, Astro) with estimated deploy times
- Created `src/routes/onboarding/deploy/+page.server.ts` — load function with guard redirects (first-run → onboarding, no dns → verify), three actions: starter (validate template, save config), repo (validate git URL, save config), skip (mark onboarding complete)
- Created `src/routes/onboarding/deploy/+page.svelte` — two-tab UI (Starter template with 2x2 grid / Own repository with URL+branch fields), skip button, StepIndicator at step 4
- 20 new unit tests, 203 total unit tests passing
- 6 new e2e tests, 23 total e2e tests passing
- Screenshots: `.agent/screenshots/TASK-5-1.png`, `.agent/screenshots/TASK-5-2.png`

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
