import type { FrameworkDetector } from './types'
import { hasDependency } from './dependencies'

/** Recognize current React/Solid Start projects and legacy Vinxi projects. */
export const tanstackStart: FrameworkDetector = {
	id: 'tanstack-start',
	name: 'TanStack Start',
	tier: 'node',
	async detect(ctx) {
		const modern =
			(await hasDependency(ctx, '@tanstack/react-start')) ||
			(await hasDependency(ctx, '@tanstack/solid-start'))
		const legacy = await hasDependency(ctx, '@tanstack/start')
		if (!modern && !legacy) return null
		const names = modern
			? ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']
			: ['app.config.ts', 'app.config.js']
		for (const name of names) {
			if (await ctx.fileExists(name)) return 'high'
		}
		return 'medium'
	}
}

/** Detect framework mode without misclassifying apps using only React Router. */
export const reactRouter: FrameworkDetector = {
	id: 'react-router',
	name: 'React Router',
	tier: 'node',
	async detect(ctx) {
		if (!(await hasDependency(ctx, '@react-router/dev'))) return null
		return (await ctx.fileExists('react-router.config.ts')) ||
			(await ctx.fileExists('react-router.config.js'))
			? 'high'
			: 'medium'
	}
}

/** Adonis builds a standalone application with its own package manifest. */
export const adonis: FrameworkDetector = {
	id: 'adonisjs',
	name: 'AdonisJS',
	tier: 'node',
	async detect(ctx) {
		if (!(await hasDependency(ctx, '@adonisjs/core'))) return null
		return (await ctx.fileExists('adonisrc.ts')) || (await ctx.fileExists('adonisrc.js'))
			? 'high'
			: 'medium'
	}
}

/** Check Elysia last so full-stack applications embedding an API keep their framework. */
export const elysia: FrameworkDetector = {
	id: 'elysia',
	name: 'Elysia',
	tier: 'node',
	async detect(ctx) {
		return (await hasDependency(ctx, 'elysia')) ? 'high' : null
	}
}
