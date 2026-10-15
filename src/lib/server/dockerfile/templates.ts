import { pmFromLockfile } from './package-manager'
import { BUN_VERSION, type ProjectRuntime } from '$lib/project-runtime'
import type { FrameworkBuildConfig, Lockfile } from './types';

const DENO_IMAGE = 'denoland/deno:latest';
const NODE_IMAGE = 'node:22-slim';
const BUN_IMAGE = `oven/bun:${BUN_VERSION}-debian`

/* Unified warm base image for Node-tier builds. Contains Node 22, Corepack-
   managed pnpm and Yarn (Classic + Berry), and Bun installed globally.
   Rebuilt on the Sunday cron schedule. */
const NODE_BUILD_IMAGE = 'risved-node-build:22';

/** Wildcard copy line that captures every lockfile we support at once. */
const ALL_LOCKFILES_COPY =
	'COPY package.json bun.lockb* bun.lock* pnpm-lock.yaml* yarn.lock* package-lock.json* .yarnrc.yml* ./';

/**
 * The pipeline writes project env vars to a build-time .env in the context.
 * Emptying it in a throwaway stage and copying from there keeps the values
 * out of every runtime layer (a plain `RUN` in the same stage would leave
 * them in the COPY layer), while the `build` target keeps it for release
 * commands. The file is emptied rather than removed because some start
 * commands require it to exist (`node --env-file=.env` exits if it doesn't);
 * at runtime the values come from `docker run -e`.
 */
const STRIP_BUILD_ENV_STAGE = (from: string): string[] => [
	`# Empty the injected build-time .env before anything reaches the runtime image`,
	`FROM ${from} AS output`,
	'RUN : > /app/.env'
]

/** True when the runtime stage copies the whole build context, .env included */
function copiesWholeContext(config: FrameworkBuildConfig): boolean {
	return config.copyPaths.includes('.')
}

/**
 * Tier 1 (Pure Deno): Fresh, Hono, Lume
 * Single stage using denoland/deno image — unless the pipeline injected a
 * build-time .env, in which case the app is copied into a clean runtime
 * stage so no layer of the final image contains the secrets.
 */
export function denoTemplate(
	config: FrameworkBuildConfig,
	port: number,
	stripBuildEnv = false
): string {
	const lines: string[] = [`FROM ${DENO_IMAGE} AS build`, '', 'WORKDIR /app', ''];

	// Copy all source files
	lines.push('COPY . .');

	// Cache dependencies
	lines.push(`RUN ${config.installCommand}`);

	// Build step (Lume has a build, Fresh/Hono do not)
	if (config.buildCommand) {
		lines.push(`RUN ${config.buildCommand}`);
	}

	if (stripBuildEnv) {
		lines.push(
			'',
			...STRIP_BUILD_ENV_STAGE('build'),
			'',
			`# Runtime stage`,
			`FROM ${DENO_IMAGE}`,
			'',
			'WORKDIR /app',
			'',
			'COPY --from=output /deno-dir /deno-dir',
			'COPY --from=output /app .'
		)
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
	yarnVersion?: 'classic' | 'berry',
	stripBuildEnv = false
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
		`RUN ${build}`
	]

	/* Prune in a separate stage so --target build still has dev deps */
	let copyFrom = needsNodeModules ? 'deps' : 'build'
	if (needsNodeModules) {
		lines.push('', `# Pruned deps stage`, `FROM build AS deps`, `RUN ${pm.prune}`)
	}

	if (stripBuildEnv && copiesWholeContext(config)) {
		lines.push('', ...STRIP_BUILD_ENV_STAGE(copyFrom))
		copyFrom = 'output'
	}

	lines.push('', `# Runtime stage`, `FROM ${DENO_IMAGE}`, '', 'WORKDIR /app', '')

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
	yarnVersion?: 'classic' | 'berry',
	stripBuildEnv = false,
	runtime: ProjectRuntime = 'node'
): string {
	const pm = pmFromLockfile(lockfile, yarnVersion)
	const install = installCommand ?? pm.install
	const build =
		buildCommand ??
		(runtime === 'bun'
			? config.buildCommand.replace('npm run', 'bun --bun run')
			: config.buildCommand.replace('npm run', pm.run))

	const copyLine = installCommand ? ALL_LOCKFILES_COPY : pm.copyLine
	const needsNodeModules = config.copyPaths.includes('node_modules')

	/* Directories in copyPaths that may not exist in every project
	   (e.g. static/ in Nuxt 2). Ensure they exist so COPY never fails. */
	const ensureDirs = config.copyPaths.filter(
		p => !p.includes('*') && !p.includes('.') && p !== 'node_modules'
	)
	const ensureCmd = ensureDirs.length > 0 ? ` && mkdir -p ${ensureDirs.join(' ')}` : ''

	const lines: string[] = [
		`# Build stage (retains dev deps for release commands)`,
		`FROM ${NODE_BUILD_IMAGE} AS build`,
		...(runtime === 'bun'
			? [`COPY --from=${BUN_IMAGE} /usr/local/bin/bun /usr/local/bin/bun`]
			: []),
		'',
		'WORKDIR /app',
		'',
		copyLine,
		`RUN ${install}`,
		'',
		'COPY . .',
		`RUN ${build}${ensureCmd}`
	]

	/* Prune in a separate stage so --target build still has dev deps */
	let copyFrom = needsNodeModules ? 'deps' : 'build'
	if (needsNodeModules) {
		lines.push('', `# Pruned deps stage`, `FROM build AS deps`, `RUN ${pm.prune}`)
	}

	if (stripBuildEnv && copiesWholeContext(config)) {
		lines.push('', ...STRIP_BUILD_ENV_STAGE(copyFrom))
		copyFrom = 'output'
	}

	lines.push(
		'',
		`# Runtime stage`,
		`FROM ${runtime === 'bun' ? BUN_IMAGE : NODE_IMAGE} AS runtime`,
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
