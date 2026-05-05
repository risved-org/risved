---
description: Run coverage, fix failing tests, and add tests for low-coverage areas
---

# Test health routine

Run a full pass over the test suite: get tests green, then push coverage up.

Optional scope: `$ARGUMENTS` — when present, narrow the work to a path or area
(e.g. `pipeline`, `src/lib/server/cleanup`, `routes/api/projects`). Treat it as a
filter on which files to fix and which gaps to fill, not a hard restriction —
shared mocks/utilities can still be touched if needed.

## Phase 0 — baseline

1. `bun run test:coverage` — capture stdout+stderr to a temp file (the diff
   output for failing tests is large; reading from a file with `grep` is much
   easier than re-running).
2. Record pass/fail counts and the four coverage percentages (Statements,
   Branches, Functions, Lines). These are the before/after deltas for the
   final report.
3. If `Coverage summary` doesn't appear in the output, check that
   `coverage.reportOnFailure: true` is set in `vite.config.ts` — without it,
   vitest 4 silently skips the report whenever any test fails.

## Phase 1 — fix failing tests

Triage failures into categories before fixing — fixes within a category often
share a root cause and one mock/schema update can clear several at once.

Common categories in this repo:

- **Stale UI source-string assertions** — tests do
  `await import('./+page.svelte?raw')` and `expect(...).toContain('some-class')`.
  When the UI is redesigned the substring drifts. Read the current Svelte file
  and update the test's expectation to a stable, semantic anchor that still
  exists (`data-testid="..."`, a known `class="badge-..."`, an import path).
  Don't revert UI to satisfy the test — the test is the stale party.
- **Schema mock drift** — `[vitest] No "<name>" export is defined on the
  "$lib/server/db/schema" mock`. Either add the missing export to the test's
  `vi.mock('$lib/server/db/schema', ...)` block, or also mock the upstream
  module that imports it (commonly `$lib/server/settings`, which pulls in
  `settings`). For load functions, also count the order of `getSetting()` calls
  — if a new `getSetting('something')` was added in the loader, every
  `mockResolvedValueOnce(...)` chain in the test must add a placeholder for it
  in the right position, otherwise downstream values shift by one.
- **Pipeline / docker / rollback drift** — the implementation reorganized
  (e.g. release flow now uses `docker build --target build` then a separate
  `docker run risved-release-...`; rollback uses `docker rm -f → docker run`
  instead of rename/restore). When a test asserts a removed code path,
  rewrite the assertion to match the new flow rather than restoring the old
  behavior. When in doubt, read the implementation file end-to-end before
  touching the test.
- **CLI integration tests (`cli.test.ts`)** — these spawn `node scripts/risved.mjs`
  against a SQLite DB. If the CLI's `findDbPath()` picks `local.db` before
  `DATABASE_URL`, tests run against the dev DB instead of the test fixture.
  Make sure `DATABASE_URL` takes precedence in the CLI.
- **Implementation-truth tests** — when a test name encodes a deliberate spec
  (e.g. `"adjusts decimal places based on magnitude"`), the test is the source
  of truth and the implementation should match it. Update the impl, not the
  test.

Decision rule when it's ambiguous which side is right:

- If the test name describes the desired behavior in detail and the impl is
  obviously a regression → fix the impl.
- If the test asserts a UI string/class that the user actively redesigned →
  fix the test.
- If git history (`git log -- <file>`) shows recent intentional change to
  one side and not the other, the changed side is the source of truth.

After each fix, run that single test file with `bun x vitest --run <path>` to
confirm it passes before moving to the next category. Don't batch fixes
across categories without verification — a wrong fix in one category will
cascade.

## Phase 2 — coverage gaps

Once the suite is green, look at the per-file coverage table at the top of
`/tmp/cov_*.txt` (or `coverage/index.html` in a browser).

Prioritize gaps by impact, not by raw percentage:

1. **0% files that are reachable in production** — usually missing
   tests entirely. Check `src/routes/api/**/+server.ts` and
   `src/routes/**/+page.server.ts` first; these are public surface area.
2. **<30% on critical modules** — anything in `src/lib/server/{pipeline,
   cleanup, caddy, dockerfile, detection, github, gitlab, forgejo, update}`
   below 30% deserves attention. Skip files where the uncovered lines are
   purely defensive error branches (e.g. a single `catch` that re-throws).
3. **Branches < statements by >15 points** — usually means happy paths are
   tested but edge cases (null inputs, empty arrays, error responses) aren't.
   Add cases for the obvious `if (...) return null` / `if (!x) throw` branches.

Skip:

- `src/lib/paraglide/**` (generated)
- `src/lib/components/**` UI components (covered indirectly via page tests)
- Marketing pages (`src/routes/(marketing)/**`)
- Anything already excluded in `vite.config.ts` coverage.exclude

## Phase 3 — write tests

Follow the existing test patterns in this repo (don't invent a new style):

- Server-side tests: vitest `describe`/`it`, mock `$lib/server/db` with a
  chained mock builder (see `src/routes/api/projects/projects-api.test.ts` for
  the canonical shape), mock `drizzle-orm` (`eq`, `and`, `desc`), mock
  `$lib/server/db/schema` with stub objects.
- Mock `$lib/server/settings` rather than mocking the `settings` schema
  table directly — it's cleaner and avoids the deep-dependency trap.
- For page-source assertions, prefer `data-testid="..."` and stable class
  names over text content (text drifts faster than structure).
- New test files go next to the source: `foo.ts` → `foo.test.ts` adjacent.
- Use `bun` not `npm`. Use Svelte 5 runes (`$state`, `$derived`, `$props()`,
  `$effect`) — see `CLAUDE.md` for the full syntax rules.
- No semicolons in JS, semicolons in CSS, no Tailwind, no inline styles.

After adding each new test file, run it in isolation to confirm it passes,
then add the next one.

## Phase 4 — report

Run `bun run test:coverage` once more. Capture:

- Pass/fail counts (should be `<N> passed (<N>)`, no failures)
- Coverage delta: before → after for each of Statements / Branches /
  Functions / Lines
- New tests added (file paths)
- Tests fixed and what category they fell into
- Anything you deliberately left untouched and why (e.g. low-coverage file
  that's mostly dead code, or a failing test that depends on infrastructure
  not available locally)

## Phase 5 — branch and PR

If `git status` shows no changes, stop here and report "no drift, suite clean".

Otherwise:

1. `git checkout -b chore/test-health-$(date +%Y-%m-%d-%H%M)` from `main`.
2. Stage and commit in **two** logical commits when both phases produced
   changes (so the reviewer can scan separately):
   - `test: fix N stale tests` — Phase 1 fixes
   - `test: add coverage for <areas>` — Phase 3 additions
   If only one phase touched files, a single commit is fine. Use imperative
   mood, no period, under 72 chars (per `CLAUDE.md` commit format).
3. Run `bun run test:coverage` one final time on the branch tip; **do not
   push if any test fails or if the suite errors out** — leave the branch
   local and report what broke instead.
4. `git push -u origin <branch>`.
5. `gh pr create --base main --title "Test health: <one-line summary>"
   --body "<the Phase 4 report as markdown>"`. Title should encode the
   shape of the change, e.g. `Test health: fixed 12 tests, +2.3% lines`.
   Body should include the full coverage delta table, the categorized
   list of fixed tests, the list of new test files, and the "left
   untouched" notes.
6. Print the PR URL at the end.

Do **not** merge the PR, do **not** bump the version, do **not** tag or
release. Those steps stay manual — the user reviews the PR and decides
what ships. The `CLAUDE.md` version-bump-and-tag rules only apply on
explicit release requests.
