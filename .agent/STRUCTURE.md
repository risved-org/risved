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
│       ├── settings.ts      # Key-value settings store (getSetting, setSetting, isOnboardingComplete)
│       ├── db/
│       │   ├── index.ts     # Drizzle database instance
│       │   ├── schema.ts    # Database schema (task, settings tables)
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
│       └── dns.ts            # DNS record generation, verification, server IP detection
├── routes/
│   ├── +layout.svelte       # Root layout with nav
│   ├── +page.svelte         # Landing page
│   ├── onboarding/
│   │   ├── +page.server.ts  # Admin account creation action (signUpEmail)
│   │   ├── +page.svelte     # Create admin form (email, password, confirm)
│   │   ├── StepIndicator.svelte # 4-step progress indicator component
│   │   ├── domain/
│   │   │   ├── +page.server.ts  # Domain config action (subdomain/dedicated/ip)
│   │   │   └── +page.svelte     # Radio cards, prefix picker, live URL preview
│   │   └── verify/
│   │       ├── +page.server.ts  # DNS verification load/actions (check, skip)
│   │       └── +page.svelte     # DNS records table, copy buttons, provider chips, SSL status
│   └── demo/                # Demo routes
│       ├── better-auth/     # Auth demo
│       └── paraglide/       # i18n demo
├── app.html                 # HTML template
├── app.d.ts                 # Type definitions
├── hooks.server.ts          # Server hooks (auth + i18n + first-run + route protection)
└── hooks.ts                 # Client hooks (i18n reroute)
```
