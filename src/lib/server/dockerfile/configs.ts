import type { FrameworkBuildConfig, FrameworkConfigs } from './types';

/**
 * Framework-specific build configurations.
 * Each config encodes the build/serve strategy for its framework.
 */
export const frameworkConfigs: FrameworkConfigs = {
	fresh: {
		outputDir: '.',
		buildCommand: '',
		installCommand: 'deno cache main.ts',
		serveCommand: 'deno run --allow-all main.ts',
		copyPaths: ['.'],
		denoPermissions: '--allow-all'
	},

	hono: {
		outputDir: '.',
		buildCommand: '',
		installCommand: 'deno cache main.ts',
		serveCommand: 'deno run --allow-all main.ts',
		copyPaths: ['.'],
		denoPermissions: '--allow-all'
	},

	lume: {
		outputDir: '_site',
		buildCommand: 'deno task build',
		installCommand: 'deno cache _config.ts',
		serveCommand: 'deno run --allow-all --allow-read=. https://deno.land/std/http/file_server.ts _site -p 8000',
		copyPaths: ['_site'],
		denoPermissions: '--allow-all'
	},

	sveltekit: {
		outputDir: 'build',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'deno run --allow-all build/index.js',
		copyPaths: ['build', 'package.json']
	},

	astro: {
		outputDir: 'dist',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'deno run --allow-all dist/server/entry.mjs',
		copyPaths: ['dist', 'package.json']
	},

	nextjs: {
		outputDir: '.next',
		buildCommand: 'npm run build',
		installCommand: 'npm ci',
		serveCommand: 'node server.js',
		copyPaths: ['.next/standalone', '.next/static', 'public']
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
};

export function getFrameworkConfig(frameworkId: string): FrameworkBuildConfig {
	const config = frameworkConfigs[frameworkId as keyof typeof frameworkConfigs];
	if (!config) {
		throw new Error(`Unknown framework: ${frameworkId}`);
	}
	return config;
}
