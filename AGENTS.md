# Code Quality Standards

Always apply these standards to all code you write.

## Reuse Before Creating

Before writing new code, analyze existing utilities, components, hooks, helpers and tests:

1. **Search first** — grep/glob for similar functionality before implementing
2. **Extend if close** — if something exists that's 80% of what you need, extend it
3. **Extract if duplicating** — if you're about to copy-paste, extract to shared module instead

## File Size & Organization

Keep files between **200-300 lines max**. If a file exceeds this:

1. **Split by responsibility** — one module = one concern
2. **Extract sub-components** — UI pieces that can stand alone should
3. **Separate logic from presentation** — hooks/utils in their own files
4. **Group by feature** — co-locate related files, not by type

Signs a file needs splitting:
- Multiple unrelated exports
- Scrolling to find what you need
- "Utils" file becoming a junk drawer
- Component doing data fetching + transformation + rendering

## Code Style

1. Prefer writing clear code and use inline comments sparingly
2. Document methods with block comments at the top of the method
3. Use Conventional Commit format

## Test To Verify Functionality

If you didn't test it, it doesn't work.

Verify written code by:
- Running unit tests
- Running end to end tests
- Checking for type errors
- Checking for lint errors
- Smoke testing and checking for runtime errors with Playwright
- Taking screenshots and verifying the UI is as expected

## Critical Security Guard: MCP Form-Origin Checks

SvelteKit's built-in form-origin guard is disabled through `kit.csrf.trustedOrigins: ['*']` only because native MCP OAuth clients send form-encoded token requests without an Origin header. The application MUST preserve equivalent protection using `handleFormOrigin` in `src/lib/server/mcp/form-origin.ts`.

- Keep `handleFormOrigin` FIRST in the `src/hooks.server.ts` sequence, before localization, authentication, and any handler that may return a response.
- Preserve the origin check on POST, PUT, PATCH, and DELETE form submissions everywhere except exactly `POST /api/auth/mcp/token`. Login, settings, access-key management, OAuth authorization, and OAuth consent must remain protected.
- The exempt token endpoint must never authorize mutations through session cookies. It requires an authorization code with S256 PKCE or a refresh token.
- Never remove, reorder, weaken, or broaden this guard without an explicit security review. Do not treat the wildcard configuration as permission to allow cross-origin forms elsewhere.
- Before changing this guard, authentication, CSRF configuration, hook ordering, or the SvelteKit version, run its unit tests and `bun run test:mcp`. Production browser tests must verify standard form-encoded token exchange AND rejection of cross-origin authenticated settings and consent submissions. Development mode alone cannot verify this guard.
- If a future SvelteKit version supports a suitable native per-endpoint exception, prefer restoring the framework guard and preserve these regression tests.
