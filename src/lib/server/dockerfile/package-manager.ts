import type { Lockfile } from './types'

interface PackageManagerCommands {
	/** Line that copies package.json and any relevant lockfile wildcards. */
	copyLine: string
	/** Install command that honours frozen-lockfile semantics. */
	install: string
	/** `<pm> run` prefix for substituting into the framework build command. */
	run: string
	/** Prune command for frameworks that copy node_modules to runtime. */
	prune: string
}

/**
 * Map a detected lockfile (and optionally the Yarn release line) to the right
 * shell commands. All package managers live in the unified warm image, so no
 * per-manager cache-mount or conditional install step is needed here.
 */
export function pmFromLockfile(
	lockfile?: Lockfile | null,
	yarnVersion?: 'classic' | 'berry'
): PackageManagerCommands {
	switch (lockfile) {
		case 'bun.lockb':
		case 'bun.lock':
			return {
				copyLine: 'COPY package.json bun.lockb* bun.lock* ./',
				install: 'bun install --frozen-lockfile',
				run: 'bun run',
				prune: 'rm -rf node_modules && bun install --frozen-lockfile --production'
			}
		case 'pnpm-lock.yaml':
			return {
				copyLine: 'COPY package.json pnpm-lock.yaml ./',
				install: 'pnpm install --frozen-lockfile',
				run: 'pnpm run',
				prune: 'pnpm prune --prod'
			}
		case 'yarn.lock':
			if (yarnVersion === 'berry') {
				return {
					copyLine: 'COPY package.json yarn.lock .yarnrc.yml* ./',
					install: 'yarn install --immutable',
					run: 'yarn',
					prune: 'yarn workspaces focus --production --all'
				}
			}
			return {
				copyLine: 'COPY package.json yarn.lock ./',
				install: 'yarn install --frozen-lockfile',
				run: 'yarn',
				prune: 'yarn install --production --ignore-scripts'
			}
		default:
			return {
				copyLine: 'COPY package.json package-lock.json* ./',
				install: 'npm ci || npm install',
				run: 'npm run',
				prune: 'npm prune --omit=dev'
			}
	}
}
