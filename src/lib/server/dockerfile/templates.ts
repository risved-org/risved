import type { FrameworkBuildConfig } from './types';

const DENO_IMAGE = 'denoland/deno:latest';
const NODE_IMAGE = 'node:22-slim';

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
	buildCommand?: string
): string {
	const install = installCommand ?? config.installCommand;
	const build = buildCommand ?? config.buildCommand;

	const lines: string[] = [
		`# Build stage`,
		`FROM ${NODE_IMAGE} AS builder`,
		'',
		'WORKDIR /app',
		'',
		'COPY package.json package-lock.json* ./',
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
	buildCommand?: string
): string {
	const install = installCommand ?? config.installCommand;
	const build = buildCommand ?? config.buildCommand;

	const lines: string[] = [
		`# Build stage`,
		`FROM ${NODE_IMAGE} AS builder`,
		'',
		'WORKDIR /app',
		'',
		'COPY package.json package-lock.json* ./',
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
