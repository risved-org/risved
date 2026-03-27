import type { FrameworkDetector, DetectionContext, Confidence } from './types';

/**
 * Check if a package.json contains a dependency (in deps or devDeps).
 * Returns null if package.json doesn't exist or can't be parsed.
 */
async function hasDependency(ctx: DetectionContext, pkg: string): Promise<boolean> {
	const content = await ctx.readFile('package.json');
	if (!content) return false;

	try {
		const json = JSON.parse(content);
		const deps = json.dependencies ?? {};
		const devDeps = json.devDependencies ?? {};
		return pkg in deps || pkg in devDeps;
	} catch {
		return false;
	}
}

/**
 * Parse deno.json or deno.jsonc imports/dependencies.
 * Returns the parsed JSON or null.
 */
async function readDenoConfig(ctx: DetectionContext): Promise<Record<string, unknown> | null> {
	const content = (await ctx.readFile('deno.json')) ?? (await ctx.readFile('deno.jsonc'));
	if (!content) return null;

	try {
		return JSON.parse(content);
	} catch {
		return null;
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
		const hasConfig = await ctx.fileExists('svelte.config.js');
		const hasConfigTs = await ctx.fileExists('svelte.config.ts');
		const hasKit = await hasDependency(ctx, '@sveltejs/kit');

		if ((hasConfig || hasConfigTs) && hasKit) return 'high';
		if (hasConfig || hasConfigTs) return 'medium';
		if (hasKit) return 'medium';
		return null;
	}
};

/**
 * Fresh: fresh.config.ts or Fresh imports in deno.json
 * Tier 1 — Pure Deno
 */
const fresh: FrameworkDetector = {
	id: 'fresh',
	name: 'Fresh',
	tier: 'deno',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasFreshConfig =
			(await ctx.fileExists('fresh.config.ts')) || (await ctx.fileExists('fresh.config.js'));
		if (hasFreshConfig) return 'high';

		const denoConfig = await readDenoConfig(ctx);
		if (!denoConfig) return null;

		const imports = (denoConfig.imports ?? {}) as Record<string, string>;
		const hasFreshImport = Object.keys(imports).some(
			(key) => key.startsWith('$fresh') || key.startsWith('fresh/')
		);
		const hasFreshDep = Object.values(imports).some(
			(val) => typeof val === 'string' && val.includes('fresh')
		);

		if (hasFreshImport || hasFreshDep) return 'high';
		return null;
	}
};

/**
 * Astro: astro.config.mjs + astro in deps
 * Tier 2 — Node build, Deno serve
 */
const astro: FrameworkDetector = {
	id: 'astro',
	name: 'Astro',
	tier: 'hybrid',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasConfig =
			(await ctx.fileExists('astro.config.mjs')) ||
			(await ctx.fileExists('astro.config.js')) ||
			(await ctx.fileExists('astro.config.ts'));
		const hasDep = await hasDependency(ctx, 'astro');

		if (hasConfig && hasDep) return 'high';
		if (hasConfig) return 'medium';
		if (hasDep) return 'medium';
		return null;
	}
};

/**
 * Hono: hono import in entrypoint + deno.json present
 * Tier 1 — Pure Deno
 */
const hono: FrameworkDetector = {
	id: 'hono',
	name: 'Hono',
	tier: 'deno',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasDep = await hasDependency(ctx, 'hono');
		if (hasDep) return 'high';

		const denoConfig = await readDenoConfig(ctx);
		if (!denoConfig) return null;

		const imports = (denoConfig.imports ?? {}) as Record<string, string>;
		const hasHonoImport = Object.keys(imports).some((key) => key.startsWith('hono'));
		const hasHonoDep = Object.values(imports).some(
			(val) => typeof val === 'string' && val.includes('hono')
		);

		if (hasHonoImport || hasHonoDep) return 'high';

		// Check common entrypoints for hono imports
		for (const entry of ['main.ts', 'main.tsx', 'src/index.ts', 'src/index.tsx', 'index.ts']) {
			const content = await ctx.readFile(entry);
			if (content && /from\s+['"]hono['"]/.test(content)) return 'medium';
		}

		return null;
	}
};

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
			(await ctx.fileExists('next.config.ts'));
		const hasDep = await hasDependency(ctx, 'next');

		if (hasConfig && hasDep) return 'high';
		if (hasConfig) return 'medium';
		if (hasDep) return 'medium';
		return null;
	}
};

/**
 * Nuxt: nuxt.config.ts + nuxt in deps
 * Tier 3 — Node build (Nitro), Node serve (Phase 2)
 */
const nuxt: FrameworkDetector = {
	id: 'nuxt',
	name: 'Nuxt',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasConfig =
			(await ctx.fileExists('nuxt.config.ts')) || (await ctx.fileExists('nuxt.config.js'));
		const hasDep = await hasDependency(ctx, 'nuxt');

		if (hasConfig && hasDep) return 'high';
		if (hasConfig) return 'medium';
		if (hasDep) return 'medium';
		return null;
	}
};

/**
 * Lume: _config.ts with Lume imports
 * Tier 1 — Pure Deno, static output (Phase 2)
 */
const lume: FrameworkDetector = {
	id: 'lume',
	name: 'Lume',
	tier: 'deno',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		for (const configFile of ['_config.ts', '_config.js']) {
			const content = await ctx.readFile(configFile);
			if (content && /from\s+['"]lume/.test(content)) return 'high';
			if (content) return 'low';
		}
		return null;
	}
};

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
			(await ctx.fileExists('app.config.ts')) || (await ctx.fileExists('app.config.js'));
		const hasDep = await hasDependency(ctx, '@solidjs/start');

		if (hasConfig && hasDep) return 'high';
		if (hasDep) return 'medium';
		return null;
	}
};

/**
 * TanStack Start: app.config.ts + @tanstack/start in deps
 * Tier 3 — Node build (Vinxi/Nitro), Node serve
 */
const tanstackStart: FrameworkDetector = {
	id: 'tanstack-start',
	name: 'TanStack Start',
	tier: 'node',
	async detect(ctx: DetectionContext): Promise<Confidence | null> {
		const hasDep = await hasDependency(ctx, '@tanstack/start');
		const hasConfig =
			(await ctx.fileExists('app.config.ts')) || (await ctx.fileExists('app.config.js'));

		if (hasConfig && hasDep) return 'high';
		if (hasDep) return 'medium';
		return null;
	}
};

/**
 * Detection order: most specific first.
 * SvelteKit and Fresh are checked before Hono because
 * SvelteKit projects may also have hono as a dependency,
 * and Fresh projects always have a deno.json.
 * TanStack Start before SolidStart because both use app.config.ts
 * but TanStack Start has a more specific dependency.
 */
export const detectors: FrameworkDetector[] = [
	sveltekit,
	fresh,
	astro,
	nextjs,
	nuxt,
	tanstackStart,
	solidstart,
	lume,
	hono
];
