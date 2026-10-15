import type { FrameworkDetector, DetectionContext, Confidence, DetectorMatch } from './types'

/**
 * Check if a package.json contains a dependency (in deps or devDeps).
 * Returns null if package.json doesn't exist or can't be parsed.
 */
async function hasDependency(ctx: DetectionContext, pkg: string): Promise<boolean> {
	const content = await ctx.readFile('package.json')
	if (!content) return false

	try {
		const json = JSON.parse(content)
		const deps = json.dependencies ?? {}
		const devDeps = json.devDependencies ?? {}
		return pkg in deps || pkg in devDeps
	} catch {
		return false
	}
}

/**
 * SvelteKit: svelte.config.js + @sveltejs/kit in deps
 * Tier 3 — Node build, Node serve (adapter-node)
 */
const sveltekit: FrameworkDetector = {
	id: 'sveltekit',
	name: 'SvelteKit',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasConfig = await ctx.fileExists('svelte.config.js')
		const hasConfigTs = await ctx.fileExists('svelte.config.ts')
		const hasKit = await hasDependency(ctx, '@sveltejs/kit')

		if ((hasConfig || hasConfigTs) && hasKit) return 'high'
		if (hasConfig || hasConfigTs) return 'medium'
		if (hasKit) return 'medium'
		return null
	}
}

/**
 * Astro: astro.config.mjs + astro in deps
 * Node build and standalone Node server
 */
const astro: FrameworkDetector = {
	id: 'astro',
	name: 'Astro',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasConfig =
			(await ctx.fileExists('astro.config.mjs')) ||
			(await ctx.fileExists('astro.config.js')) ||
			(await ctx.fileExists('astro.config.ts'))
		const hasDep = await hasDependency(ctx, 'astro')

		if (hasConfig && hasDep) return 'high'
		if (hasConfig) return 'medium'
		if (hasDep) return 'medium'
		return null
	}
}

/**
 * Next.js: next.config.js/mjs + next in deps
 * Tier 3 — Node build, Node serve (Phase 2)
 */
const nextjs: FrameworkDetector = {
	id: 'nextjs',
	name: 'Next.js',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasConfig =
			(await ctx.fileExists('next.config.js')) ||
			(await ctx.fileExists('next.config.mjs')) ||
			(await ctx.fileExists('next.config.ts'))
		const hasDep = await hasDependency(ctx, 'next')

		if (hasConfig && hasDep) return 'high'
		if (hasConfig) return 'medium'
		if (hasDep) return 'medium'
		return null
	}
}

/**
 * Read the Nuxt major version from package.json.
 * Returns 2 or 3+ based on the version range string.
 */
async function getNuxtMajorVersion(ctx: DetectionContext): Promise<number | null> {
	const content = await ctx.readFile('package.json')
	if (!content) return null
	try {
		const json = JSON.parse(content)
		const version = json.dependencies?.nuxt ?? json.devDependencies?.nuxt ?? ''
		const match = version.match(/(\d+)/)
		if (!match) return null
		return parseInt(match[1], 10)
	} catch {
		return null
	}
}

/**
 * Extract srcDir from a Nuxt config file via regex.
 * Returns the directory path (e.g. 'src/') or null if not set / default.
 */
async function detectNuxtSrcDir(ctx: DetectionContext): Promise<string | null> {
	const configContent =
		(await ctx.readFile('nuxt.config.ts')) ?? (await ctx.readFile('nuxt.config.js'))
	if (!configContent) return null

	const match = configContent.match(/srcDir\s*:\s*['"`]([^'"`]+)['"`]/)
	if (!match) return null

	let srcDir = match[1]
	if (srcDir && !srcDir.endsWith('/')) srcDir += '/'
	return srcDir
}

/**
 * Nuxt 2: nuxt.config.js/ts + nuxt ^2.x in deps
 * Tier 3 — Node build (webpack), Node serve (nuxt start)
 */
const nuxt2: FrameworkDetector = {
	id: 'nuxt2',
	name: 'Nuxt 2',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | DetectorMatch | null> {
		const hasConfig =
			(await ctx.fileExists('nuxt.config.ts')) || (await ctx.fileExists('nuxt.config.js'))
		const hasDep = await hasDependency(ctx, 'nuxt')
		if (!hasConfig && !hasDep) return null

		const major = await getNuxtMajorVersion(ctx)
		if (major !== 2) return null

		const confidence: Confidence = hasConfig && hasDep ? 'high' : 'medium'
		const srcDir = await detectNuxtSrcDir(ctx)

		if (srcDir) {
			return { confidence, meta: { srcDir } }
		}
		return confidence
	}
}

/**
 * Nuxt 3+: nuxt.config.ts + nuxt ^3.x in deps
 * Tier 3 — Node build (Nitro), Node serve
 */
const nuxt: FrameworkDetector = {
	id: 'nuxt',
	name: 'Nuxt',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasConfig =
			(await ctx.fileExists('nuxt.config.ts')) || (await ctx.fileExists('nuxt.config.js'))
		const hasDep = await hasDependency(ctx, 'nuxt')

		if (!hasConfig && !hasDep) return null

		const major = await getNuxtMajorVersion(ctx)
		/* If we can read the version and it's 2, skip — nuxt2 detector handles it */
		if (major === 2) return null

		if (hasConfig && hasDep) return 'high'
		if (hasConfig) return 'medium'
		if (hasDep) return 'medium'
		return null
	}
}

/**
 * SolidStart: app.config.ts + @solidjs/start in deps
 * Tier 3 — Node build (Nitro), Node serve (Phase 2)
 */
const solidstart: FrameworkDetector = {
	id: 'solidstart',
	name: 'SolidStart',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasConfig =
			(await ctx.fileExists('app.config.ts')) || (await ctx.fileExists('app.config.js'))
		const hasDep = await hasDependency(ctx, '@solidjs/start')

		if (hasConfig && hasDep) return 'high'
		if (hasDep) return 'medium'
		return null
	}
}

/**
 * TanStack Start: app.config.ts + @tanstack/start in deps
 * Tier 3 — Node build (Vinxi/Nitro), Node serve
 */
const tanstackStart: FrameworkDetector = {
	id: 'tanstack-start',
	name: 'TanStack Start',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasDep = await hasDependency(ctx, '@tanstack/start')
		const hasConfig =
			(await ctx.fileExists('app.config.ts')) || (await ctx.fileExists('app.config.js'))

		if (hasConfig && hasDep) return 'high'
		if (hasDep) return 'medium'
		return null
	}
}

/**
 * Detection order: most specific first.
 * TanStack Start before SolidStart because both use app.config.ts
 * but TanStack Start has a more specific dependency.
 */
export const detectors: FrameworkDetector[] = [
	sveltekit,
	astro,
	nextjs,
	nuxt2,
	nuxt,
	tanstackStart,
	solidstart
]
