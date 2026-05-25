```markdown
# risved Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches you the core development patterns, coding conventions, and automated workflows used in the `risved` TypeScript codebase, which is built on Vite and leverages Playwright for testing. You'll learn how to structure code, write and maintain tests, manage database migrations, handle Docker pipelines, refactor UI components, and implement or fix API endpoints using a set of standardized commands and best practices.

---

## Coding Conventions

**File Naming**
- Use `camelCase` for file and folder names.
  - Example: `userProfile.ts`, `dashboardView.svelte`

**Imports**
- Use absolute import paths from the project root.
  - Example:
    ```typescript
    import { getUser } from 'src/lib/server/user';
    ```

**Exports**
- Prefer named exports.
  - Example:
    ```typescript
    // Good
    export function fetchData() { ... }
    export const API_URL = '...';

    // Avoid default exports
    // export default function fetchData() { ... }
    ```

**Commit Messages**
- Use prefixes: `fix:`, `feat:`, `style:`
- Keep commit messages concise (~44 characters on average).
  - Example: `fix: handle null user in dashboard view`

---

## Workflows

### Test Health Maintenance
**Trigger:** When test suites are failing, stale, or coverage needs to be improved.  
**Command:** `/test-health`

1. Identify failing or outdated test suites.
2. Fix broken tests or update test logic/mocks.
3. Add new test files or cases to increase coverage.
4. Commit changes to relevant `*.test.ts` files.
5. Optionally, run `/test-health` to automate checks.

**Files involved:**
- `src/**/*.test.ts`
- `src/routes/**/*.test.ts`
- `src/lib/**/*.test.ts`

**Example:**
```typescript
// src/lib/user.test.ts
import { getUser } from 'src/lib/user';

test('returns user by id', async () => {
  const user = await getUser(1);
  expect(user.name).toBe('Alice');
});
```

---

### Version Bump Release
**Trigger:** When a new release is ready to be published or after significant changes.  
**Command:** `/bump-version`

1. Update the version in `package.json`.
2. Commit the change with a message like `bump version to x.x.x`.

**Files involved:**
- `package.json`

**Example:**
```json
// package.json
{
  "version": "1.2.3"
}
```

---

### Database Schema Migration
**Trigger:** When a new table/column is added or schema needs to be changed.  
**Command:** `/new-table`

1. Edit `src/lib/server/db/schema.ts` to add/modify tables or columns.
2. Generate a new migration SQL file in `drizzle/` (e.g., `drizzle/0004_add_user_table.sql`).
3. Update `drizzle/meta/_journal.json` to track the migration.
4. Commit all related files together.

**Files involved:**
- `src/lib/server/db/schema.ts`
- `drizzle/*.sql`
- `drizzle/meta/_journal.json`

**Example:**
```typescript
// src/lib/server/db/schema.ts
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }),
});
```

---

### Docker Pipeline Fix or Feature
**Trigger:** When a Docker build/deploy issue is found or a new framework/build config is supported.  
**Command:** `/fix-docker-pipeline`

1. Edit `src/lib/server/pipeline/docker.ts` and related pipeline files.
2. Update or add tests in `src/lib/server/pipeline/docker.test.ts`.
3. Optionally update Dockerfile templates/configs if needed.
4. Commit all related files together.

**Files involved:**
- `src/lib/server/pipeline/docker.ts`
- `src/lib/server/pipeline/docker.test.ts`
- `src/lib/server/pipeline/index.ts`
- `src/lib/server/dockerfile/*.ts`

---

### UI Design System Refactor
**Trigger:** When the design system or dashboard UI needs updates or new patterns.  
**Command:** `/refactor-ui`

1. Edit Svelte components in `src/lib/components/` and `src/routes/`.
2. Update layout and style files (e.g., `src/routes/layout.css`).
3. Refactor or redesign dashboard/project/settings pages.
4. Commit all related UI files together.

**Files involved:**
- `src/lib/components/*.svelte`
- `src/routes/**/*.svelte`
- `src/routes/layout.css`

**Example:**
```svelte
<!-- src/lib/components/Button.svelte -->
<button class="primary">{label}</button>
```

---

### API Endpoint Fix or Feature
**Trigger:** When a new API endpoint is needed or an existing one requires a fix.  
**Command:** `/new-api-endpoint`

1. Edit or add `src/routes/api/**/*.ts` files for endpoint logic.
2. Update or add corresponding `*.test.ts` files for the endpoint.
3. Commit logic and test changes together.

**Files involved:**
- `src/routes/api/**/*.ts`
- `src/routes/api/**/*.test.ts`

**Example:**
```typescript
// src/routes/api/user.ts
export async function get(request) {
  // endpoint logic
}
```

---

## Testing Patterns

- **Framework:** Playwright
- **Test File Pattern:** `*.test.ts`
- **Location:** Place tests alongside source files or in dedicated test directories.
- **Example Test:**
  ```typescript
  // src/routes/api/user.test.ts
  import { test, expect } from '@playwright/test';

  test('GET /api/user returns user data', async ({ request }) => {
    const response = await request.get('/api/user?id=1');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.name).toBe('Alice');
  });
  ```

---

## Commands

| Command              | Purpose                                               |
|----------------------|-------------------------------------------------------|
| /test-health         | Fix and maintain test suites, increase coverage       |
| /bump-version        | Bump package version for a new release                |
| /new-table           | Add or modify database schema and generate migration  |
| /fix-docker-pipeline | Fix or enhance Docker build/deploy pipeline           |
| /refactor-ui         | Refactor or polish UI design system and dashboard     |
| /new-api-endpoint    | Implement or fix API endpoints and related tests      |
```
