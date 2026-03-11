# Project Directory Structure

```
src/
├── lib/
│   ├── paraglide/          # i18n runtime (auto-generated)
│   │   └── messages/       # Locale message files
│   └── server/
│       ├── auth.ts          # BetterAuth configuration
│       ├── db/
│       │   ├── index.ts     # Drizzle database instance
│       │   ├── schema.ts    # Database schema
│       │   └── auth.schema.ts # BetterAuth auto-generated schema
│       └── detection/
│           ├── index.ts     # detectFramework() + createFsContext()
│           ├── types.ts     # Types: FrameworkId, Tier, Confidence, etc.
│           └── detectors.ts # Individual framework detectors
├── routes/
│   ├── +layout.svelte       # Root layout with nav
│   ├── +page.svelte         # Landing page
│   └── demo/                # Demo routes
│       ├── better-auth/     # Auth demo
│       └── paraglide/       # i18n demo
├── app.html                 # HTML template
├── app.d.ts                 # Type definitions
├── hooks.server.ts          # Server hooks (auth + i18n)
└── hooks.ts                 # Client hooks (i18n reroute)
```
