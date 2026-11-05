import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { generateDockerfile } from './index'
import type { DockerfileOptions } from './types'

const exec = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

/** Use the generated Dockerfile's real runtime command in a local workspace fixture. */
function artifact(frameworkId: DockerfileOptions['frameworkId'], startCommand?: string) {
	const content = generateDockerfile({
		frameworkId,
		tier: 'node',
		startCommand,
		workspace: { root: '', app: 'apps/web', buildPackages: [] },
		packageManagerDetection: {
			packageManager: 'npm',
			lockfile: 'package-lock.json',
			lockfilesFound: [],
			warnings: []
		}
	}).content
	return {
		command: JSON.parse(
			content
				.split('\n')
				.find((line) => line.startsWith('CMD '))!
				.slice(4)
		)[2] as string,
		prepare: content
			.split('\n')
			.find((line) => line.startsWith('RUN standalone='))
			?.slice(4)
	}
}

/** Write fixture files, including an executable shell shim when needed. */
async function file(path: string, content: string) {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, content, { mode: 0o755 })
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'risved-runtime-'))
	directories.push(root)
	const app = join(root, 'apps/web')
	await mkdir(app, { recursive: true })
	return { root, app }
}

describe('hoisted framework executables', () => {
	it.each(['react-router', 'nuxt2'] as const)(
		'starts %s with a hoisted CLI while preserving app cwd',
		async (framework) => {
			const { root, app } = await fixture()
			const executable =
				framework === 'react-router'
					? 'node_modules/@react-router/serve/bin.cjs'
					: 'node_modules/.bin/nuxt'
			const script =
				framework === 'react-router'
					? 'console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }))'
					: '#!/bin/sh\nprintf "%s\\n" "$PWD" "$1"\n'
			await file(join(root, executable), script)
			const command = artifact(framework).command.replaceAll('/app/', `${root}/`)
			const result = await exec('sh', ['-c', command], { cwd: app })
			if (framework === 'react-router') {
				expect(JSON.parse(result.stdout)).toEqual({
					cwd: await realpath(app),
					args: ['build/server/index.js']
				})
			} else {
				expect(result.stdout.trim().split('\n')).toEqual([await realpath(app), 'start'])
			}
		}
	)

	it('prefers an app-local CLI over the hoisted one', async () => {
		const { root, app } = await fixture()
		for (const [base, output] of [
			[root, 'root'],
			[app, 'app']
		] as const) {
			await file(join(base, 'node_modules/@react-router/serve/bin.cjs'), `console.log('${output}')`)
		}
		const result = await exec(
			'sh',
			['-c', artifact('react-router').command.replaceAll('/app/', `${root}/`)],
			{ cwd: app }
		)
		expect(result.stdout.trim()).toBe('app')
	})

	it('preserves a custom start command', () => {
		expect(artifact('react-router', 'node custom.js').command).toBe('node custom.js')
	})
})

it.each(['flat', 'nested'] as const)(
	'copies static and public assets into the %s Next standalone server root',
	async (layout) => {
		const { app } = await fixture()
		const standalone = join(app, '.next/standalone', layout === 'nested' ? 'apps/web' : '')
		await file(join(standalone, 'server.js'), "console.log('server started')")
		await file(join(app, '.next/static/chunks/main.js'), 'javascript')
		await file(join(app, 'public/fonts/font.woff'), 'font')
		const { prepare, command } = artifact('nextjs')
		await exec('sh', ['-c', prepare!], { cwd: app })
		expect(await readFile(join(standalone, '.next/static/chunks/main.js'), 'utf8')).toBe(
			'javascript'
		)
		expect(await readFile(join(standalone, 'public/fonts/font.woff'), 'utf8')).toBe('font')
		const result = await exec('sh', ['-c', command], { cwd: app })
		expect(result.stdout.trim()).toBe('server started')
	}
)
