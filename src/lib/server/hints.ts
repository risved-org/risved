/**
 * Build hints — structured, machine-actionable diagnostics about a project's
 * deploy configuration.
 *
 * Two producers, one shape:
 *   • `inspectRepoConfig` runs before the first build, against the repo tree,
 *     and catches the config mistakes that make the pipeline fail later.
 *   • `hintsFromLogs` reads a finished deployment's build output and turns the
 *     failure into the same structured form.
 *
 * Agents act on `code` and `fix`; humans read `message`. Keep codes stable —
 * they are part of the MCP contract.
 */

import { detectFramework } from '$lib/server/detection';
import type { DetectionContext, FrameworkResult } from '$lib/server/detection/types';

export type BuildHintSeverity = 'error' | 'warning';

export interface BuildHint {
	/** Stable machine id, e.g. `missing_adapter_node`. */
	code: string;
	severity: BuildHintSeverity;
	/** One sentence, no trailing period-and-a-half. */
	message: string;
	/** Concrete action the agent can take. */
	fix?: string;
	/** Path in the repo the hint is about. */
	file?: string;
	docsUrl?: string;
}

const LOCKFILES = [
	'bun.lockb',
	'bun.lock',
	'pnpm-lock.yaml',
	'yarn.lock',
	'package-lock.json'
] as const;

interface PackageJson {
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

function parsePackageJson(raw: string | null): PackageJson | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PackageJson;
	} catch {
		return null;
	}
}

function hasDep(pkg: PackageJson | null, name: string): boolean {
	if (!pkg) return false;
	return name in (pkg.dependencies ?? {}) || name in (pkg.devDependencies ?? {});
}

/** Read the first config file that exists from a candidate list. */
async function readFirst(
	ctx: DetectionContext,
	paths: string[]
): Promise<{ path: string; content: string } | null> {
	for (const path of paths) {
		const content = await ctx.readFile(path);
		if (content !== null) return { path, content };
	}
	return null;
}

/**
 * Inspect a repository's deploy configuration and return everything that will
 * bite before or during the first build.
 *
 * `ctx` reads the repo — over the Git provider API for a repo that has not been
 * cloned yet, or off disk via `createFsContext` for one that has.
 */
export async function inspectRepoConfig(
	ctx: DetectionContext,
	framework?: FrameworkResult | null
): Promise<BuildHint[]> {
	const resolved = framework ?? (await detectFramework(ctx)).framework;
	const hints: BuildHint[] = [];

	const pkgRaw = await ctx.readFile('package.json');
	const pkg = parsePackageJson(pkgRaw);
	const hasDenoConfig = (await ctx.fileExists('deno.json')) || (await ctx.fileExists('deno.jsonc'));

	if (!pkgRaw && !hasDenoConfig) {
		hints.push({
			code: 'no_project_manifest',
			severity: 'error',
			message: 'No package.json or deno.json found in the repository root.',
			fix: 'Add a package.json at the repo root, or set rootDir to the subdirectory that holds it.'
		});
		return hints;
	}

	if (pkgRaw && !pkg) {
		hints.push({
			code: 'invalid_package_json',
			severity: 'error',
			message: 'package.json is not valid JSON, so the build cannot read it.',
			fix: 'Fix the JSON syntax in package.json.',
			file: 'package.json'
		});
	}

	if (!resolved) {
		hints.push({
			code: 'framework_not_detected',
			severity: 'warning',
			message: 'No framework was detected, so the generic Node build will be used.',
			fix: 'Pass frameworkId explicitly, or add the framework config file the detector looks for.'
		});
	}

	const tier = resolved?.tier ?? 'node';

	if (tier !== 'deno' && pkg) {
		if (!pkg.scripts?.build && resolved?.id !== 'generic') {
			hints.push({
				code: 'missing_build_script',
				severity: 'error',
				message: 'package.json has no "build" script, but the image build runs `npm run build`.',
				fix: 'Add a "build" script to package.json.',
				file: 'package.json'
			});
		}

		let hasLockfile = false;
		for (const name of LOCKFILES) {
			if (await ctx.fileExists(name)) {
				hasLockfile = true;
				break;
			}
		}
		if (!hasLockfile) {
			hints.push({
				code: 'missing_lockfile',
				severity: 'warning',
				message: 'No lockfile found, so the build resolves fresh dependency versions each time.',
				fix: 'Commit a lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock).'
			});
		}
	}

	hints.push(...(await frameworkHints(ctx, resolved, pkg)));

	return hints;
}

/** Framework-specific checks: the adapter/output settings the runtime image needs. */
async function frameworkHints(
	ctx: DetectionContext,
	framework: FrameworkResult | null,
	pkg: PackageJson | null
): Promise<BuildHint[]> {
	const hints: BuildHint[] = [];

	switch (framework?.id) {
		case 'sveltekit': {
			/* The runtime image runs `node build/index.js`, which only exists with adapter-node. */
			if (!hasDep(pkg, '@sveltejs/adapter-node')) {
				hints.push({
					code: 'missing_adapter_node',
					severity: 'error',
					message:
						'SvelteKit needs @sveltejs/adapter-node — the container starts the build with `node build/index.js`.',
					fix: 'npm i -D @sveltejs/adapter-node',
					file: 'package.json',
					docsUrl: 'https://svelte.dev/docs/kit/adapter-node'
				});
			}
			const config = await readFirst(ctx, ['svelte.config.js', 'svelte.config.ts']);
			if (config && /adapter-auto/.test(config.content)) {
				hints.push({
					code: 'adapter_auto_configured',
					severity: 'error',
					message: 'svelte.config still imports adapter-auto, which produces no runnable server.',
					fix: "Import adapter from '@sveltejs/adapter-node' instead of '@sveltejs/adapter-auto'.",
					file: config.path,
					docsUrl: 'https://svelte.dev/docs/kit/adapter-node'
				});
			}
			break;
		}

		case 'nextjs': {
			/* The runtime image copies .next/standalone and runs server.js. */
			const config = await readFirst(ctx, ['next.config.js', 'next.config.mjs', 'next.config.ts']);
			if (!config || !/output\s*:\s*['"]standalone['"]/.test(config.content)) {
				hints.push({
					code: 'missing_nextjs_standalone',
					severity: 'error',
					message:
						'Next.js must build in standalone mode — the container copies .next/standalone and runs server.js.',
					fix: "Set output: 'standalone' in next.config.js.",
					file: config?.path ?? 'next.config.js',
					docsUrl: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/output'
				});
			}
			break;
		}

		case 'astro': {
			if (!hasDep(pkg, '@astrojs/node')) {
				hints.push({
					code: 'missing_astro_node_adapter',
					severity: 'error',
					message: 'Astro needs @astrojs/node — the container serves dist/server/entry.mjs.',
					fix: 'npx astro add node',
					file: 'package.json',
					docsUrl: 'https://docs.astro.build/en/guides/integrations-guide/node/'
				});
			}
			const config = await readFirst(ctx, [
				'astro.config.mjs',
				'astro.config.js',
				'astro.config.ts'
			]);
			if (config && !/output\s*:\s*['"](server|hybrid)['"]/.test(config.content)) {
				hints.push({
					code: 'astro_static_output',
					severity: 'warning',
					message: 'Astro is configured for static output, so no server entrypoint is emitted.',
					fix: "Set output: 'server' in the Astro config.",
					file: config.path,
					docsUrl: 'https://docs.astro.build/en/guides/on-demand-rendering/'
				});
			}
			break;
		}

		case 'nuxt2': {
			if (!pkg?.scripts?.start && !(await ctx.fileExists('nuxt.config.js'))) {
				hints.push({
					code: 'missing_nuxt_config',
					severity: 'warning',
					message: 'No nuxt.config.js found, so the Nuxt 2 image may not find its srcDir.',
					fix: 'Commit nuxt.config.js at the repo root.'
				});
			}
			break;
		}

		default:
			break;
	}

	return hints;
}

/** A build-log pattern and the hint it maps to. */
interface LogPattern {
	pattern: RegExp;
	hint: Omit<BuildHint, 'severity'> & { severity?: BuildHintSeverity };
}

const LOG_PATTERNS: LogPattern[] = [
	{
		pattern: /Cannot find module ['"]?\/app\/build\/index\.js|build\/index\.js.*not found/i,
		hint: {
			code: 'missing_adapter_node',
			message: 'The container could not find build/index.js, which adapter-node produces.',
			fix: 'npm i -D @sveltejs/adapter-node and use it in svelte.config.js',
			docsUrl: 'https://svelte.dev/docs/kit/adapter-node'
		}
	},
	{
		pattern: /\.next\/standalone.*(no such file|not found)|Cannot find module.*server\.js/i,
		hint: {
			code: 'missing_nextjs_standalone',
			message: 'The Next.js standalone output is missing, so the container has no server.js.',
			fix: "Set output: 'standalone' in next.config.js.",
			file: 'next.config.js'
		}
	},
	{
		pattern: /npm ci.*can only install packages when.*lock|npm ERR!.*package-lock\.json/i,
		hint: {
			code: 'missing_lockfile',
			message: '`npm ci` needs a lockfile that matches package.json.',
			fix: 'Run npm install and commit the updated package-lock.json.'
		}
	},
	{
		pattern: /missing script:\s*build|npm ERR! Missing script: "build"/i,
		hint: {
			code: 'missing_build_script',
			message: 'The build failed because package.json has no "build" script.',
			fix: 'Add a "build" script to package.json.',
			file: 'package.json'
		}
	},
	{
		pattern: /error TS\d+|Type error:/,
		hint: {
			code: 'typescript_error',
			message: 'The build failed on a TypeScript error.',
			fix: 'Fix the reported type error, or relax the check that rejects it.'
		}
	},
	{
		pattern: /JavaScript heap out of memory|Killed\s*$|exit code 137/i,
		hint: {
			code: 'build_out_of_memory',
			message: 'The build process ran out of memory and was killed.',
			fix: 'Raise NODE_OPTIONS=--max-old-space-size, or trim the build.'
		}
	},
	{
		pattern: /Health check timed out/i,
		hint: {
			code: 'health_check_timeout',
			message: 'The container started but never answered the health check.',
			fix: 'Listen on 0.0.0.0 and the PORT environment variable, and serve 200 on /.'
		}
	},
	{
		pattern: /Authentication failed|could not read Username|Permission denied \(publickey\)/i,
		hint: {
			code: 'git_auth_failed',
			message: 'The repository could not be cloned with the stored credentials.',
			fix: 'Reconnect the Git provider under Settings → Git, or add the deploy key to the repo.'
		}
	},
	{
		pattern: /EADDRINUSE|address already in use/i,
		hint: {
			code: 'port_in_use',
			message: 'The app tried to bind a port that is already taken inside the container.',
			fix: 'Bind the PORT environment variable rather than a hard-coded port.'
		}
	},
	{
		pattern: /release command failed|release exited with code [1-9]/i,
		hint: {
			code: 'release_command_failed',
			message: 'The release command failed, so traffic was never switched over.',
			fix: 'Run the release command locally against the same database and fix what it reports.'
		}
	}
];

/**
 * Derive hints from a deployment's build output.
 *
 * Only error/warn lines are scanned: an informational line that happens to
 * contain "error" in a filename should not raise a hint. Each code appears at
 * most once.
 */
export function hintsFromLogs(logs: Array<{ level: string; message: string }>): BuildHint[] {
	const relevant = logs.filter((l) => l.level === 'error' || l.level === 'warn');
	if (relevant.length === 0) return [];

	const text = relevant.map((l) => l.message).join('\n');
	const seen = new Set<string>();
	const hints: BuildHint[] = [];

	for (const { pattern, hint } of LOG_PATTERNS) {
		if (seen.has(hint.code)) continue;
		if (!pattern.test(text)) continue;
		seen.add(hint.code);
		hints.push({ severity: 'error', ...hint });
	}

	return hints;
}
