import { expect, it } from 'vitest'
import { generateDockerfile } from './index'
import { ensureWarmImage } from '../pipeline/docker'

it('uses Node 24 for both Adonis build and runtime and starts inside the standalone build', () => {
	const { content } = generateDockerfile({ frameworkId: 'adonisjs', tier: 'node' })
	expect(content).toContain('FROM risved-node-build:24 AS build')
	expect(content).toContain('FROM node:24-slim AS runtime')
	expect(content).toContain('COPY --from=deps /app/node_modules ./node_modules')
	expect(content).toContain('WORKDIR /app/build')
	expect(content).toContain('CMD ["node", "bin/server.js"]')
})

it('builds the matching warm image on demand', async () => {
	const calls: string[][] = []
	const result = await ensureWarmImage(
		{
			async exec(_command, args) {
				calls.push(args)
				return { exitCode: calls.length === 1 ? 1 : 0, stdout: '', stderr: '' }
			}
		},
		{ nodeVersion: 24 }
	)
	expect(result).toMatchObject({ success: true, built: true })
	expect(calls[0]).toContain('risved-node-build:24')
	expect(calls[1]).toEqual(
		expect.arrayContaining(['--build-arg', 'NODE_VERSION=24', 'risved-node-build:24'])
	)
})

it('runs the React Router production server with its production dependencies', () => {
	const { content } = generateDockerfile({ frameworkId: 'react-router', tier: 'node' })
	expect(content).toContain(
		'CMD ["node", "node_modules/@react-router/serve/bin.cjs", "build/server/index.js"]'
	)
	expect(content).toContain('COPY --from=deps /app/node_modules ./node_modules')
	expect(content).toContain('ENV HOST=0.0.0.0')
})

it('runs Elysia build and server under Bun when selected', () => {
	const { content } = generateDockerfile({
		frameworkId: 'elysia',
		tier: 'node',
		runtime: 'bun',
		lockfile: 'bun.lock'
	})
	expect(content).toContain('RUN bun --bun run build')
	expect(content).toContain('CMD ["bun", "dist/index.js"]')
	expect(content).toContain('ENV PORT=3000')
})
