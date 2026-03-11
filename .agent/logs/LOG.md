# Project Build Log

`Current Status`
=================
**Last Updated:** 2026-03-11
**Tasks Completed:** 4
**Current Task:** TASK-1 Complete

----------------------------------------------

## Session Log

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
