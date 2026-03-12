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
│       │   ├── schema.ts    # Database schema (task, settings, projects, deployments, build_logs, env_vars, domains, webhook_deliveries, git_connections, preview_deployments)
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
│       ├── github/
│       │   ├── index.ts     # GitHubClient class (repos, statuses, comments, webhooks) + OAuth helpers
│       │   └── types.ts     # GitHubRepo, GitHubUser, CommitStatusParams, etc.
│       ├── gitlab/
│       │   ├── index.ts     # GitLabClient class (projects, statuses, MR notes, webhooks) + OAuth helpers
│       │   └── types.ts     # GitLabProject, GitLabUser, CommitStatusParams, etc.
│       ├── forgejo/
│       │   ├── index.ts     # ForgejoClient class (repos, statuses, comments, webhooks) + token verification
│       │   └── types.ts     # ForgejoRepo, ForgejoUser, CommitStatusParams, etc.
│       ├── preview/
│       │   ├── index.ts     # Preview manager (create/cleanup/enforce limit, port allocation 4001-4999)
│       │   └── types.ts     # PreviewProject, PreviewResult types
│       ├── dns.ts            # DNS record generation, verification, server IP detection
│       └── webhook.ts       # HMAC signature verification, webhook payload parsing (push, PR open/update/close/merge)
├── routes/
│   ├── +layout.svelte       # Root layout with nav
│   ├── +page.server.ts     # Dashboard load (system health, projects with deployments/domains)
│   ├── +page.svelte         # Dashboard screen (health bar, project table, empty state)
│   ├── api/
│   │   ├── webhooks/
│   │   │   └── [projectId]/
│   │   │       └── +server.ts       # POST webhook receiver (HMAC, branch filter, deploy trigger)
│   │   ├── git/
│   │   │   ├── github/
│   │   │   │   ├── +server.ts       # GitHub OAuth connect/callback/disconnect, list connections
│   │   │   │   ├── repos/
│   │   │   │   │   └── +server.ts   # List/search GitHub repos for a connection
│   │   │   │   └── webhook/
│   │   │   │       └── +server.ts   # Auto-configure GitHub webhook for a project
│   │   │   ├── gitlab/
│   │   │   │   ├── +server.ts       # GitLab OAuth connect/callback/disconnect, list connections
│   │   │   │   ├── repos/
│   │   │   │   │   └── +server.ts   # List/search GitLab projects for a connection
│   │   │   │   └── webhook/
│   │   │   │       └── +server.ts   # Auto-configure GitLab webhook for a project
│   │   │   └── forgejo/
│   │   │       ├── +server.ts       # Forgejo/Gitea token connect/disconnect, list connections
│   │   │       ├── repos/
│   │   │       │   └── +server.ts   # List/search Forgejo repos for a connection
│   │   │       └── webhook/
│   │   │           └── +server.ts   # Auto-configure Forgejo webhook for a project
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
│   ├── new/
│   │   ├── +page.server.ts  # New project load (frameworks, domain), create+deploy action
│   │   ├── +page.svelte     # Git source, framework select, config, env vars editor, deploy button
│   │   └── import/
│   │       ├── +page.server.ts  # Import load (connections, frameworks), import+deploy action
│   │       └── +page.svelte     # Account selector, repo search, repo list, config panel, deploy
│   ├── settings/
│   │   ├── +page.server.ts  # Settings load (user, hostname, timezone, apiToken), general/email/password/token actions
│   │   ├── +page.svelte     # General settings, admin email, change password, API token management
│   │   └── providers/
│   │       ├── +page.server.ts  # Provider connections load, forgejo connect + disconnect actions
│   │       └── +page.svelte     # Provider cards (GitHub/GitLab/Forgejo/Other), connected accounts list
│   ├── projects/
│   │   └── [slug]/
│   │       ├── +page.server.ts  # Project detail load (project, deployments, domains, env vars, webhook), delete action
│   │       ├── +page.svelte     # Header, deployments list, webhook bar, env block, domains, danger zone
│   │       ├── webhooks/
│   │       │   ├── +page.server.ts  # Webhook config load (project, domain), regenerate + update actions
│   │       │   ├── +page.svelte     # Payload URL, secret, provider tabs, branch filter, event toggles
│   │       │   └── deliveries/
│   │       │       ├── +page.server.ts  # Delivery list load (project, deliveries desc by time, limit 50)
│   │       │       ├── +page.svelte     # Delivery list table (event, status badge, action, time, clickable rows)
│   │       │       └── [did]/
│   │       │           ├── +page.server.ts  # Delivery detail load (parsed headers/payload), redeliver action
│   │       │           └── +page.svelte     # Metadata grid, headers block, JSON payload, redeliver button
│   │       ├── domains/
│   │       │   ├── +page.server.ts  # Domains load (project, domains, serverIp), add/verify/primary/remove actions
│   │       │   └── +page.svelte     # Domain list with SSL badges, add form, DNS record card, routing diagram
│   │       └── deployments/
│   │           └── [did]/
│   │               ├── +page.server.ts  # Build log load (project, deployment, logs, phases)
│   │               └── +page.svelte     # Phase indicator, terminal output, metadata bar, success/error actions
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
