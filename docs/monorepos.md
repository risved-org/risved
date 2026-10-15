# Deploying an app from a monorepo

Create a project, select your repository and branch, and set **App directory** to
the folder containing the app, such as `apps/fractional`. Create another project
from the same repository with `apps/founding` to deploy the second app.

Leave App directory empty for automatic framework detection at the repository
root. Existing projects keep their current build behavior.

For Bun workspaces, commit the root `package.json`, `bun.lock` (or `bun.lockb`),
and all workspace manifests. Risved installs from the workspace root using
`bun install --frozen-lockfile`, then builds the selected app and its local
dependencies in dependency order. Source-only shared packages do not need a build
script. Unrelated apps are installed as part of the workspace but are not built.

Both forms of the `workspaces` field are supported. pnpm projects use
`pnpm-workspace.yaml` and `pnpm-lock.yaml`. npm and Yarn workspaces use their
respective lockfiles. Build command overrides run in the selected app directory,
after any shared package build scripts. Start and release commands also run there.

Change the path later under **Settings → Source**. Paths are relative to the
repository, cannot contain `..`, and must exist on the selected branch when
deployment runs.

This first version preserves the workspace tree and dependencies in the runtime
image to keep workspace links intact. It does not filter push deployments by
changed paths: each project's configured webhook still triggers a deployment.
Custom Dockerfile paths and static-only application deployment are separate work.
