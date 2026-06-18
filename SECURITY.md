# Security

This document describes how risved handles secrets, what its encryption does
and does not protect against, and how to rotate keys. It is aimed at operators
self-hosting risved on their own server.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.
Email the maintainers (see repository contacts) with details and reproduction
steps. We aim to acknowledge reports promptly.

## Secrets in a risved install

A risved instance relies on a few secrets. With the provided installer
(`scripts/install.sh`) these are **generated per install** and never shipped in
the repository:

| Secret | Purpose | Where it lives |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Signs Better Auth sessions | `data/.auth-secret` (generated, `0600`) |
| `CALLBACK_SECRET` | Per-instance shared secret with the risved.com OAuth proxy | `data/.callback-secret` (generated, `0600`) |
| `.risved-encryption.key` | 32-byte AES-256-GCM key encrypting data at rest | `data/.risved-encryption.key` (auto-generated, `0600`) |
| `GITHUB_CLIENT_SECRET` etc. | OAuth app credentials (only in "custom" provider mode) | `.env` / process env |

The installer generates `BETTER_AUTH_SECRET` and `CALLBACK_SECRET` with
`openssl rand -hex 32`, and `crypto.ts` auto-generates the encryption key on
first use. **None of these should ever be committed to git.** `.env` and key
material are covered by `.gitignore`, a pre-commit guard, and a CI secret scan
(see "Preventing secret commits" below).

## What the at-rest encryption protects

risved encrypts sensitive values before storing them in the database — git
provider OAuth tokens and project environment variables — using AES-256-GCM via
`src/lib/server/crypto.ts`.

**Protected against:** exposure of the database alone. For example a backup
copied to the wrong place, a stray copy of the `*.db` file, or a SQL-injection
style row dump yields ciphertext, not plaintext tokens.

**NOT protected against:** full host / root compromise. The encryption key lives
on the same volume as the database it protects (`data/`), so an attacker who can
read arbitrary files on the server can obtain both the key and the ciphertext.
Encryption at rest is a meaningful layer, not a substitute for host security.
Harden the server, restrict SSH, keep backups encrypted and access-controlled.

## Rotating secrets

### `BETTER_AUTH_SECRET`
Replace the value (e.g. regenerate `data/.auth-secret` with
`openssl rand -hex 32`) and restart. Existing sessions are invalidated; users
log in again. No data migration needed.

### `CALLBACK_SECRET`
Regenerate `data/.callback-secret` and restart. Only affects in-flight OAuth
proxy handshakes; users simply retry connecting a provider.

### OAuth app credentials (`GITHUB_CLIENT_SECRET`, …)
Rotate in the provider's developer settings, update the env value, restart.

### `.risved-encryption.key` (encryption key) — requires care
This key decrypts data already stored in the database. **Do not simply replace
it** — any value encrypted with the old key becomes undecryptable, and
`safeDecrypt` will silently return the still-encrypted string. To rotate safely:

1. Stop the app (or put it in maintenance) so nothing writes new ciphertext.
2. With the **old** key, decrypt every encrypted column (git tokens, project
   env vars).
3. Generate a **new** key and re-encrypt those values with it.
4. Swap in the new key file and restart.

> There is currently no built-in `rotate-key` command or key-versioning scheme;
> rotation is a manual migration. If your key may have been exposed, treat all
> stored provider tokens as compromised and revoke/reissue them at the provider
> in addition to rotating the key.

## If a secret was committed to git

Removing a secret from the latest commit does **not** remove it from history.
Anyone who cloned the repo, plus caches and forks, may still have it. Treat the
value as compromised and rotate it (see above), then scrub history following
`docs/runbooks/scrub-env-from-history.md`.

## Preventing secret commits

Three layers guard against committing secrets:

1. **`.gitignore`** — ignores `.env`, `.env.*` (except `.env.example` /
   `.env.test`), `*.key`, and `.risved-encryption.key`.
2. **Pre-commit hook** (`.pre-commit-config.yaml`) — gitleaks plus a filename
   block hook. Install once per clone with `pre-commit install`. Local only and
   bypassable; it catches honest mistakes.
3. **CI secret scan** (`.github/workflows/secret-scan.yml`) — runs gitleaks on
   every push and pull request. Make this a **required status check** on the
   default branch so a leak cannot be merged.
