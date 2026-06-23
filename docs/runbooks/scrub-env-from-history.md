# Runbook: Scrub `.env` from git history

The file `.env` (containing real secrets) was committed in `88ab3c6`
("fix: SSH deploy key invalid format error") and is an ancestor on `main`.
Untracking it (done in this branch) stops *future* commits but leaves the
secret values in every commit reachable from `88ab3c6`. This runbook removes
them from history.

> **Order of operations:** rotate the secrets FIRST (step 0). History rewriting
> does not make the leaked values safe — anyone who cloned/fetched, or any cache
> (CI logs, forks, GitHub's own commit cache), may still hold them. Rewriting
> history only reduces future exposure. Rotation is the control that actually
> protects you.

---

## Step 0 — Rotate every secret (prerequisite)

These were in the committed `.env`. Treat all as compromised and rotate before
or in parallel with the rewrite:

- `DATABASE_URL` — rotate DB credentials / connection password
- `BETTER_AUTH_SECRET` — regenerate (32+ chars, high entropy)
- `CALLBACK_SECRET` — regenerate the AES-256-GCM shared secret (coordinate with risved.com)
- `GITHUB_CLIENT_SECRET` — regenerate in the GitHub OAuth app
- `GITHUB_CLIENT_ID` — rotate only if you also recreate the OAuth app
- `ORIGIN` — non-secret, no action

---

## Step 1 — Preconditions

- This is a **destructive, coordinated** operation. It rewrites `main` and every
  branch descended from `88ab3c6`, changing all of their commit SHAs.
- Schedule a window. Tell collaborators to push/merge outstanding work first and
  to **re-clone** afterward (a normal `git pull` will not reconcile a rewritten
  history).
- You need force-push rights to `main` (and any protected branches). Temporarily
  relax branch protection / required force-push restrictions for the window.

Install `git-filter-repo` (not present in the Claude session env):

```bash
# pick one
pipx install git-filter-repo
# or
pip install --user git-filter-repo
# or (Debian/Ubuntu)
sudo apt-get install git-filter-repo
```

## Step 2 — Fresh mirror clone

Always rewrite against a fresh **mirror** clone, never your working checkout:

```bash
git clone --mirror git@github.com:risved-org/risved.git risved-mirror.git
cd risved-mirror.git
```

## Step 3 — Remove `.env` from all history

```bash
git filter-repo --invert-paths --path .env
```

`--invert-paths --path .env` keeps everything except `.env`, across all refs and
all commits. (`.env.example` and `.env.test` are untouched — only the exact path
`.env` is removed.)

Verify it's gone:

```bash
git log --all --oneline -- .env        # expect: no output
git rev-list --all | wc -l             # sanity: commits still present
```

> Optional belt-and-suspenders: also strip any lingering secret *strings* that
> may have been pasted elsewhere (commit messages, other files). Create a
> `replacements.txt` with one `literal-secret==>REDACTED` per line and run
> `git filter-repo --replace-text replacements.txt`. Run this BEFORE step 4.

## Step 4 — Push the rewritten history

`git-filter-repo` removes the `origin` remote by design. Re-add and force-push
all refs:

```bash
git remote add origin git@github.com:risved-org/risved.git
git push --force --all
git push --force --tags
```

## Step 5 — Post-rewrite cleanup

- **GitHub still caches old commits.** Reachable-by-SHA URLs may resolve for a
  while. Open a GitHub Support request to purge cached views/refs if needed, and
  delete stale PRs/branches that still point at old SHAs.
- **Forks keep their own copy.** Any fork retains the secret until its owner
  rebases/re-syncs. Identify forks and notify owners (rotation in step 0 is what
  saves you here).
- Re-enable branch protection.
- Tell all collaborators to re-clone:
  ```bash
  # everyone with an existing clone:
  cd <repo> && git fetch origin && git reset --hard origin/main
  # safest is a clean re-clone
  ```
- Have CI re-run from the new tip; invalidate/rotate any CI-stored copies of the
  secrets and clear CI logs that may have echoed them.

## Step 6 — Confirm `.env` cannot return

Already in place on this branch, but verify on `main` after the rewrite:

- `.gitignore` contains `.env` and `.env.*` with `!.env.example` / `!.env.test`
- `.env` is **not** tracked: `git ls-files | grep -x .env` returns nothing
- Optionally add a pre-commit / CI guard (e.g. gitleaks or a hook) to block
  committing `.env` or secret-looking strings going forward.

---

### Why this couldn't be done from the Claude Code session

The session's push scope is limited to the feature branch
`claude/env-file-commit-check-s8soz9`; it cannot force-push `main`. History
rewriting also must run against a full mirror clone with `git-filter-repo`, which
is not installed in the ephemeral session environment. Hence this runbook for an
operator with the right access.
