# MCP server

Risved exposes an MCP (Model Context Protocol) server at `POST /mcp`, so a
coding agent can create projects, set environment variables, deploy, read build
output and roll back without leaving the terminal.

The transport is Streamable HTTP in stateless mode: every request carries its
own credential and nothing is kept between calls.

---

## Connecting

### Claude Code

```
claude mcp add --transport http risved https://<instance>/mcp
```

The first call returns `401` with a `WWW-Authenticate` header pointing at
`/.well-known/oauth-protected-resource`, which opens the browser login for your
instance. The client registers itself dynamically — there is nothing to
pre-configure on the Risved side.

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.risved]
url = "https://<instance>/mcp"
```

### Anything else, with an API key

Clients without remote OAuth support send a bearer key instead:

```
curl -sS https://<instance>/mcp \
  -H 'Authorization: Bearer rsv_…' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## API keys

Settings → **MCP access keys** → give the key a label → **Create key**.

The key is shown once. Only a SHA-256 digest is stored, so it cannot be read
back — if it is lost, revoke it and make another. Revoking takes effect on the
next request.

Keys act as the user who created them, with the same permissions that user has
in the dashboard.

---

## Tools

| Tool             | Input                                  | Returns                                                                             |
| ---------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| `list_projects`  | —                                      | Every project with repo, branch, framework, URL and latest deployment               |
| `get_project`    | `projectId`                            | Project detail, env var **names** (never values), current and last five deployments |
| `create_project` | `repo`, `branch?`, `name?`, `rootDir?` | The project, the detected framework and `buildHints`. Does not deploy               |
| `set_env`        | `projectId`, `vars`, `remove?`         | Variable names and `requiresRedeploy: true`. Does not deploy                        |
| `deploy`         | `projectId`, `ref?`                    | `deploymentId` and status, immediately — the build runs in the background           |
| `get_deployment` | `deploymentId`, `logLines?`            | Status, `terminal`, timings, URL, `buildHints` and the tail of the build log        |
| `rollback`       | `projectId`, `toDeploymentId`          | Redeploys that deployment's cached image without rebuilding                         |

`create_project` takes a GitHub repo as `owner/name`. Risved must already have a
GitHub connection that can see it — otherwise the tool errors with
`github_app_not_installed` and an `installUrl` to send the user to.

### Deployment statuses

`pending`, `running`, `live`, `failed`, `stopped` — the same values the
dashboard shows. Every deployment result carries `terminal: true` once the
status can no longer change, which is the signal to stop polling.

### Build hints

`create_project` and `get_deployment` both return `buildHints`:

```json
{
	"code": "missing_adapter_node",
	"severity": "error",
	"message": "SvelteKit needs @sveltejs/adapter-node — the container starts the build with `node build/index.js`.",
	"fix": "npm i -D @sveltejs/adapter-node",
	"file": "package.json",
	"docsUrl": "https://svelte.dev/docs/kit/adapter-node"
}
```

`code` is stable and safe to branch on. Fix every hint with
`severity: "error"` before deploying; warnings are worth reading but will not
stop a build.

### Errors

Tool errors come back with `isError: true` and a `code`:

`not_found`, `forbidden`, `validation`, `github_app_not_installed`,
`deploy_in_progress`, `internal`.

`deploy_in_progress` carries the running `deploymentId` — poll that one rather
than starting another build.

---

## Typical flow

1. `create_project` with `owner/name`.
2. Fix any `buildHints` with `severity: "error"` in the repo, and push.
3. `set_env` for anything the app needs at runtime.
4. `deploy`.
5. Poll `get_deployment` until `terminal` is true.
6. If it ended `failed`, read `buildHints` and `logTail`, fix, `deploy` again.
7. If a deploy broke production, `rollback` to the last deployment that reached
   `live`.

---

## Not in this version

- Source/tarball upload deploys — Git only.
- Streaming logs over MCP. `get_deployment` returns a tail (80 lines by
  default, 400 maximum); the dashboard streams the full log.
- Structured log queries.
- Server provisioning and billing.

Tools take no `server` argument: a self-hosted instance is one server.
