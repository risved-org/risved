import { describe, it, expect } from 'vitest';
import { generateDockerfile, getFrameworkConfig } from './index';
import type { DockerfileOptions } from './types';

describe('Dockerfile Generation', () => {
	describe('Tier 1 — Pure Deno', () => {
		it('generates Fresh Dockerfile', () => {
			const result = generateDockerfile({ frameworkId: 'fresh', tier: 'deno' });

			expect(result.frameworkId).toBe('fresh');
			expect(result.tier).toBe('deno');
			expect(result.content).toContain('FROM denoland/deno:2');
			expect(result.content).toContain('COPY . .');
			expect(result.content).toContain('deno cache main.ts');
			expect(result.content).toContain('EXPOSE 8000');
			expect(result.content).toContain('CMD ["deno", "run", "--allow-all", "main.ts"]');
		});

		it('generates Hono Dockerfile', () => {
			const result = generateDockerfile({ frameworkId: 'hono', tier: 'deno' });

			expect(result.content).toContain('FROM denoland/deno:2');
			expect(result.content).toContain('deno cache main.ts');
			expect(result.content).toContain('CMD ["deno", "run", "--allow-all", "main.ts"]');
		});

		it('generates Lume Dockerfile with build step', () => {
			const result = generateDockerfile({ frameworkId: 'lume', tier: 'deno' });

			expect(result.content).toContain('FROM denoland/deno:2');
			expect(result.content).toContain('RUN deno cache _config.ts');
			expect(result.content).toContain('RUN deno task build');
			expect(result.content).toContain('EXPOSE 8000');
		});

		it('uses custom port for Deno tier', () => {
			const result = generateDockerfile({ frameworkId: 'fresh', tier: 'deno', port: 3000 });

			expect(result.content).toContain('EXPOSE 3000');
		});
	});

	describe('Tier 2 — Hybrid (Node build, Deno serve)', () => {
		it('generates SvelteKit Dockerfile with two stages', () => {
			const result = generateDockerfile({ frameworkId: 'sveltekit', tier: 'hybrid' });

			expect(result.frameworkId).toBe('sveltekit');
			expect(result.tier).toBe('hybrid');
			// Build stage
			expect(result.content).toContain('FROM node:22-slim AS builder');
			expect(result.content).toContain('RUN npm ci');
			expect(result.content).toContain('RUN npm run build');
			// Runtime stage
			expect(result.content).toContain('FROM denoland/deno:2');
			expect(result.content).toContain('COPY --from=builder /app/build ./build');
			expect(result.content).toContain(
				'CMD ["deno", "run", "--allow-all", "build/index.js"]'
			);
			expect(result.content).toContain('EXPOSE 8000');
		});

		it('generates Astro Dockerfile with two stages', () => {
			const result = generateDockerfile({ frameworkId: 'astro', tier: 'hybrid' });

			expect(result.content).toContain('FROM node:22-slim AS builder');
			expect(result.content).toContain('FROM denoland/deno:2');
			expect(result.content).toContain('COPY --from=builder /app/dist ./dist');
			expect(result.content).toContain(
				'CMD ["deno", "run", "--allow-all", "dist/server/entry.mjs"]'
			);
		});

		it('uses custom install and build commands', () => {
			const result = generateDockerfile({
				frameworkId: 'sveltekit',
				tier: 'hybrid',
				installCommand: 'pnpm install --frozen-lockfile',
				buildCommand: 'pnpm build'
			});

			expect(result.content).toContain('RUN pnpm install --frozen-lockfile');
			expect(result.content).toContain('RUN pnpm build');
		});
	});

	describe('Tier 3 — Node (Node build, Node serve)', () => {
		it('generates Next.js Dockerfile with standalone output', () => {
			const result = generateDockerfile({ frameworkId: 'nextjs', tier: 'node' });

			expect(result.frameworkId).toBe('nextjs');
			expect(result.tier).toBe('node');
			// Build stage
			expect(result.content).toContain('FROM node:22-slim AS builder');
			expect(result.content).toContain('RUN npm ci');
			expect(result.content).toContain('RUN npm run build');
			// Runtime stage — also Node
			expect(result.content).toMatch(/FROM node:22-slim\n/);
			expect(result.content).toContain(
				'COPY --from=builder /app/.next/standalone ./.next/standalone'
			);
			expect(result.content).toContain(
				'COPY --from=builder /app/.next/static ./.next/static'
			);
			expect(result.content).toContain('COPY --from=builder /app/public ./public');
			expect(result.content).toContain('CMD ["node", "server.js"]');
		});

		it('generates Nuxt Dockerfile with .output', () => {
			const result = generateDockerfile({ frameworkId: 'nuxt', tier: 'node' });

			expect(result.content).toContain('FROM node:22-slim AS builder');
			expect(result.content).toContain('COPY --from=builder /app/.output ./.output');
			expect(result.content).toContain('CMD ["node", ".output/server/index.mjs"]');
		});

		it('generates SolidStart Dockerfile with .output', () => {
			const result = generateDockerfile({ frameworkId: 'solidstart', tier: 'node' });

			expect(result.content).toContain('FROM node:22-slim AS builder');
			expect(result.content).toContain('COPY --from=builder /app/.output ./.output');
			expect(result.content).toContain('CMD ["node", ".output/server/index.mjs"]');
		});

		it('uses custom port for Node tier', () => {
			const result = generateDockerfile({ frameworkId: 'nextjs', tier: 'node', port: 3000 });

			expect(result.content).toContain('EXPOSE 3000');
		});

		it('uses custom install and build commands for Node tier', () => {
			const result = generateDockerfile({
				frameworkId: 'nuxt',
				tier: 'node',
				installCommand: 'yarn install --frozen-lockfile',
				buildCommand: 'yarn build'
			});

			expect(result.content).toContain('RUN yarn install --frozen-lockfile');
			expect(result.content).toContain('RUN yarn build');
		});
	});

	describe('Framework configs', () => {
		it('returns config for known framework', () => {
			const config = getFrameworkConfig('sveltekit');
			expect(config.outputDir).toBe('build');
			expect(config.buildCommand).toBe('npm run build');
		});

		it('throws for unknown framework', () => {
			expect(() => getFrameworkConfig('unknown')).toThrow('Unknown framework: unknown');
		});

		it('all 8 frameworks have configs', () => {
			const frameworks = [
				'sveltekit',
				'fresh',
				'astro',
				'hono',
				'nextjs',
				'nuxt',
				'lume',
				'solidstart'
			];
			for (const fw of frameworks) {
				expect(() => getFrameworkConfig(fw)).not.toThrow();
			}
		});
	});

	describe('Edge cases', () => {
		it('defaults port to 8000', () => {
			const result = generateDockerfile({ frameworkId: 'fresh', tier: 'deno' });
			expect(result.content).toContain('EXPOSE 8000');
		});

		it('throws for unknown tier', () => {
			expect(() =>
				generateDockerfile({
					frameworkId: 'fresh',
					tier: 'unknown' as DockerfileOptions['tier']
				})
			).toThrow('Unknown tier: unknown');
		});

		it('copies package-lock.json optionally in hybrid tier', () => {
			const result = generateDockerfile({ frameworkId: 'sveltekit', tier: 'hybrid' });
			expect(result.content).toContain('COPY package.json package-lock.json* ./');
		});

		it('copies package-lock.json optionally in node tier', () => {
			const result = generateDockerfile({ frameworkId: 'nextjs', tier: 'node' });
			expect(result.content).toContain('COPY package.json package-lock.json* ./');
		});

		it('Deno tier has no multi-stage build', () => {
			const result = generateDockerfile({ frameworkId: 'hono', tier: 'deno' });
			expect(result.content).not.toContain('AS builder');
			expect(result.content).not.toContain('--from=builder');
		});

		it('Deno tier for Lume includes build step but Hono does not', () => {
			const lume = generateDockerfile({ frameworkId: 'lume', tier: 'deno' });
			const hono = generateDockerfile({ frameworkId: 'hono', tier: 'deno' });

			expect(lume.content).toContain('RUN deno task build');
			// Hono only has the cache line as RUN, no build step
			const honoRunLines = hono.content
				.split('\n')
				.filter((l) => l.startsWith('RUN '));
			expect(honoRunLines).toHaveLength(1);
			expect(honoRunLines[0]).toContain('deno cache');
		});
	});
});
