import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectFramework, createFsContext } from './index'

describe('createFsContext', () => {
	let tmpDir: string

	afterAll(async () => {
		if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
	})

	it('fileExists returns true for a file that exists', async () => {
		tmpDir = await mkdtemp(join(tmpdir(), 'risved-detect-'))
		await writeFile(join(tmpDir, 'package.json'), '{}')

		const ctx = createFsContext(tmpDir)

		expect(await ctx.fileExists('package.json')).toBe(true)
	})

	it('fileExists returns false for a missing file', async () => {
		tmpDir ??= await mkdtemp(join(tmpdir(), 'risved-detect-'))

		const ctx = createFsContext(tmpDir)

		expect(await ctx.fileExists('nonexistent.json')).toBe(false)
	})

	it('readFile returns the file contents', async () => {
		tmpDir ??= await mkdtemp(join(tmpdir(), 'risved-detect-'))
		await writeFile(join(tmpDir, 'config.json'), '{"tasks":{}}')

		const ctx = createFsContext(tmpDir)

		expect(await ctx.readFile('config.json')).toBe('{"tasks":{}}')
	})

	it('readFile returns null for a missing file', async () => {
		tmpDir ??= await mkdtemp(join(tmpdir(), 'risved-detect-'))

		const ctx = createFsContext(tmpDir)

		expect(await ctx.readFile('missing.json')).toBeNull()
	})

	it('works end-to-end via detectFramework using filesystem context', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'risved-detect-'))
		try {
			await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: {} }))
			const ctx = createFsContext(dir)
			const result = await detectFramework(ctx)
			expect(result.detected).toBe(true)
			expect(result.framework?.id).toBe('generic')
			expect(result.framework?.tier).toBe('node')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})
