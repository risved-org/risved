# Project Directory Structure

```
scripts/
├── install.sh              # curl | sh installer (Docker, Deno, Caddy, Risved)
src/
├── lib/
│   ├── auth-client.ts      # BetterAuth SvelteKit client
│   ├── paraglide/          # i18n runtime (auto-generated)
│   │   └── messages/       # Locale message files
│   └── server/
│       ├── auth.ts          # BetterAuth configuration (email+password, 12-char min)
│       ├── auth-utils.ts    # First-run detection, user count helpers
│       ├── api-utils.ts     # Auth guard, slugify, webhook secret, JSON error helpers
│       ├── settings.ts      # Key-value settings store (getSetting, setSetting, isOnboardingComplete)
│       ├── db/
│       │   ├── index.ts     # Drizzle database instance
│       │   ├── schema.ts    # Database schema (task, settings, projects, deployments, build_logs, env_vars, domains, webhook_deliveries)
│       │   └── auth.schema.ts # BetterAuth auto-generated schema
│       ├── detection/
│       │   ├── index.ts     # detectFramework() + createFsContext()
│       │   ├── types.ts     # Types: FrameworkId, Tier, Confidence, etc.
│       │   └── detectors.ts # Individual framework detectors
│       ├── dockerfile/
│       │   ├── index.ts     # generateDockerfile() entry point
│       │   ├── types.ts     # DockerfileOptions, DockerfileResult, FrameworkBuildConfig
│       │   ├── configs.ts   # Per-framework build configurations
│       │   └── templates.ts # Tier-specific Dockerfile template generators
│       ├── caddy/
│       │   ├── index.ts     # CaddyClient class + route helpers
│       │   └── types.ts     # CaddyRoute, CaddyResult, CaddyHealthStatus, etc.
│       ├── pipeline/
│       │   ├── index.ts     # runPipeline() orchestrator (8 phases)
│       │   ├── types.ts     # PipelinePhase, LogEntry, PipelineConfig, CommandRunner
│       │   ├── docker.ts    # Git clone, Docker build/run/stop, health check
│       │   ├── log.ts       # Log collector + DB persistence
│       │   └── port.ts      # Port allocator (3001-3999)
│       ├── dns.ts            # DNS record generation, verification, server IP detection
│       └── webhook.ts       # HMAC signature verification, webhook payload parsing
├── routes/
│   ├── +layout.svelte       # Root layout with nav
│   ├── +page.server.ts     # Dashboard load (system health, projects with deployments/domains)
│   ├── +page.svelte         # Dashboard screen (health bar, project table, empty state)
│   ├── api/
│   │   ├── webhooks/
│   │   │   └── [projectId]/
│   │   │       └── +server.ts       # POST webhook receiver (HMAC, branch filter, deploy trigger)
│   │   └── projects/
│   │       ├── +server.ts           # GET (list), POST (create) projects
│   │       └── [id]/
│   │           ├── +server.ts       # GET (detail), PUT (update), DELETE project
│   │           ├── env/
│   │           │   ├── +server.ts       # GET (list masked), POST (create) env vars
│   │           │   └── [eid]/
│   │           │       └── +server.ts   # PUT (update), DELETE env var
│   │           ├── domains/
│   │           │   ├── +server.ts       # GET (list), POST (add) domains
│   │           │   └── [did]/
│   │           │       ├── +server.ts   # DELETE domain
│   │           │       ├── verify/
│   │           │       │   └── +server.ts # POST DNS verification
│   │           │       └── primary/
│   │           │           └── +server.ts # POST set as primary
│   │           ├── deploy/
│   │           │   └── +server.ts   # POST trigger deployment
│   │           └── deployments/
│   │               ├── +server.ts   # GET list deployments
│   │               └── [did]/
│   │                   ├── +server.ts    # GET deployment detail with logs
│   │                   ├── logs/
│   │                   │   └── +server.ts # GET SSE stream of build logs
│   │                   ├── stop/
│   │                   │   └── +server.ts # POST stop deployment container
│   │                   └── rollback/
│   │                       └── +server.ts # POST rollback (501 stub, Phase 2)
│   ├── login/
│   │   ├── +page.server.ts  # Login load (redirect if authed, project counts), signIn action
│   │   └── +page.svelte     # Centered login form, RISVED wordmark, status footer
│   ├── onboarding/
│   │   ├── +page.server.ts  # Admin account creation action (signUpEmail)
│   │   ├── +page.svelte     # Create admin form (email, password, confirm)
│   │   ├── StepIndicator.svelte # 4-step progress indicator component
│   │   ├── domain/
│   │   │   ├── +page.server.ts  # Domain config action (subdomain/dedicated/ip)
│   │   │   └── +page.svelte     # Radio cards, prefix picker, live URL preview
│   │   ├── verify/
│   │   │   ├── +page.server.ts  # DNS verification load/actions (check, skip)
│   │   │   └── +page.svelte     # DNS records table, copy buttons, provider chips, SSL status
│   │   ├── deploy/
│   │   │   ├── +page.server.ts  # First deploy load/actions (starter, repo, skip)
│   │   │   ├── +page.svelte     # Template grid, own repo input, skip button
│   │   │   └── templates.ts     # StarterTemplate type and STARTER_TEMPLATES data
│   │   └── success/
│   │       ├── +page.server.ts  # Success load (deploy guard, URL builder), dashboard action
│   │       └── +page.svelte     # Success checkmark, app URL, what's next cards, dashboard CTA
│   └── demo/                # Demo routes
│       ├── better-auth/     # Auth demo
│       └── paraglide/       # i18n demo
├── app.html                 # HTML template
├── app.d.ts                 # Type definitions
├── hooks.server.ts          # Server hooks (auth + i18n + first-run + route protection)
└── hooks.ts                 # Client hooks (i18n reroute)
```
