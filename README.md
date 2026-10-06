# Risved

Risved is an open-source deployment tool for running web apps on your own server. Designed for developers who care about craft, control, and where their data lives. Built in Copenhagen.

## Installing

Run the install script on an Ubuntu/Debian server (requires root):

```sh
curl -fsSL https://risved.org/install | bash
```

This installs Docker, Deno, and Risved, then starts the control plane. Once complete, open the printed URL in your browser to create your admin account, configure your domain, and deploy your first app.

You can customise the install with environment variables:

```sh
RISVED_PORT=8080 curl -fsSL https://risved.org/install | bash
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

## Project files

Use a project's **Files** tab to upload files outside Git into its persistent `/app/data` volume. Uploads work even while the app is stopped. Select one or more files and enter a destination folder such as `private/bank` or `fonts`, or leave it blank for `/app/data`. Original filenames are kept and missing folders are created automatically. Files are uploaded individually with a 10 MiB limit each, so a selection can exceed 10 MiB in total. Each file shows its result, and failed uploads can be retried without sending successful files again. Existing files require an explicit **Replace**, and deletion requires confirmation.

Files survive deployments and rollbacks, but deleting the project removes its volume. They are available to release commands and the running app, not during image builds, and are not copied into preview deployments. Risved does not publish or download their contents. Configure the application to read the full filesystem path, or deliberately serve selected assets using its framework's routing. A browser font remains downloadable if the app serves it.

Storage operations use a short-lived `node:22-slim` helper container with only the project's volume mounted and networking disabled. Docker must be able to pull this official image on first use. New files use mode `0644` and directories `0755` so non-root app containers can read them; replacements preserve the existing owner and permission bits. Contents are stored as ordinary files in the project volume, so protect the host and volume backups as you would other application secrets.

The production image sets `BODY_SIZE_LIMIT=12M` to accommodate multipart uploads. If running the Node adapter directly, set the same limit (and allow it through any external proxy). Application-level validation still limits each file to 10 MiB.

To run the Docker storage integration tests against disposable volumes:

```sh
RUN_DOCKER_FILE_TESTS=1 bun run test:unit --run --project server src/lib/server/project-files/docker-files.test.ts
```

## Managed Postgres

Projects can opt into an adjacent Postgres container from the project settings page. Apps that do not opt in, including apps using SQLite with the default `/app/data` volume, are unchanged.

When enabled, Risved creates one Postgres container and volume owned by the immutable project ID, labels the container with that project ID, and injects database credentials only into that project's build, release, and runtime environment. The app receives `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_*`, and `PG*` variables pointing at the adjacent container on the private `risved` Docker network.

Shared databases are a separate resource model: a future version should let you create a database resource first, then attach one or more apps to it. That relationship should be stored explicitly, not inferred from app or database names.

## Developing

For local development, you'll need [Node.js 22+](https://nodejs.org/) (or [Bun](https://bun.sh/)) and [Docker](https://www.docker.com/).

```sh
git clone https://github.com/risved-org/risved.git
cd risved
bun install
```

Copy the example environment file and fill in the values:

```sh
cp .env.example .env
```

```sh
# .env
DATABASE_URL=file:risved.db
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
