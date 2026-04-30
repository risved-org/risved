import type { FrameworkBuildConfig, Lockfile } from './types';

const DENO_IMAGE = 'denoland/deno:latest';
const NODE_IMAGE = 'node:22-slim';

/* Unified warm base image for Node-tier builds. Contains Node 22, Corepack-
   managed pnpm and Yarn (Classic + Berry), and Bun installed globally.
   Rebuilt on the Sunday cron schedule. */
const NODE_BUILD_IMAGE = 'risved-node-build:22';

function isBun(lockfile?: Lockfile | null): boolean {
	return lockfile === 'bun.lockb' || lockfile === 'bun.lock'
}

interface PackageManagerCommands {
	/** Line that copies package.json and any relevant lockfile wildcards. */
	copyLine: string;
	/** Install command that honours frozen-lockfile semantics. */
	install: string;
	/** `<pm> run` prefix for substituting into the framework build command. */
	run: string;
	/** Prune command for frameworks that copy node_modules to runtime. */
	prune: string;
}

/**
 * Map a detected lockfile (and optionally the Yarn release line) to the right
 * shell commands. All package managers live in the unified warm image, so no
 * per-manager cache-mount or conditional install step is needed here.
 */
function pmFromLockfile(
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

/** Wildcard copy line that captures every lockfile we support at once. */
const ALL_LOCKFILES_COPY =
	'COPY package.json bun.lockb* bun.lock* pnpm-lock.yaml* yarn.lock* package-lock.json* .yarnrc.yml* ./';

/**
 * Tier 1 (Pure Deno): Fresh, Hono, Lume
 * Single stage using denoland/deno image.
 */
export function denoTemplate(config: FrameworkBuildConfig, port: number): string {
	const lines: string[] = [`FROM ${DENO_IMAGE} AS build`, '', 'WORKDIR /app', ''];

	// Copy all source files
	lines.push('COPY . .');

	// Cache dependencies
	lines.push(`RUN ${config.installCommand}`);

	// Build step (Lume has a build, Fresh/Hono do not)
	if (config.buildCommand) {
		lines.push(`RUN ${config.buildCommand}`);
	}

	lines.push('', 'RUN mkdir -p /app/data && chmod 777 /app/data');
	lines.push('', `EXPOSE ${port}`, '', `CMD [${shellToCmdArray(config.serveCommand)}]`, '');

	return lines.join('\n');
}

/**
 * Tier 2 (Hybrid): Node build, Deno serve
 * Two stages: Node for building, Deno for serving.
 */
export function hybridTemplate(
	config: FrameworkBuildConfig,
	port: number,
	installCommand?: string,
	buildCommand?: string,
	lockfile?: Lockfile | null,
	yarnVersion?: 'classic' | 'berry'
): string {
	const pm = pmFromLockfile(lockfile, yarnVersion)
	const install = installCommand ?? pm.install
	const build = buildCommand ?? config.buildCommand.replace('npm run', pm.run)

	const copyLine = installCommand ? ALL_LOCKFILES_COPY : pm.copyLine
	const needsNodeModules = config.copyPaths.includes('node_modules')

	const lines: string[] = [
		`# Build stage (retains dev deps for release commands)`,
		`FROM ${NODE_BUILD_IMAGE} AS build`,
		'',
		'WORKDIR /app',
		'',
		copyLine,
		`RUN ${install}`,
		'',
		'COPY . .',
		`RUN ${build}`,
	]

	/* Prune in a separate stage so --target build still has dev deps */
	const copyFrom = needsNodeModules ? 'deps' : 'build'
	if (needsNodeModules) {
		lines.push(
			'',
			`# Pruned deps stage`,
			`FROM build AS deps`,
			`RUN ${pm.prune}`
		)
	}

	lines.push(
		'',
		`# Runtime stage`,
		`FROM ${DENO_IMAGE}`,
		'',
		'WORKDIR /app',
		''
	)

	// Copy build output from builder
	for (const copyPath of config.copyPaths) {
		if (copyPath.includes('*')) {
			lines.push(`COPY --from=${copyFrom} /app/${copyPath} ./`)
		} else {
			lines.push(`COPY --from=${copyFrom} /app/${copyPath} ./${copyPath}`)
		}
	}

	lines.push('', 'RUN mkdir -p /app/data && chmod 777 /app/data')
	lines.push('', `EXPOSE ${port}`, '', `CMD [${shellToCmdArray(config.serveCommand)}]`, '')

	return lines.join('\n');
}

/**
 * Tier 3 (Node): Node build, Node serve
 * Build stage uses the unified warm image (all package managers pre-installed);
 * runtime is slim Node with no package manager tooling or dev deps.
 */
export function nodeTemplate(
	config: FrameworkBuildConfig,
	port: number,
	installCommand?: string,
	buildCommand?: string,
	lockfile?: Lockfile | null,
	yarnVersion?: 'classic' | 'berry'
): string {
	const pm = pmFromLockfile(lockfile, yarnVersion)
	const install = installCommand ?? pm.install
	const build = buildCommand ?? config.buildCommand.replace('npm run', pm.run)

	const copyLine = installCommand ? ALL_LOCKFILES_COPY : pm.copyLine
	const needsNodeModules = config.copyPaths.includes('node_modules')

	/* Directories in copyPaths that may not exist in every project
	   (e.g. static/ in Nuxt 2). Ensure they exist so COPY never fails. */
	const ensureDirs = config.copyPaths.filter(
		p => !p.includes('*') && !p.includes('.') && p !== 'node_modules'
	)
	const ensureCmd = ensureDirs.length > 0
		? ` && mkdir -p ${ensureDirs.join(' ')}`
		: ''

	const lines: string[] = [
		`# Build stage (retains dev deps for release commands)`,
		`FROM ${NODE_BUILD_IMAGE} AS build`,
		'',
		'WORKDIR /app',
		'',
		copyLine,
		`RUN ${install}`,
		'',
		'COPY . .',
		`RUN ${build}${ensureCmd}`,
	]

	/* Prune in a separate stage so --target build still has dev deps */
	const copyFrom = needsNodeModules ? 'deps' : 'build'
	if (needsNodeModules) {
		lines.push(
			'',
			`# Pruned deps stage`,
			`FROM build AS deps`,
			`RUN ${pm.prune}`
		)
	}

	lines.push(
		'',
		`# Runtime stage`,
		`FROM ${NODE_IMAGE} AS runtime`,
		'',
		'WORKDIR /app',
		''
	)

	// Copy build output from builder
	for (const copyPath of config.copyPaths) {
		if (copyPath.includes('*')) {
			lines.push(`COPY --from=${copyFrom} /app/${copyPath} ./`)
		} else {
			lines.push(`COPY --from=${copyFrom} /app/${copyPath} ./${copyPath}`)
		}
	}

	lines.push('', 'RUN mkdir -p /app/data && chmod 777 /app/data')
	lines.push('', `EXPOSE ${port}`, '', `CMD [${shellToCmdArray(config.serveCommand)}]`, '')

	return lines.join('\n');
}

/**
 * Convert a shell command string to a Docker CMD JSON array format.
 * "deno run --allow-all main.ts" → '"deno", "run", "--allow-all", "main.ts"'
 */
function shellToCmdArray(command: string): string {
	return command
		.split(/\s+/)
		.map((part) => `"${part}"`)
		.join(', ');
}
