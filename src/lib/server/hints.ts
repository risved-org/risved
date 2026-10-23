export { hintsFromLogs } from './log-hints'
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

import { detectFramework } from '$lib/server/detection'
import type { DetectionContext, FrameworkResult } from '$lib/server/detection/types'

export type BuildHintSeverity = 'error' | 'warning'

export interface BuildHint {
	/** Stable machine id, e.g. `missing_adapter_node`. */
	code: string
	severity: BuildHintSeverity
	/** One sentence, no trailing period-and-a-half. */
	message: string
	/** Concrete action the agent can take. */
	fix?: string
	/** Path in the repo the hint is about. */
	file?: string
	docsUrl?: string
}

const LOCKFILES = [
	'bun.lockb',
	'bun.lock',
	'pnpm-lock.yaml',
	'yarn.lock',
	'package-lock.json'
] as const

interface PackageJson {
	scripts?: Record<string, string>
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}

function parsePackageJson(raw: string | null): PackageJson | null {
	if (!raw) return null
	try {
		return JSON.parse(raw) as PackageJson
	} catch {
		return null
	}
}

function hasDep(pkg: PackageJson | null, name: string): boolean {
	if (!pkg) return false
	return name in (pkg.dependencies ?? {}) || name in (pkg.devDependencies ?? {})
}

/** Read the first config file that exists from a candidate list. */
async function readFirst(
	ctx: DetectionContext,
	paths: string[]
): Promise<{ path: string; content: string } | null> {
	for (const path of paths) {
		const content = await ctx.readFile(path)
		if (content !== null) return { path, content }
	}
	return null
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
	const resolved = framework ?? (await detectFramework(ctx)).framework
	const hints: BuildHint[] = []

	const pkgRaw = await ctx.readFile('package.json')
	const pkg = parsePackageJson(pkgRaw)
	const hasDenoConfig = (await ctx.fileExists('deno.json')) || (await ctx.fileExists('deno.jsonc'))

	if (!pkgRaw && !hasDenoConfig) {
		hints.push({
			code: 'no_project_manifest',
			severity: 'error',
			message: 'No package.json or deno.json found in the repository root.',
			fix: 'Add a package.json at the repository root.'
		})
		return hints
	}

	if (pkgRaw && !pkg) {
		hints.push({
			code: 'invalid_package_json',
			severity: 'error',
			message: 'package.json is not valid JSON, so the build cannot read it.',
			fix: 'Fix the JSON syntax in package.json.',
			file: 'package.json'
		})
	}

	if (!resolved) {
		hints.push({
			code: 'framework_not_detected',
			severity: 'warning',
			message: 'No framework was detected, so the generic Node build will be used.',
			fix: 'Choose the framework in project settings, or add its configuration file.'
		})
	}

	if (pkg) {
		if (!pkg.scripts?.build && resolved?.id !== 'generic') {
			hints.push({
				code: 'missing_build_script',
				severity: 'error',
				message: 'package.json has no "build" script, but the image build expects a build script.',
				fix: 'Add a "build" script to package.json.',
				file: 'package.json'
			})
		}

		let hasLockfile = false
		for (const name of LOCKFILES) {
			if (await ctx.fileExists(name)) {
				hasLockfile = true
				break
			}
		}
		if (!hasLockfile) {
			hints.push({
				code: 'missing_lockfile',
				severity: 'warning',
				message: 'No lockfile found, so the build resolves fresh dependency versions each time.',
				fix: 'Commit a lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock).'
			})
		}
	}

	hints.push(...(await frameworkHints(ctx, resolved, pkg)))

	return hints
}

/** Framework-specific checks: the adapter/output settings the runtime image needs. */
async function frameworkHints(
	ctx: DetectionContext,
	framework: FrameworkResult | null,
	pkg: PackageJson | null
): Promise<BuildHint[]> {
	const hints: BuildHint[] = []

	switch (framework?.id) {
		case 'sveltekit': {
			/* The runtime image runs `node build/index.js`, which only exists with adapter-node. */
			if (!hasDep(pkg, '@sveltejs/adapter-node')) {
				hints.push({
					code: 'missing_adapter_node',
					severity: 'error',
					message:
						'SvelteKit needs @sveltejs/adapter-node — the container starts the build with `node build/index.js`.',
					fix: 'bun add -D @sveltejs/adapter-node',
					file: 'package.json',
					docsUrl: 'https://svelte.dev/docs/kit/adapter-node'
				})
			}
			const config = await readFirst(ctx, ['svelte.config.js', 'svelte.config.ts'])
			if (config && /adapter-auto/.test(config.content)) {
				hints.push({
					code: 'adapter_auto_configured',
					severity: 'error',
					message: 'svelte.config still imports adapter-auto, which produces no runnable server.',
					fix: "Import adapter from '@sveltejs/adapter-node' instead of '@sveltejs/adapter-auto'.",
					file: config.path,
					docsUrl: 'https://svelte.dev/docs/kit/adapter-node'
				})
			}
			break
		}

		case 'nextjs': {
			/* The runtime image copies .next/standalone and runs server.js. */
			const config = await readFirst(ctx, ['next.config.js', 'next.config.mjs', 'next.config.ts'])
			if (!config || !/output\s*:\s*['"]standalone['"]/.test(config.content)) {
				hints.push({
					code: 'missing_nextjs_standalone',
					severity: 'error',
					message:
						'Next.js must build in standalone mode — the container copies .next/standalone and runs server.js.',
					fix: "Set output: 'standalone' in next.config.js.",
					file: config?.path ?? 'next.config.js',
					docsUrl: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/output'
				})
			}
			break
		}

		case 'astro': {
			if (!hasDep(pkg, '@astrojs/node')) {
				hints.push({
					code: 'missing_astro_node_adapter',
					severity: 'error',
					message: 'Astro needs @astrojs/node — the container serves dist/server/entry.mjs.',
					fix: 'bunx astro add node',
					file: 'package.json',
					docsUrl: 'https://docs.astro.build/en/guides/integrations-guide/node/'
				})
			}
			const config = await readFirst(ctx, [
				'astro.config.mjs',
				'astro.config.js',
				'astro.config.ts'
			])
			if (config && !/output\s*:\s*['"](server|hybrid)['"]/.test(config.content)) {
				hints.push({
					code: 'astro_static_output',
					severity: 'warning',
					message: 'Astro is configured for static output, so no server entrypoint is emitted.',
					fix: "Set output: 'server' in the Astro config.",
					file: config.path,
					docsUrl: 'https://docs.astro.build/en/guides/on-demand-rendering/'
				})
			}
			break
		}

		case 'nuxt2': {
			if (!pkg?.scripts?.start && !(await ctx.fileExists('nuxt.config.js'))) {
				hints.push({
					code: 'missing_nuxt_config',
					severity: 'warning',
					message: 'No nuxt.config.js found, so the Nuxt 2 image may not find its srcDir.',
					fix: 'Commit nuxt.config.js at the repo root.'
				})
			}
			break
		}

		default:
			break
	}

	return hints
}
