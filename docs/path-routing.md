# Share a domain between Risved apps

Domain mappings now identify a hostname **and a path prefix**. Existing mappings migrate to prefix `/` and forwarding mode `preserve`, keeping their previous upstream URLs. The database migration runs through Risved's existing `bun run db:migrate` deployment step; back up the database before upgrading. Do not use `db:push` as an upgrade substitute: the migration preserves existing domain IDs, primary flags, verification dates and SSL status while replacing hostname-only uniqueness.

In each project's **Settings → Domains → Add domain**, configure:

| App      | Hostname   | Path prefix | Forwarding mode                                          |
| -------- | ---------- | ----------- | -------------------------------------------------------- |
| Main app | `onui.com` | `/`         | Preserve prefix                                          |
| Blogomat | `onui.com` | `/blog`     | Preserve prefix, if Blogomat serves routes under `/blog` |

Choose **Strip prefix** for Blogomat if its HTTP router expects `/story` rather than `/blog/story`. In either mode, its **public base URL** must be `https://onui.com/blog`. Keep Blogomat's generated Risved hostname separate; do not set its legacy project `domain` to `onui.com`, because that field represents a root route. If the main app already owns `onui.com` through the legacy project domain, that is already the root fallback.

The authenticated domain API accepts the same fields:

```http
POST /api/projects/MAIN_PROJECT_ID/domains
Content-Type: application/json

{"hostname":"onui.com","pathPrefix":"/","forwardingMode":"preserve"}
```

```http
POST /api/projects/BLOG_PROJECT_ID/domains
Content-Type: application/json

{"hostname":"onui.com","pathPrefix":"/blog","forwardingMode":"strip"}
```

Omitting the two new fields selects `/` and `preserve`. GET returns them. To change a mapping using the existing domain management flow, remove that mapping and add it again with the desired settings; this temporarily removes that mount. Other prefixes remain configured. Redeployment and rollback keep each mapping's forwarding mode and prefix.

Prefixes must be literal, case-sensitive paths beginning with `/`, with no trailing slash (except `/`), empty segments, dot segments, percent encoding, query, fragment or wildcard. Duplicate hostname/prefix pairs return HTTP 409, even across projects. Multiple different prefixes on the same hostname are allowed. A legacy project root cannot be claimed by a different app.

## Routing behavior

The longest matching prefix wins. `/blog` matches `/blog` and `/blog/story`, but not `/blogger`. A more specific mapping such as `/blog/admin` takes priority over `/blog`. `/` handles remaining paths; without a root mapping, unmatched requests follow Caddy's existing unmatched-request behavior.

| Public request          | Preserve upstream URI   | Strip upstream URI |
| ----------------------- | ----------------------- | ------------------ |
| `/blog`                 | `/blog`                 | `/`                |
| `/blog/story?preview=1` | `/blog/story?preview=1` | `/story?preview=1` |
| `/blog/assets/site.css` | `/blog/assets/site.css` | `/assets/site.css` |

Caddy continues to proxy methods, request bodies, streaming responses and WebSocket upgrades. It preserves Host and supplies X-Forwarded-Host and X-Forwarded-Proto using its existing trust policy. Risved does not introduce another trusted proxy hop. Client-supplied forwarding metadata is not trusted by default. X-Forwarded-Prefix is explicitly overwritten with the configured prefix, including `/` for root mappings. An application must trust these headers only from its Risved proxy.

Routes are updated through the existing Caddy admin API. Updates replace only the selected mapping in a conditionally written route list, with retries on concurrent edits, and sort longer prefixes first. Removal targets the hostname/prefix identity. Automatic `www` redirects also match the prefix and preserve the full public URI; they cannot overwrite or remove an explicit app mapping. Host matchers remain present on every route, so Caddy's hostname-based automatic HTTPS and certificate storage remain shared. Removing one prefix does not remove another route or explicitly delete any certificate. Both apps use the same DNS A/AAAA records and hostname certificate; paths do not need DNS records or separate certificates.

## What Blogomat must support

Prefix stripping alone does **not** make a root-hosted application compatible with subpath hosting. Blogomat must generate links, redirects, static asset URLs, authentication callbacks and cookie paths for `https://onui.com/blog`. Configure its framework's base path / public URL support, callback registrations and session cookie path as needed. A redirect to `/login` or asset URL `/_app/...` still goes to the main app unless Blogomat changes it to the appropriate `/blog/...` URL. Review service workers, canonical URLs and WebSocket URLs too. Risved does not rewrite HTML or automatically change upstream response Location or Set-Cookie headers.

Blogomat's implementation is outside this repository. No Blogomat compatibility or production DNS/TLS behavior is claimed by these Risved changes.

## Verification before production

Use a staging hostname pointing to a test Risved instance, or an isolated local proxy with fixtures. Do not run these writes against live mappings as part of local validation. Once staging mappings above are configured (substitute the staging hostname for `onui.com`):

1. Homepage: `curl -i https://onui.com/` must return the main app. Also check `https://onui.com/blogger` uses the main app's fallback.
2. Blog homepage and nested story: open `https://onui.com/blog` and `https://onui.com/blog/story?preview=1`. Verify Blogomat responds, the query reaches it, and the upstream sees `/blog/story?preview=1` in preserve mode or `/story?preview=1` in strip mode. Check redirects remain under `/blog`.
3. Static assets: use browser Network tools to identify an actual Blogomat CSS/JS/image URL. Request it, for example `curl -i 'https://onui.com/blog/assets/site.css?v=1'`. It must return the expected asset with the correct content type. Check the rendered page requests `/blog/...` assets rather than root assets from the main app.
4. POST: use a dedicated staging endpoint that safely echoes requests, or a disposable Blogomat draft endpoint. For example: `curl -i 'https://onui.com/blog/__proxy-check?draft=1' -X POST -H 'Content-Type: application/json' --data '{"title":"proxy check"}'`. Verify the application receives POST, the JSON body, the query, the chosen upstream path, public host/protocol and `X-Forwarded-Prefix: /blog`. `__proxy-check` is an example test endpoint, not an endpoint Risved adds to Blogomat.
5. Add `/blog/admin` temporarily and verify longest-prefix precedence. Redeploy/rollback Blogomat and verify the main homepage and blog paths still work. Remove only the test blog mount and confirm the main root remains. Use test mappings only.
6. In the browser, exercise navigation, login/logout and a callback, inspect cookie paths, and test any SSE or WebSocket feature. These checks establish Blogomat's mount compatibility beyond basic proxy transport.

## Automated Risved checks

```sh
bun x vitest run --project server src/lib/server/caddy src/lib/server/db/domain-paths.test.ts src/lib/server/domain-mappings.test.ts src/lib/server/pipeline
bun x vitest run --project client src/lib/components/DomainMountFields.svelte.test.ts
bun run check
```

For real HTTP transport coverage, point `RISVED_TEST_CADDY` at a local Caddy 2 executable:

```sh
RISVED_TEST_CADDY=/absolute/path/to/caddy bun x vitest run --project server src/lib/server/caddy/path-routing.integration.test.ts
```

That suite starts temporary loopback listeners and an isolated Caddy admin endpoint, uses no Risved database or live configuration, and cleans up afterward. It verifies both forwarding modes, exact mount requests, nested paths, queries, static asset paths, POST bodies, forged forwarding headers, boundaries, longest-prefix routing, root fallback, streaming, WebSocket upgrades and sibling-safe removal. It uses fixture upstreams and HTTP with automatic HTTPS disabled; real DNS, certificate issuance and Blogomat behavior require the staging checks above.
