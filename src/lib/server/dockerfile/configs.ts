import type { FrameworkBuildConfig, FrameworkConfigs } from './types'

/**
 * Framework-specific build configurations.
 * Each config encodes the build/serve strategy for its framework.
 */
export const frameworkConfigs: FrameworkConfigs = {
	sveltekit: {
		outputDir: 'build',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node build/index.js',
		copyPaths: ['build', 'package.json', 'node_modules']
	},

	astro: {
		outputDir: 'dist',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node dist/server/entry.mjs',
		runtimeEnv: { HOST: '0.0.0.0', PORT: '3000' },
		copyPaths: ['dist', 'package.json', 'node_modules']
	},

	nextjs: {
		outputDir: '.next',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node server.js',
		copyPaths: ['.next/standalone', '.next/static', 'public']
	},

	nuxt2: {
		outputDir: '.nuxt',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node_modules/.bin/nuxt start',
		copyPaths: ['.nuxt', 'package.json', 'node_modules', 'nuxt.config.*', 'static']
	},

	nuxt: {
		outputDir: '.output',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node .output/server/index.mjs',
		copyPaths: ['.output']
	},

	solidstart: {
		outputDir: '.output',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node .output/server/index.mjs',
		copyPaths: ['.output']
	},

	'tanstack-start': {
		outputDir: '.output',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node .output/server/index.mjs',
		copyPaths: ['.output']
	},

	generic: {
		outputDir: '.',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node index.js',
		copyPaths: ['.']
	}
}

export function getFrameworkConfig(frameworkId: string): FrameworkBuildConfig {
	const config = frameworkConfigs[frameworkId as keyof typeof frameworkConfigs]
	if (!config) {
		throw new Error(`Unknown framework: ${frameworkId}`)
	}
	return config
}
