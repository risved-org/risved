import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig, type Plugin } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * Vite plugin that rewrites bare Node built-in imports to use the node: prefix.
 * Required for Deno compatibility — some npm packages import e.g. "zlib" instead of "node:zlib".
 */
const NODE_BUILTINS = [
	'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
	'events', 'fs', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks',
	'process', 'querystring', 'readline', 'stream', 'string_decoder', 'timers',
	'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
	'punycode', 'constants', 'module', 'sys', 'async_hooks', 'diagnostics_channel',
	'inspector', 'trace_events', 'wasi'
]

function denoNodePrefix(): Plugin {
	return {
		name: 'deno-node-prefix',
		enforce: 'pre',
		resolveId(source) {
			if (NODE_BUILTINS.includes(source)) {
				return { id: `node:${source}`, external: true }
			}
		},
		closeBundle: {
			sequential: true,
			order: 'post',
			async handler() {
				const { readdir, readFile, writeFile } = await import('node:fs/promises')
				const { join } = await import('node:path')

				async function fixDir(dir: string) {
					let entries
					try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
					for (const entry of entries) {
						const full = join(dir, entry.name)
						if (entry.isDirectory()) {
							await fixDir(full)
						} else if (entry.name.endsWith('.js')) {
							let code = await readFile(full, 'utf8')
							let changed = false
							for (const mod of NODE_BUILTINS) {
								const patterns = [
									[`from '${mod}'`, `from 'node:${mod}'`],
									[`from "${mod}"`, `from "node:${mod}"`],
									[`import '${mod}'`, `import 'node:${mod}'`],
									[`import "${mod}"`, `import "node:${mod}"`],
									[`require('${mod}')`, `require('node:${mod}')`],
									[`require("${mod}")`, `require("node:${mod}")`]
								] as const
								for (const [from, to] of patterns) {
									if (code.includes(from)) {
										code = code.replaceAll(from, to)
										changed = true
									}
								}
							}
							if (changed) await writeFile(full, code)
						}
					}
				}

				await fixDir('build')
			}
		}
	}
}

export default defineConfig({
	plugins: [
		denoNodePrefix(),
		sveltekit(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
