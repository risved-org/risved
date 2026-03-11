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
│       ├── db/
│       │   ├── index.ts     # Drizzle database instance
│       │   ├── schema.ts    # Database schema
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
│       └── caddy/
│           ├── index.ts     # CaddyClient class + route helpers
│           └── types.ts     # CaddyRoute, CaddyResult, CaddyHealthStatus, etc.
├── routes/
│   ├── +layout.svelte       # Root layout with nav
│   ├── +page.svelte         # Landing page
│   └── demo/                # Demo routes
│       ├── better-auth/     # Auth demo
│       └── paraglide/       # i18n demo
├── app.html                 # HTML template
├── app.d.ts                 # Type definitions
├── hooks.server.ts          # Server hooks (auth + i18n + first-run + route protection)
└── hooks.ts                 # Client hooks (i18n reroute)
```
