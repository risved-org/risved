import { describe, it, expect } from 'vitest';
import { inspectRepoConfig, hintsFromLogs } from './hints';
import type { DetectionContext } from './detection/types';

/** A DetectionContext backed by a plain map of path → contents. */
function ctxFrom(files: Record<string, string>): DetectionContext {
	return {
		async fileExists(path) {
			return path in files;
		},
		async readFile(path) {
			return files[path] ?? null;
		}
	};
}

const codes = (hints: Array<{ code: string }>) => hints.map((h) => h.code);

describe('inspectRepoConfig', () => {
	it('flags a repo with no manifest and stops there', async () => {
		const hints = await inspectRepoConfig(ctxFrom({ 'README.md': '# hi' }));

		expect(codes(hints)).toEqual(['no_project_manifest']);
	});

	it('flags SvelteKit without adapter-node', async () => {
		const hints = await inspectRepoConfig(
			ctxFrom({
				'package.json': JSON.stringify({
					scripts: { build: 'vite build' },
					devDependencies: { '@sveltejs/kit': '^2.0.0' }
				}),
				'svelte.config.js': "import adapter from '@sveltejs/adapter-auto';",
				'package-lock.json': '{}'
			})
		);

		expect(codes(hints)).toContain('missing_adapter_node');
		expect(codes(hints)).toContain('adapter_auto_configured');
		expect(hints.find((h) => h.code === 'missing_adapter_node')?.fix).toBe(
			'npm i -D @sveltejs/adapter-node'
		);
	});

	it('passes a correctly configured SvelteKit repo', async () => {
		const hints = await inspectRepoConfig(
			ctxFrom({
				'package.json': JSON.stringify({
					scripts: { build: 'vite build' },
					devDependencies: {
						'@sveltejs/kit': '^2.0.0',
						'@sveltejs/adapter-node': '^5.0.0'
					}
				}),
				'svelte.config.js': "import adapter from '@sveltejs/adapter-node';",
				'bun.lock': ''
			})
		);

		expect(hints.filter((h) => h.severity === 'error')).toEqual([]);
	});

	it('warns when no lockfile is committed', async () => {
		const hints = await inspectRepoConfig(
			ctxFrom({
				'package.json': JSON.stringify({
					scripts: { build: 'next build' },
					dependencies: { next: '^15.0.0' }
				}),
				'next.config.js': "export default { output: 'standalone' };"
			})
		);

		const lockfile = hints.find((h) => h.code === 'missing_lockfile');
		expect(lockfile?.severity).toBe('warning');
	});

	it('flags Next.js that is not building standalone', async () => {
		const hints = await inspectRepoConfig(
			ctxFrom({
				'package.json': JSON.stringify({
					scripts: { build: 'next build' },
					dependencies: { next: '^15.0.0' }
				}),
				'next.config.js': 'export default {};',
				'package-lock.json': '{}'
			})
		);

		expect(codes(hints)).toContain('missing_nextjs_standalone');
	});

	it('flags a missing build script', async () => {
		const hints = await inspectRepoConfig(
			ctxFrom({
				'package.json': JSON.stringify({
					dependencies: { nuxt: '^3.0.0' }
				}),
				'nuxt.config.ts': 'export default {}',
				'package-lock.json': '{}'
			})
		);

		expect(codes(hints)).toContain('missing_build_script');
	});

	it('flags package.json that is not valid JSON', async () => {
		const hints = await inspectRepoConfig(ctxFrom({ 'package.json': '{ oops' }));

		expect(codes(hints)).toContain('invalid_package_json');
	});

	it('flags Astro without the node adapter', async () => {
		const hints = await inspectRepoConfig(
			ctxFrom({
				'package.json': JSON.stringify({
					scripts: { build: 'astro build' },
					dependencies: { astro: '^5.0.0' }
				}),
				'astro.config.mjs': 'export default {};',
				'package-lock.json': '{}'
			})
		);

		expect(codes(hints)).toContain('missing_astro_node_adapter');
		expect(codes(hints)).toContain('astro_static_output');
	});
});

describe('hintsFromLogs', () => {
	it('returns nothing for a clean build', () => {
		expect(
			hintsFromLogs([
				{ level: 'info', message: 'Cloning repository' },
				{ level: 'info', message: 'Deployment is live' }
			])
		).toEqual([]);
	});

	it('ignores the word error in an informational line', () => {
		expect(
			hintsFromLogs([{ level: 'info', message: 'copying src/lib/error-page.svelte' }])
		).toEqual([]);
	});

	it('maps a health check timeout', () => {
		const hints = hintsFromLogs([{ level: 'error', message: 'Health check timed out after 30s' }]);

		expect(codes(hints)).toEqual(['health_check_timeout']);
		expect(hints[0].severity).toBe('error');
	});

	it('maps an out-of-memory build', () => {
		const hints = hintsFromLogs([
			{ level: 'error', message: 'FATAL ERROR: JavaScript heap out of memory' }
		]);

		expect(codes(hints)).toEqual(['build_out_of_memory']);
	});

	it('reports each code only once', () => {
		const hints = hintsFromLogs([
			{ level: 'error', message: 'error TS2304: Cannot find name foo' },
			{ level: 'error', message: 'error TS2305: Module has no exported member' }
		]);

		expect(codes(hints)).toEqual(['typescript_error']);
	});

	it('maps a git authentication failure', () => {
		const hints = hintsFromLogs([
			{ level: 'error', message: 'fatal: Authentication failed for https://github.com/x/y' }
		]);

		expect(codes(hints)).toEqual(['git_auth_failed']);
	});
});
