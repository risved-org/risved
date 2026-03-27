import type { FrameworkBuildConfig, Lockfile } from './types';

const DENO_IMAGE = 'denoland/deno:latest';
const NODE_IMAGE = 'node:22-slim';
const BUN_IMAGE = 'oven/bun:1';

function isBun(lockfile?: Lockfile | null): boolean {
	return lockfile === 'bun.lockb' || lockfile === 'bun.lock'
}

/** Map lockfile to the correct install/build commands and COPY line */
function pmFromLockfile(lockfile?: Lockfile | null): { copyLine: string; install: string; run: string } {
	switch (lockfile) {
		case 'bun.lockb':
		case 'bun.lock':
			return {
				copyLine: `COPY package.json ${lockfile} ./`,
				install: 'apt-get update && apt-get install -y python3 make g++ && bun install --frozen-lockfile',
				run: 'bun run'
			}
		case 'pnpm-lock.yaml':
			return {
				copyLine: 'COPY package.json pnpm-lock.yaml ./',
				install: 'corepack enable && pnpm install --frozen-lockfile',
				run: 'pnpm run'
			}
		case 'yarn.lock':
			return {
				copyLine: 'COPY package.json yarn.lock ./',
				install: 'corepack enable && yarn install --frozen-lockfile',
				run: 'yarn'
			}
		default:
			return {
				copyLine: 'COPY package.json package-lock.json* ./',
				install: 'npm ci',
				run: 'npm run'
			}
	}
}

/**
 * Tier 1 (Pure Deno): Fresh, Hono, Lume
 * Single stage using denoland/deno image.
 */
export function denoTemplate(config: FrameworkBuildConfig, port: number): string {
	const lines: string[] = [`FROM ${DENO_IMAGE}`, '', 'WORKDIR /app', ''];

	// Copy all source files
	lines.push('COPY . .');

	// Cache dependencies
	lines.push(`RUN ${config.installCommand}`);

	// Build step (Lume has a build, Fresh/Hono do not)
	if (config.buildCommand) {
		lines.push(`RUN ${config.buildCommand}`);
	}

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
	lockfile?: Lockfile | null
): string {
	const pm = pmFromLockfile(lockfile)
	const install = installCommand ?? pm.install
	const build = buildCommand ?? config.buildCommand.replace('npm run', pm.run)

	const builderImage = isBun(lockfile) ? BUN_IMAGE : NODE_IMAGE

	const lines: string[] = [
		`# Build stage`,
		`FROM ${builderImage} AS builder`,
		'',
		'WORKDIR /app',
		'',
		installCommand ? 'COPY package.json ./' : pm.copyLine,
		`RUN ${install}`,
		'',
		'COPY . .',
		`RUN ${build}`,
		'',
		`# Runtime stage`,
		`FROM ${DENO_IMAGE}`,
		'',
		'WORKDIR /app',
		''
	];

	// Copy build output from builder
	for (const copyPath of config.copyPaths) {
		lines.push(`COPY --from=builder /app/${copyPath} ./${copyPath}`);
	}

	lines.push('', `EXPOSE ${port}`, '', `CMD [${shellToCmdArray(config.serveCommand)}]`, '');

	return lines.join('\n');
}

/**
 * Tier 3 (Node): Node build, Node serve
 * Two stages: Node for building, Node slim for serving.
 */
export function nodeTemplate(
	config: FrameworkBuildConfig,
	port: number,
	installCommand?: string,
	buildCommand?: string,
	lockfile?: Lockfile | null
): string {
	const pm = pmFromLockfile(lockfile)
	const install = installCommand ?? pm.install
	const build = buildCommand ?? config.buildCommand.replace('npm run', pm.run)

	const builderImage = isBun(lockfile) ? BUN_IMAGE : NODE_IMAGE

	const lines: string[] = [
		`# Build stage`,
		`FROM ${builderImage} AS builder`,
		'',
		'WORKDIR /app',
		'',
		installCommand ? 'COPY package.json ./' : pm.copyLine,
		`RUN ${install}`,
		'',
		'COPY . .',
		`RUN ${build}`,
		'',
		`# Runtime stage`,
		`FROM ${NODE_IMAGE}`,
		'',
		'WORKDIR /app',
		''
	];

	// Copy build output from builder
	for (const copyPath of config.copyPaths) {
		lines.push(`COPY --from=builder /app/${copyPath} ./${copyPath}`);
	}

	lines.push('', `EXPOSE ${port}`, '', `CMD [${shellToCmdArray(config.serveCommand)}]`, '');

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
