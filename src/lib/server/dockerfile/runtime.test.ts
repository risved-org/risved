import { describe, expect, it } from 'vitest'
import type { DockerfileOptions } from './types'
import { generateDockerfile } from './index'
import { BUN_VERSION } from '$lib/project-runtime'

describe('project runtime', () => {
	it('keeps Node as the default even with a Bun lockfile', () => {
		const { content } = generateDockerfile({
			frameworkId: 'sveltekit',
			tier: 'node',
			lockfile: 'bun.lock'
		})
		expect(content).toContain('RUN bun install --frozen-lockfile')
		expect(content).toContain('FROM node:22-slim AS runtime')
		expect(content).toContain('CMD ["node", "build/index.js"]')
	})

	it('uses pinned Bun for the server without changing the npm package manager', () => {
		const { content } = generateDockerfile({
			frameworkId: 'sveltekit',
			tier: 'node',
			runtime: 'bun',
			lockfile: 'package-lock.json'
		})
		expect(content).toContain(`FROM oven/bun:${BUN_VERSION}-debian AS runtime`)
		expect(content).toContain(
			`COPY --from=oven/bun:${BUN_VERSION}-debian /usr/local/bin/bun /usr/local/bin/bun`
		)
		expect(content).toContain('RUN npm ci')
		expect(content).toContain('RUN bun --bun run build')
		expect(content).toContain('COPY --from=deps /app/node_modules ./node_modules')
		expect(content).toContain('CMD ["bun", "build/index.js"]')
	})

	it('supports a generic TypeScript entrypoint and preserves environment scrubbing', () => {
		const { content } = generateDockerfile({
			frameworkId: 'generic',
			tier: 'node',
			runtime: 'bun',
			startCommand: 'bun src/server.ts',
			stripBuildEnv: true
		})
		expect(content).toContain('CMD ["bun", "src/server.ts"]')
		expect(content).toContain('COPY --from=output /app/. ./.')
		expect(content).toContain('RUN : > /app/.env')
	})

	it.each(['nextjs', 'nuxt', 'nuxt2', 'solidstart', 'tanstack-start'] as const)(
		'rejects Bun for unsupported %s',
		frameworkId => {
			expect(() => generateDockerfile({ frameworkId, tier: 'node', runtime: 'bun' })).toThrow(
				'Bun is currently supported'
			)
		}
	)
})

it.each(['deno', 'hybrid'])('rejects a saved unsupported %s tier', tier => {
	expect(() =>
		generateDockerfile({
			frameworkId: 'generic',
			tier: tier as DockerfileOptions['tier']
		})
	).toThrow(`Unknown tier: ${tier}`)
})

it('uses node_modules for Astro with Yarn Berry before installation and pruning', () => {
	const { content } = generateDockerfile({
		frameworkId: 'astro',
		tier: 'node',
		lockfile: 'yarn.lock',
		yarnVersion: 'berry'
	})
	expect(content.indexOf('ENV YARN_NODE_LINKER=node-modules')).toBeLessThan(
		content.indexOf('RUN yarn install --immutable')
	)
	expect(content).toContain('FROM build AS deps')
	expect(content).toContain('RUN yarn workspaces focus --production --all')
	expect(content).toContain('COPY --from=deps /app/node_modules ./node_modules')
})
