import { describe, it, expect } from 'vitest';
import { detectFramework } from './index';
import type { DetectionContext } from './types';

/** Helper to create an in-memory DetectionContext from a file map */
function mockContext(files: Record<string, string>): DetectionContext {
	return {
		async fileExists(path: string) {
			return path in files;
		},
		async readFile(path: string) {
			return files[path] ?? null;
		}
	};
}

describe('Framework Detection', () => {
	describe('SvelteKit', () => {
		it('detects SvelteKit with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'svelte.config.js': 'export default {};',
				'package.json': JSON.stringify({
					dependencies: { '@sveltejs/kit': '^2.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('sveltekit');
			expect(result.framework?.tier).toBe('hybrid');
			expect(result.framework?.confidence).toBe('high');
		});

		it('detects SvelteKit with config only (medium confidence)', async () => {
			const ctx = mockContext({
				'svelte.config.js': 'export default {};',
				'package.json': JSON.stringify({ dependencies: {} })
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('sveltekit');
			expect(result.framework?.confidence).toBe('medium');
		});

		it('detects SvelteKit with svelte.config.ts', async () => {
			const ctx = mockContext({
				'svelte.config.ts': 'export default {};',
				'package.json': JSON.stringify({
					devDependencies: { '@sveltejs/kit': '^2.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('sveltekit');
			expect(result.framework?.confidence).toBe('high');
		});
	});

	describe('Fresh', () => {
		it('detects Fresh with fresh.config.ts (high confidence)', async () => {
			const ctx = mockContext({
				'fresh.config.ts': 'export default defineConfig({});'
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('fresh');
			expect(result.framework?.tier).toBe('deno');
			expect(result.framework?.confidence).toBe('high');
		});

		it('detects Fresh via deno.json imports (high confidence)', async () => {
			const ctx = mockContext({
				'deno.json': JSON.stringify({
					imports: {
						'$fresh/': 'https://deno.land/x/fresh@1.6.0/'
					}
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('fresh');
			expect(result.framework?.confidence).toBe('high');
		});
	});

	describe('Astro', () => {
		it('detects Astro with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'astro.config.mjs': 'export default defineConfig({});',
				'package.json': JSON.stringify({
					dependencies: { astro: '^4.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('astro');
			expect(result.framework?.tier).toBe('hybrid');
			expect(result.framework?.confidence).toBe('high');
		});

		it('detects Astro with astro.config.ts', async () => {
			const ctx = mockContext({
				'astro.config.ts': 'export default {};',
				'package.json': JSON.stringify({
					dependencies: { astro: '^4.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('astro');
		});
	});

	describe('Hono', () => {
		it('detects Hono via package.json dependency (high confidence)', async () => {
			const ctx = mockContext({
				'package.json': JSON.stringify({
					dependencies: { hono: '^4.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('hono');
			expect(result.framework?.tier).toBe('deno');
			expect(result.framework?.confidence).toBe('high');
		});

		it('detects Hono via deno.json imports (high confidence)', async () => {
			const ctx = mockContext({
				'deno.json': JSON.stringify({
					imports: {
						hono: 'npm:hono@^4.0.0'
					}
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('hono');
			expect(result.framework?.confidence).toBe('high');
		});

		it('detects Hono via entrypoint import (medium confidence)', async () => {
			const ctx = mockContext({
				'deno.json': JSON.stringify({ imports: {} }),
				'main.ts': `import { Hono } from 'hono';\nconst app = new Hono();`
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('hono');
			expect(result.framework?.confidence).toBe('medium');
		});
	});

	describe('Next.js', () => {
		it('detects Next.js with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'next.config.js': 'module.exports = {};',
				'package.json': JSON.stringify({
					dependencies: { next: '^14.0.0', react: '^18.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('nextjs');
			expect(result.framework?.tier).toBe('node');
			expect(result.framework?.confidence).toBe('high');
		});

		it('detects Next.js with next.config.mjs', async () => {
			const ctx = mockContext({
				'next.config.mjs': 'export default {};',
				'package.json': JSON.stringify({
					dependencies: { next: '^14.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('nextjs');
		});
	});

	describe('Nuxt', () => {
		it('detects Nuxt with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'nuxt.config.ts': 'export default defineNuxtConfig({});',
				'package.json': JSON.stringify({
					dependencies: { nuxt: '^3.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('nuxt');
			expect(result.framework?.tier).toBe('node');
			expect(result.framework?.confidence).toBe('high');
		});
	});

	describe('Lume', () => {
		it('detects Lume with _config.ts + lume import (high confidence)', async () => {
			const ctx = mockContext({
				'_config.ts': `import lume from "lume/mod.ts";\nconst site = lume();`
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('lume');
			expect(result.framework?.tier).toBe('deno');
			expect(result.framework?.confidence).toBe('high');
		});

		it('detects Lume _config.ts without import (low confidence)', async () => {
			const ctx = mockContext({
				'_config.ts': 'export default {};'
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('lume');
			expect(result.framework?.confidence).toBe('low');
		});
	});

	describe('SolidStart', () => {
		it('detects SolidStart with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'app.config.ts': 'export default defineConfig({});',
				'package.json': JSON.stringify({
					dependencies: { '@solidjs/start': '^1.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('solidstart');
			expect(result.framework?.tier).toBe('node');
			expect(result.framework?.confidence).toBe('high');
		});
	});

	describe('TanStack Start', () => {
		it('detects TanStack Start with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'app.config.ts': 'export default defineConfig({});',
				'package.json': JSON.stringify({
					dependencies: { '@tanstack/start': '^1.0.0', '@tanstack/react-router': '^1.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('tanstack-start');
			expect(result.framework?.tier).toBe('node');
			expect(result.framework?.confidence).toBe('high');
		});

		it('detects TanStack Start with dependency only (medium confidence)', async () => {
			const ctx = mockContext({
				'package.json': JSON.stringify({
					dependencies: { '@tanstack/start': '^1.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('tanstack-start');
			expect(result.framework?.confidence).toBe('medium');
		});

		it('prefers TanStack Start over SolidStart when both have app.config.ts', async () => {
			const ctx = mockContext({
				'app.config.ts': 'export default defineConfig({});',
				'package.json': JSON.stringify({
					dependencies: { '@tanstack/start': '^1.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.framework?.id).toBe('tanstack-start');
		});
	});

	describe('Priority ordering', () => {
		it('prefers SvelteKit over Hono when both detected', async () => {
			const ctx = mockContext({
				'svelte.config.js': 'export default {};',
				'package.json': JSON.stringify({
					dependencies: { '@sveltejs/kit': '^2.0.0', hono: '^4.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('sveltekit');
		});

		it('prefers Fresh over Hono when both in deno.json', async () => {
			const ctx = mockContext({
				'fresh.config.ts': 'export default {};',
				'deno.json': JSON.stringify({
					imports: { hono: 'npm:hono@^4.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('fresh');
		});
	});

	describe('Generic fallback', () => {
		it('falls back to Generic (Node) for plain Node project', async () => {
			const ctx = mockContext({
				'package.json': JSON.stringify({
					dependencies: { express: '^4.0.0' }
				})
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('generic');
			expect(result.framework?.name).toBe('Generic (Node)');
			expect(result.framework?.tier).toBe('node');
			expect(result.framework?.confidence).toBe('low');
		});

		it('falls back to Generic (Deno) for plain Deno project', async () => {
			const ctx = mockContext({
				'deno.json': JSON.stringify({ imports: {} })
			});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(true);
			expect(result.framework?.id).toBe('generic');
			expect(result.framework?.name).toBe('Generic (Deno)');
			expect(result.framework?.tier).toBe('deno');
			expect(result.framework?.confidence).toBe('low');
		});

		it('prefers Deno over Node when deno.json exists', async () => {
			const ctx = mockContext({
				'deno.json': JSON.stringify({ imports: {} }),
				'package.json': JSON.stringify({ dependencies: { express: '^4.0.0' } })
			});
			const result = await detectFramework(ctx);
			expect(result.framework?.id).toBe('generic');
			expect(result.framework?.tier).toBe('deno');
		});
	});

	describe('No framework', () => {
		it('returns not detected for empty project', async () => {
			const ctx = mockContext({});
			const result = await detectFramework(ctx);
			expect(result.detected).toBe(false);
			expect(result.framework).toBeNull();
		});
	});
});
