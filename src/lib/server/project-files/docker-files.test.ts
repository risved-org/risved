import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { projectFiles } from './index'
import { projectVolumeName } from '$lib/server/pipeline/docker'

const projectId = `file-test-${randomUUID()}`
const otherId = `file-test-${randomUUID()}`
const enabled = process.env.RUN_DOCKER_FILE_TESTS === '1'

/** Run fixture setup and inspection only against this suite's disposable volume. */
function inspect(script: string, user = '0') {
	return execFileSync(
		'docker',
		[
			'run',
			'--rm',
			'--network',
			'none',
			'--user',
			user,
			'-v',
			`${projectVolumeName(projectId)}:/data`,
			'node:22-slim',
			'node',
			'-e',
			script
		],
		{ encoding: 'utf8' }
	)
}

describe.skipIf(!enabled)('real project data volumes', () => {
	afterAll(() => {
		for (const id of [projectId, otherId])
			execFileSync('docker', ['volume', 'rm', '-f', projectVolumeName(id)])
	})

	it('uploads binary data into nested folders, readable by a non-root app', async () => {
		const bytes = Buffer.from([0, 255, 128, 13, 10])
		await projectFiles(projectId, {
			operation: 'upload',
			path: 'fonts/custom.woff2',
			content: bytes.toString('base64')
		})
		const result = await projectFiles(projectId, { operation: 'list', path: 'fonts' })
		expect(result.entries).toEqual([
			expect.objectContaining({ name: 'custom.woff2', size: 5, kind: 'file' })
		])
		expect(
			inspect(
				"process.stdout.write(require('fs').readFileSync('/data/fonts/custom.woff2').toString('base64'))",
				'1000'
			)
		).toBe(bytes.toString('base64'))
	}, 60_000)

	it('does not overwrite without explicit replacement and preserves original permissions', async () => {
		await expect(
			projectFiles(projectId, { operation: 'upload', path: 'fonts/custom.woff2', content: 'bmV3' })
		).rejects.toMatchObject({ status: 409 })
		inspect(
			"const fs = require('fs')\nfs.chownSync('/data/fonts/custom.woff2', 1000, 1000)\nfs.chmodSync('/data/fonts/custom.woff2', 0o600)"
		)
		await projectFiles(projectId, {
			operation: 'upload',
			path: 'fonts/custom.woff2',
			content: 'bmV3',
			replace: true
		})
		expect(
			inspect(
				"process.stdout.write(require('fs').readFileSync('/data/fonts/custom.woff2', 'utf8'))",
				'1000'
			)
		).toBe('new')
		expect(
			inspect(
				"process.stdout.write(String(require('fs').statSync('/data/fonts/custom.woff2').mode & 0o777))"
			)
		).toBe(String(0o600))
	}, 60_000)

	it('isolates project volumes', async () => {
		expect((await projectFiles(otherId, { operation: 'list', path: '' })).entries).toEqual([])
	}, 30_000)

	it('rejects symlink folders and targets without touching their destinations', async () => {
		inspect(
			"const fs = require('fs')\nfs.symlinkSync('/data/fonts', '/data/link')\nfs.symlinkSync('/data/fonts/custom.woff2', '/data/secret')"
		)
		await expect(
			projectFiles(projectId, { operation: 'upload', path: 'link/escape', content: 'eA==' })
		).rejects.toMatchObject({ status: 400 })
		await expect(
			projectFiles(projectId, {
				operation: 'upload',
				path: 'secret',
				content: 'eA==',
				replace: true
			})
		).rejects.toMatchObject({ status: 400 })
		await expect(
			projectFiles(projectId, { operation: 'delete', path: 'secret' })
		).rejects.toMatchObject({ status: 400 })
		expect(
			inspect(
				"process.stdout.write(require('fs').readFileSync('/data/fonts/custom.woff2', 'utf8'))"
			)
		).toBe('new')
	}, 60_000)

	it('replaces hardlinks without modifying the other linked file', async () => {
		inspect("require('fs').linkSync('/data/fonts/custom.woff2', '/data/hardlink')")
		await projectFiles(projectId, {
			operation: 'upload',
			path: 'hardlink',
			content: 'b3RoZXI=',
			replace: true
		})
		expect(
			inspect(
				"process.stdout.write(require('fs').readFileSync('/data/fonts/custom.woff2', 'utf8'))"
			)
		).toBe('new')
	}, 30_000)

	it('paginates sorted directories and files and manages entries beyond the first page', async () => {
		inspect(`const fs = require('fs')
			fs.mkdirSync('/data/many')
			for (let i = 1000; i >= 0; i--) fs.mkdirSync('/data/many/dir-' + String(i).padStart(4, '0'))
			fs.writeFileSync('/data/many/z-file', 'old')
			fs.symlinkSync('/data/fonts', '/data/many/link')
			fs.writeFileSync('/data/many/.risved-upload-hidden', 'hidden')`)
		const first = await projectFiles(projectId, { operation: 'list', path: 'many' })
		const second = await projectFiles(projectId, { operation: 'list', path: 'many', page: 2 })
		expect(first.entries).toHaveLength(1000)
		expect(first.entries?.[0].name).toBe('dir-0000')
		expect(second).toMatchObject({ page: 2, totalPages: 2 })
		expect(second.entries?.map(entry => entry.name)).toEqual(['dir-1000', 'z-file'])
		expect(
			(await projectFiles(projectId, { operation: 'list', path: 'many/dir-1000' })).entries
		).toEqual([])
		await projectFiles(projectId, {
			operation: 'upload',
			path: 'many/z-file',
			content: 'bmV3',
			replace: true
		})
		await projectFiles(projectId, { operation: 'delete', path: 'many/z-file' })
		const last = await projectFiles(projectId, { operation: 'list', path: 'many', page: 999 })
		expect(last.page).toBe(2)
		expect(last.entries?.map(entry => entry.name)).toEqual(['dir-1000'])
	}, 60_000)
	it('deletes only the selected file and refuses directories', async () => {
		await expect(
			projectFiles(projectId, { operation: 'delete', path: 'fonts' })
		).rejects.toMatchObject({ status: 400 })
		await projectFiles(projectId, { operation: 'delete', path: 'fonts/custom.woff2' })
		expect((await projectFiles(projectId, { operation: 'list', path: 'fonts' })).entries).toEqual(
			[]
		)
	}, 60_000)
})
