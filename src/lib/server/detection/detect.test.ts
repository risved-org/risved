import { describe, it, expect } from 'vitest'
import { detectFramework } from './index'
import type { DetectionContext } from './types'

/** Helper to create an in-memory DetectionContext from a file map */
function mockContext(files: Record<string, string>): DetectionContext {
	return {
		async fileExists(path: string) {
			return path in files
		},
		async readFile(path: string) {
			return files[path] ?? null
		}
	}
}

describe('Framework Detection', () => {
	describe('SvelteKit', () => {
		it('detects SvelteKit with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'svelte.config.js': 'export default {};',
				'package.json': JSON.stringify({
					dependencies: { '@sveltejs/kit': '^2.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('sveltekit')
			expect(result.framework?.tier).toBe('node')
			expect(result.framework?.confidence).toBe('high')
		})

		it('detects SvelteKit with config only (medium confidence)', async () => {
			const ctx = mockContext({
				'svelte.config.js': 'export default {};',
				'package.json': JSON.stringify({ dependencies: {} })
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('sveltekit')
			expect(result.framework?.confidence).toBe('medium')
		})

		it('detects SvelteKit with svelte.config.ts', async () => {
			const ctx = mockContext({
				'svelte.config.ts': 'export default {};',
				'package.json': JSON.stringify({
					devDependencies: { '@sveltejs/kit': '^2.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('sveltekit')
			expect(result.framework?.confidence).toBe('high')
		})
	})

	describe('Astro', () => {
		it('detects Astro with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'astro.config.mjs': 'export default defineConfig({});',
				'package.json': JSON.stringify({
					dependencies: { astro: '^4.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('astro')
			expect(result.framework?.tier).toBe('node')
			expect(result.framework?.confidence).toBe('high')
		})

		it('detects Astro with astro.config.ts', async () => {
			const ctx = mockContext({
				'astro.config.ts': 'export default {};',
				'package.json': JSON.stringify({
					dependencies: { astro: '^4.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('astro')
		})
	})

	describe('Next.js', () => {
		it('detects Next.js with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'next.config.js': 'module.exports = {};',
				'package.json': JSON.stringify({
					dependencies: { next: '^14.0.0', react: '^18.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('nextjs')
			expect(result.framework?.tier).toBe('node')
			expect(result.framework?.confidence).toBe('high')
		})

		it('detects Next.js with next.config.mjs', async () => {
			const ctx = mockContext({
				'next.config.mjs': 'export default {};',
				'package.json': JSON.stringify({
					dependencies: { next: '^14.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('nextjs')
		})
	})

	describe('Nuxt', () => {
		it('detects Nuxt with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'nuxt.config.ts': 'export default defineNuxtConfig({});',
				'package.json': JSON.stringify({
					dependencies: { nuxt: '^3.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('nuxt')
			expect(result.framework?.tier).toBe('node')
			expect(result.framework?.confidence).toBe('high')
		})
	})

	describe('SolidStart', () => {
		it('detects SolidStart with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'app.config.ts': 'export default defineConfig({});',
				'package.json': JSON.stringify({
					dependencies: { '@solidjs/start': '^1.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('solidstart')
			expect(result.framework?.tier).toBe('node')
			expect(result.framework?.confidence).toBe('high')
		})
	})

	describe('TanStack Start', () => {
		it('detects TanStack Start with config + dependency (high confidence)', async () => {
			const ctx = mockContext({
				'app.config.ts': 'export default defineConfig({});',
				'package.json': JSON.stringify({
					dependencies: { '@tanstack/start': '^1.0.0', '@tanstack/react-router': '^1.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('tanstack-start')
			expect(result.framework?.tier).toBe('node')
			expect(result.framework?.confidence).toBe('high')
		})

		it('detects TanStack Start with dependency only (medium confidence)', async () => {
			const ctx = mockContext({
				'package.json': JSON.stringify({
					dependencies: { '@tanstack/start': '^1.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('tanstack-start')
			expect(result.framework?.confidence).toBe('medium')
		})

		it('prefers TanStack Start over SolidStart when both have app.config.ts', async () => {
			const ctx = mockContext({
				'app.config.ts': 'export default defineConfig({});',
				'package.json': JSON.stringify({
					dependencies: { '@tanstack/start': '^1.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.framework?.id).toBe('tanstack-start')
		})
	})

	describe('Priority ordering', () => {
		it('prefers SvelteKit over Hono when both detected', async () => {
			const ctx = mockContext({
				'svelte.config.js': 'export default {};',
				'package.json': JSON.stringify({
					dependencies: { '@sveltejs/kit': '^2.0.0', hono: '^4.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('sveltekit')
		})
	})

	describe('Generic fallback', () => {
		it('falls back to Generic (Node) for plain Node project', async () => {
			const ctx = mockContext({
				'package.json': JSON.stringify({
					dependencies: { express: '^4.0.0' }
				})
			})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('generic')
			expect(result.framework?.name).toBe('Generic (Node)')
			expect(result.framework?.tier).toBe('node')
			expect(result.framework?.confidence).toBe('low')
		})

		it('uses the package manifest even when another runtime config exists', async () => {
			const ctx = mockContext({
				'deno.json': JSON.stringify({ imports: {} }),
				'package.json': JSON.stringify({ dependencies: { express: '^4.0.0' } })
			})
			const result = await detectFramework(ctx)
			expect(result.framework?.id).toBe('generic')
			expect(result.framework?.tier).toBe('node')
		})
	})

	it('does not detect removed runtime-only projects', async () => {
		for (const files of [
			{ 'deno.json': '{}' },
			{ 'fresh.config.ts': 'export default {}' },
			{ '_config.ts': 'import lume from "lume/mod.ts"' }
		] as Record<string, string>[]) {
			expect((await detectFramework(mockContext(files))).detected).toBe(false)
		}
	})

	it('routes Hono package projects through the generic runtime', async () => {
		const result = await detectFramework(
			mockContext({
				'package.json': JSON.stringify({ dependencies: { hono: '^4.0.0' } })
			})
		)
		expect(result.framework).toMatchObject({ id: 'generic', tier: 'node' })
	})

	describe('No framework', () => {
		it('returns not detected for empty project', async () => {
			const ctx = mockContext({})
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(false)
			expect(result.framework).toBeNull()
		})
	})
})
