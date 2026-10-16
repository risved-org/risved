import { describe, expect, it } from 'vitest'
import { detectFramework } from './index'

/** Detect a manifest with optional configuration files. */
async function detect(dependencies: Record<string, string>, files: string[] = []) {
	return detectFramework({
		async fileExists(path) {
			return path === 'package.json' || files.includes(path)
		},
		async readFile(path) {
			return path === 'package.json' ? JSON.stringify({ dependencies }) : null
		}
	})
}

describe('additional framework detection', () => {
	it.each(['@tanstack/react-start', '@tanstack/solid-start', '@tanstack/start'])(
		'recognizes %s without confusing its router with a standalone SPA',
		async (dependency) => {
			const config = dependency === '@tanstack/start' ? 'app.config.ts' : 'vite.config.ts'
			expect((await detect({ [dependency]: '1' }, [config])).framework).toMatchObject({
				id: 'tanstack-start',
				confidence: 'high'
			})
		}
	)
	it('leaves React Router library-only applications generic', async () => {
		expect((await detect({ 'react-router': '7' })).framework?.id).toBe('generic')
	})
	it('recognizes React Router framework tooling', async () => {
		expect(
			(await detect({ '@react-router/dev': '7' }, ['react-router.config.ts'])).framework
		).toMatchObject({ id: 'react-router', confidence: 'high' })
	})
	it('recognizes AdonisJS', async () => {
		expect((await detect({ '@adonisjs/core': '7' }, ['adonisrc.ts'])).framework?.id).toBe(
			'adonisjs'
		)
	})
	it('recognizes standalone Elysia and preserves full-stack hosts embedding it', async () => {
		expect((await detect({ elysia: '1' })).framework?.id).toBe('elysia')
		expect((await detect({ elysia: '1', '@tanstack/react-start': '1' })).framework?.id).toBe(
			'tanstack-start'
		)
		expect((await detect({ elysia: '1', '@react-router/dev': '7' })).framework?.id).toBe(
			'react-router'
		)
	})
})
