# Risved

Risved is an open-source deployment tool for running web apps on your own server. Designed for developers who care about craft, control, and where their data lives. Built in Copenhagen.

## Installing

Run the install script on an Ubuntu/Debian server (requires root):

```sh
curl -fsSL https://risved.org/install | sh
```

This installs Docker, Deno, and Risved, then starts the control plane. Once complete, open the printed URL in your browser to create your admin account, configure your domain, and deploy your first app.

You can customise the install with environment variables:

```sh
RISVED_PORT=8080 curl -fsSL https://risved.org/install | sh
```

### Requirements

- Ubuntu or Debian
- 2 GB RAM minimum (4 GB recommended)
- 10 GB free disk space
- Ports 80 and 443 available

## CLI

Risved ships with a CLI for common management tasks:

```sh
# trigger a deployment
risved deploy [project]

# stream build logs
risved logs [project]

# show server and project status
risved status

# manage environment variables
risved env [project]
risved env [project] set KEY=VALUE
risved env [project] rm KEY

# reset admin password
risved reset-password
```

## Supported Frameworks

Risved auto-detects the framework used in your project and generates the appropriate Docker configuration.

| Framework | Strategy |
| --- | --- |
| SvelteKit | Hybrid |
| Astro | Hybrid |
| Fresh | Deno |
| Hono | Deno |
| Lume | Deno |
| Next.js | Node |
| Nuxt | Node |
| SolidStart | Node |
| TanStack Start | Node |
| Generic (Node/Deno) | Auto |

## Developing

For local development, you'll need [Node.js 22+](https://nodejs.org/) (or [Bun](https://bun.sh/)) and [Docker](https://www.docker.com/).

```sh
git clone https://github.com/ralf/risved.git
cd risved
bun install
```

Copy the example environment file and fill in the values:

```sh
cp .env.example .env
```

```sh
# .env
DATABASE_URL=file:local.db
ORIGIN="http://localhost:5173"
BETTER_AUTH_SECRET="your-secret-here"

# Optional — GitHub OAuth for login
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
```

Then push the database schema and start the dev server:

```sh
bun run db:push
bun run dev
```

## Building

To create a production version of Risved:

```sh
bun run build
```

You can preview the production build with `bun run preview`.

## Testing

```sh
# unit tests
bun run test:unit

# end-to-end tests (requires Playwright browsers)
bun run test:e2e

# all tests
bun run test
```
