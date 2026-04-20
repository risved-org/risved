import { describe, it, expect } from 'vitest';
import { generateDockerfile, getFrameworkConfig } from './index';
import type { DockerfileOptions } from './types';

describe('Dockerfile Generation', () => {
	describe('Tier 1 — Pure Deno', () => {
		it('generates Fresh Dockerfile', () => {
			const result = generateDockerfile({ frameworkId: 'fresh', tier: 'deno' });

			expect(result.frameworkId).toBe('fresh');
			expect(result.tier).toBe('deno');
			expect(result.content).toContain('FROM denoland/deno:latest');
			expect(result.content).toContain('COPY . .');
			expect(result.content).toContain('deno cache main.ts');
			expect(result.content).toContain('EXPOSE 8000');
			expect(result.content).toContain('CMD ["deno", "run", "--allow-all", "main.ts"]');
		});

		it('generates Hono Dockerfile', () => {
			const result = generateDockerfile({ frameworkId: 'hono', tier: 'deno' });

			expect(result.content).toContain('FROM denoland/deno:latest');
			expect(result.content).toContain('deno cache main.ts');
			expect(result.content).toContain('CMD ["deno", "run", "--allow-all", "main.ts"]');
		});

		it('generates Lume Dockerfile with build step', () => {
			const result = generateDockerfile({ frameworkId: 'lume', tier: 'deno' });

			expect(result.content).toContain('FROM denoland/deno:latest');
			expect(result.content).toContain('RUN deno cache _config.ts');
			expect(result.content).toContain('RUN deno task build');
			expect(result.content).toContain('EXPOSE 8000');
		});

		it('uses custom port for Deno tier', () => {
			const result = generateDockerfile({ frameworkId: 'fresh', tier: 'deno', port: 3000 });

			expect(result.content).toContain('EXPOSE 3000');
		});

		it('creates writable /app/data directory', () => {
			const result = generateDockerfile({ frameworkId: 'fresh', tier: 'deno' });
			expect(result.content).toContain('RUN mkdir -p /app/data && chmod 777 /app/data');
		});
	});

	describe('Tier 2 — Hybrid (Node build, Deno serve)', () => {
		it('generates SvelteKit Dockerfile with Node runtime', () => {
			const result = generateDockerfile({ frameworkId: 'sveltekit', tier: 'node' });

			expect(result.frameworkId).toBe('sveltekit');
			expect(result.tier).toBe('node');
			// Build stage — uses pre-warmed builder
			expect(result.content).toContain('FROM risved-node-build:22 AS build');
			expect(result.content).toMatch(/RUN .*npm ci/);
			expect(result.content).toContain('RUN npm run build');
			// Runtime stage — slim Node
			expect(result.content).toContain('FROM node:22-slim AS runtime');
			expect(result.content).toContain('COPY --from=deps /app/build ./build');
			expect(result.content).toContain(
				'CMD ["node", "build/index.js"]'
			);
			expect(result.content).toContain('EXPOSE 8000');
		});

		it('generates Astro Dockerfile with two stages', () => {
			const result = generateDockerfile({ frameworkId: 'astro', tier: 'hybrid' });

			expect(result.content).toContain('FROM risved-node-build:22 AS build');
			expect(result.content).toContain('FROM denoland/deno:latest');
			expect(result.content).toContain('COPY --from=build /app/dist ./dist');
			expect(result.content).toContain(
				'CMD ["deno", "run", "--allow-all", "dist/server/entry.mjs"]'
			);
		});

		it('uses custom install and build commands', () => {
			const result = generateDockerfile({
				frameworkId: 'sveltekit',
				tier: 'node',
				installCommand: 'pnpm install --frozen-lockfile',
				buildCommand: 'pnpm build'
			});

			expect(result.content).toContain('RUN pnpm install --frozen-lockfile');
			expect(result.content).toContain('RUN pnpm build');
		});

		it('creates writable /app/data directory in runtime stage', () => {
			const result = generateDockerfile({ frameworkId: 'astro', tier: 'hybrid' });
			expect(result.content).toContain('RUN mkdir -p /app/data && chmod 777 /app/data');
		});
	});

	describe('Tier 3 — Node (Node build, Node serve)', () => {
		it('generates Next.js Dockerfile with standalone output', () => {
			const result = generateDockerfile({ frameworkId: 'nextjs', tier: 'node' });

			expect(result.frameworkId).toBe('nextjs');
			expect(result.tier).toBe('node');
			// Build stage
			expect(result.content).toContain('FROM risved-node-build:22 AS build');
			expect(result.content).toMatch(/RUN .*npm ci/);
			expect(result.content).toContain('RUN npm run build');
			// Runtime stage — also Node
			expect(result.content).toContain('FROM node:22-slim AS runtime');
			expect(result.content).toContain(
				'COPY --from=build /app/.next/standalone ./.next/standalone'
			);
			expect(result.content).toContain(
				'COPY --from=build /app/.next/static ./.next/static'
			);
			expect(result.content).toContain('COPY --from=build /app/public ./public');
			expect(result.content).toContain('CMD ["node", "server.js"]');
		});

		it('generates Nuxt Dockerfile with .output', () => {
			const result = generateDockerfile({ frameworkId: 'nuxt', tier: 'node' });

			expect(result.content).toContain('FROM risved-node-build:22 AS build');
			expect(result.content).toContain('COPY --from=build /app/.output ./.output');
			expect(result.content).toContain('CMD ["node", ".output/server/index.mjs"]');
		});

		it('generates SolidStart Dockerfile with .output', () => {
			const result = generateDockerfile({ frameworkId: 'solidstart', tier: 'node' });

			expect(result.content).toContain('FROM risved-node-build:22 AS build');
			expect(result.content).toContain('COPY --from=build /app/.output ./.output');
			expect(result.content).toContain('CMD ["node", ".output/server/index.mjs"]');
		});

		it('creates writable /app/data directory in runtime stage', () => {
			const result = generateDockerfile({ frameworkId: 'nextjs', tier: 'node' });
			expect(result.content).toContain('RUN mkdir -p /app/data && chmod 777 /app/data');
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

	describe('TanStack Start', () => {
		it('generates TanStack Start Dockerfile with .output', () => {
			const result = generateDockerfile({ frameworkId: 'tanstack-start', tier: 'node' });

			expect(result.frameworkId).toBe('tanstack-start');
			expect(result.tier).toBe('node');
			expect(result.content).toContain('FROM risved-node-build:22 AS build');
			expect(result.content).toContain('COPY --from=build /app/.output ./.output');
			expect(result.content).toContain('CMD ["node", ".output/server/index.mjs"]');
		});
	});

	describe('Generic fallback', () => {
		it('generates generic Node Dockerfile', () => {
			const result = generateDockerfile({ frameworkId: 'generic', tier: 'node' });

			expect(result.frameworkId).toBe('generic');
			expect(result.tier).toBe('node');
			expect(result.content).toContain('FROM risved-node-build:22 AS build');
			expect(result.content).toMatch(/RUN .*npm ci/);
			expect(result.content).toContain('RUN npm run build');
			expect(result.content).toContain('CMD ["node", "index.js"]');
		});

		it('generates generic Deno Dockerfile', () => {
			const result = generateDockerfile({ frameworkId: 'generic', tier: 'deno' });

			expect(result.frameworkId).toBe('generic');
			expect(result.tier).toBe('deno');
			expect(result.content).toContain('FROM denoland/deno:latest');
			expect(result.content).toContain('deno cache main.ts');
			expect(result.content).toContain('CMD ["deno", "run", "--allow-all", "main.ts"]');
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

		it('all 10 frameworks have configs', () => {
			const frameworks = [
				'sveltekit',
				'fresh',
				'astro',
				'hono',
				'nextjs',
				'nuxt',
				'lume',
				'solidstart',
				'tanstack-start',
				'generic'
			];
			for (const fw of frameworks) {
				expect(() => getFrameworkConfig(fw)).not.toThrow();
			}
		});
	});

	describe('Dev dependency pruning', () => {
		it('prunes dev deps for SvelteKit (has node_modules in copyPaths)', () => {
			const result = generateDockerfile({ frameworkId: 'sveltekit', tier: 'node' })
			expect(result.content).toContain('RUN npm prune --omit=dev')
		})

		it('prunes with bun when bun.lock detected', () => {
			const result = generateDockerfile({ frameworkId: 'sveltekit', tier: 'node', lockfile: 'bun.lock' })
			expect(result.content).toContain('RUN rm -rf node_modules && bun install --frozen-lockfile --production')
		})

		it('uses yarn berry prune (workspaces focus) when yarnVersion is berry', () => {
			const result = generateDockerfile({
				frameworkId: 'sveltekit',
				tier: 'node',
				lockfile: 'yarn.lock',
				yarnVersion: 'berry'
			})
			expect(result.content).toContain('yarn workspaces focus --production --all')
		})

		it('does not prune for frameworks without node_modules in copyPaths', () => {
			const result = generateDockerfile({ frameworkId: 'nuxt', tier: 'node' })
			expect(result.content).not.toContain('prune')
			expect(result.content).not.toContain('--production')
		})
	})

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

		it('copies package-lock.json optionally in node tier for sveltekit', () => {
			const result = generateDockerfile({ frameworkId: 'sveltekit', tier: 'node' });
			expect(result.content).toContain('COPY package.json package-lock.json* ./');
		});

		it('copies package-lock.json optionally in node tier', () => {
			const result = generateDockerfile({ frameworkId: 'nextjs', tier: 'node' });
			expect(result.content).toContain('COPY package.json package-lock.json* ./');
		});

		it('uses yarn --immutable for Yarn Berry', () => {
			const result = generateDockerfile({
				frameworkId: 'nuxt',
				tier: 'node',
				lockfile: 'yarn.lock',
				yarnVersion: 'berry'
			});
			expect(result.content).toContain('yarn install --immutable');
			expect(result.content).not.toContain('yarn install --frozen-lockfile');
		});

		it('uses yarn --frozen-lockfile for Yarn Classic', () => {
			const result = generateDockerfile({
				frameworkId: 'nuxt',
				tier: 'node',
				lockfile: 'yarn.lock',
				yarnVersion: 'classic'
			});
			expect(result.content).toContain('yarn install --frozen-lockfile');
			expect(result.content).not.toContain('--immutable');
		});

		it('uses pnpm install --frozen-lockfile without any corepack enable prefix', () => {
			const result = generateDockerfile({
				frameworkId: 'nuxt',
				tier: 'node',
				lockfile: 'pnpm-lock.yaml'
			});
			expect(result.content).toContain('RUN pnpm install --frozen-lockfile');
			expect(result.content).not.toContain('corepack enable');
		});

		it('runtime stage for Node tier never references a package manager', () => {
			const result = generateDockerfile({
				frameworkId: 'nuxt',
				tier: 'node',
				lockfile: 'bun.lockb'
			});
			const runtimeIdx = result.content.indexOf('AS runtime');
			const runtime = result.content.slice(runtimeIdx);
			expect(runtime).not.toMatch(/\bbun\b/);
			expect(runtime).not.toMatch(/\bpnpm\b/);
			expect(runtime).not.toMatch(/\byarn\b/);
		});

		it('Deno tier names its stage `build` so release containers can target it', () => {
			const result = generateDockerfile({ frameworkId: 'hono', tier: 'deno' });
			expect(result.content).toContain('FROM denoland/deno:latest AS build');
			expect(result.content).not.toContain('--from=build');
		});

		it('all tiers expose a stage named `build`', () => {
			const deno = generateDockerfile({ frameworkId: 'fresh', tier: 'deno' });
			const hybrid = generateDockerfile({ frameworkId: 'astro', tier: 'hybrid' });
			const node = generateDockerfile({ frameworkId: 'nextjs', tier: 'node' });
			expect(deno.content).toContain('AS build');
			expect(hybrid.content).toContain('AS build');
			expect(node.content).toContain('AS build');
		});

		it('Deno tier for Lume includes build step but Hono does not', () => {
			const lume = generateDockerfile({ frameworkId: 'lume', tier: 'deno' });
			const hono = generateDockerfile({ frameworkId: 'hono', tier: 'deno' });

			expect(lume.content).toContain('RUN deno task build');
			// Hono has no build step — only the cache line and the data-dir prep.
			expect(hono.content).toContain('RUN deno cache main.ts');
			expect(hono.content).not.toContain('task build');
		});
	});
});
