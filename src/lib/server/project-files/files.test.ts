import { describe, it, expect } from 'vitest'
import { validateFilePath, MAX_FILE_BYTES } from '$lib/project-files'
import { readFileForm } from './form'
import { projectFiles } from './index'

describe('project file boundaries', () => {
	it.each([
		'../secret',
		'/etc/passwd',
		'fonts/../../secret',
		'fonts//font',
		'a/./b',
		'a\\b',
		'a\0b',
		'.risved-upload-test',
		'a\nb'
	])('rejects unsafe path %j', async path => {
		expect(() => validateFilePath(path)).toThrow()
		await expect(projectFiles('project-1', { operation: 'delete', path })).rejects.toMatchObject({
			status: 400
		})
	})
	it('accepts nested filenames with spaces and Unicode', () => {
		expect(validateFilePath('fonts/Éuropa regular.woff2')).toBe('fonts/Éuropa regular.woff2')
		expect(validateFilePath('', true)).toBe('')
		expect(() => validateFilePath('')).toThrow()
	})
	it('rejects a project ID that could alter the Docker mount', async () => {
		await expect(
			projectFiles('bad:/outside', { operation: 'list', path: '' })
		).rejects.toMatchObject({ status: 400 })
	})
	it('round trips binary multipart uploads', async () => {
		const form = new FormData()
		form.set('file', new File([new Uint8Array([0, 255, 1])], 'font.woff2'))
		form.set('path', 'fonts/font.woff2')
		const result = await readFileForm(
			new Request('http://localhost/files', { method: 'POST', body: form })
		)
		expect(result.get('path')).toBe('fonts/font.woff2')
		expect(new Uint8Array(await (result.get('file') as File).arrayBuffer())).toEqual(
			new Uint8Array([0, 255, 1])
		)
	})
	it('rejects oversized declared bodies before reading', async () => {
		await expect(
			readFileForm(
				new Request('http://localhost/files', {
					method: 'POST',
					body: 'x',
					headers: { 'content-length': String(MAX_FILE_BYTES + 100_000) }
				})
			)
		).rejects.toMatchObject({ status: 413 })
	})
	it('bounds bodies without a Content-Length header', async () => {
		const request = new Request('http://localhost/files', {
			method: 'POST',
			body: new Uint8Array(MAX_FILE_BYTES + 100_000)
		})
		await expect(readFileForm(request)).rejects.toMatchObject({ status: 413 })
	})
	it('rejects malformed multipart input', async () => {
		await expect(
			readFileForm(new Request('http://localhost/files', { method: 'POST', body: 'invalid' }))
		).rejects.toMatchObject({ status: 400 })
	})
})
