import { getFrameworkConfig } from './configs';
import { denoTemplate, hybridTemplate, nodeTemplate } from './templates';
import type { DockerfileOptions, DockerfileResult } from './types';

export type { DockerfileOptions, DockerfileResult } from './types';
export type { FrameworkBuildConfig, FrameworkConfigs } from './types';
export { frameworkConfigs, getFrameworkConfig } from './configs';

const DEFAULT_PORT = 8000;

/**
 * Generate a Dockerfile for a detected framework.
 * Uses the framework's tier to select the appropriate template strategy:
 * - deno: Pure Deno container (Fresh, Hono, Lume)
 * - hybrid: Node build + Deno serve (SvelteKit, Astro)
 * - node: Node build + Node serve (Next.js, Nuxt, SolidStart)
 */
export function generateDockerfile(options: DockerfileOptions): DockerfileResult {
	const { frameworkId, tier, port = DEFAULT_PORT, installCommand, buildCommand, lockfile } = options;
	let config = getFrameworkConfig(frameworkId);

	/* Generic framework: adjust commands based on actual tier */
	if (frameworkId === 'generic' && tier === 'deno') {
		config = {
			...config,
			installCommand: 'deno cache main.ts',
			buildCommand: '',
			serveCommand: 'deno run --allow-all main.ts',
			denoPermissions: '--allow-all'
		};
	}

	let content: string;

	switch (tier) {
		case 'deno':
			content = denoTemplate(config, port);
			break;
		case 'hybrid':
			content = hybridTemplate(config, port, installCommand, buildCommand, lockfile);
			break;
		case 'node':
			content = nodeTemplate(config, port, installCommand, buildCommand, lockfile);
			break;
		default:
			throw new Error(`Unknown tier: ${tier}`);
	}

	return { content, frameworkId, tier };
}
