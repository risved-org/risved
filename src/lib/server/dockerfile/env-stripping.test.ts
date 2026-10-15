import { describe, it, expect } from 'vitest'
import { generateDockerfile } from './index'

describe('build-time .env stripping', () => {
	it('leaves Dockerfiles untouched when no env vars were injected', () => {
		for (const opts of [
			{ frameworkId: 'generic', tier: 'node' },
			{ frameworkId: 'generic', tier: 'node' },
			{ frameworkId: 'sveltekit', tier: 'node' }
		] as const) {
			expect(generateDockerfile({ ...opts, stripBuildEnv: false }).content).toBe(
				generateDockerfile(opts).content
			)
			expect(generateDockerfile(opts).content).not.toContain('AS output')
		}
	})

	it('generic Node apps copy the whole context from the stripped stage', () => {
		const { content } = generateDockerfile({
			frameworkId: 'generic',
			tier: 'node',
			stripBuildEnv: true
		})
		expect(content).toContain('FROM build AS output\nRUN : > /app/.env')
		expect(content).toContain('COPY --from=output /app/. ./.')
		expect(content).not.toContain('COPY --from=build')
	})

	it('frameworks that copy specific output paths need no extra stage', () => {
		const { content } = generateDockerfile({
			frameworkId: 'sveltekit',
			tier: 'node',
			stripBuildEnv: true
		})
		expect(content).not.toContain('AS output')
	})
})
