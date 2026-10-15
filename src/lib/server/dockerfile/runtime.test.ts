import { describe, expect, it } from 'vitest'
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

	it('rejects Bun for a generic Deno project after detection', () => {
		expect(() =>
			generateDockerfile({ frameworkId: 'generic', tier: 'deno', runtime: 'bun' })
		).toThrow('Bun is currently supported')
	})
})
