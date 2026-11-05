import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAppDirectory, resolveAppDirectory } from './app-directory'
import { resolveWorkspace } from './workspace'
import { appTemplate } from './dockerfile/app-template'
import { getFrameworkConfig } from './dockerfile/configs'
import { generateDockerfile } from './dockerfile'
import { BUN_VERSION } from '$lib/project-runtime'

const dirs: string[] = []
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(pnpm = false) {
	const root = await mkdtemp(join(tmpdir(), 'risved-workspace-test-'))
	dirs.push(root)
	for (const path of ['apps/a', 'apps/b', 'packages/shared'])
		await mkdir(join(root, path), { recursive: true })
	await writeFile(
		join(root, 'package.json'),
		JSON.stringify({
			private: true,
			workspaces: pnpm ? undefined : { packages: ['apps/*', 'packages/*'] }
		})
	)
	if (pnpm)
		await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n')
	for (const name of ['a', 'b'])
		await writeFile(
			join(root, 'apps', name, 'package.json'),
			JSON.stringify({
				name,
				scripts: { build: 'echo build' },
				dependencies: { shared: 'workspace:*' }
			})
		)
	await writeFile(
		join(root, 'packages/shared/package.json'),
		JSON.stringify({ name: 'shared', scripts: { build: 'echo shared' } })
	)
	return root
}

describe('App directory', () => {
	it('normalizes legacy and empty root values', () => {
		expect([null, undefined, '', '/', '  '].map(parseAppDirectory)).toEqual([
			null,
			null,
			null,
			null,
			null
		])
		expect(parseAppDirectory(' apps/web/ ')).toBe('apps/web')
	})
	it.each(['../app', '/apps/a', 'apps/../a', 'apps//a', 'apps/./a', 'C:\\app', 'apps/a\nfile', 4])(
		'rejects unsafe input %s',
		(value) => {
			expect(() => parseAppDirectory(value)).toThrow()
		}
	)
	it('validates existence and symlink containment', async () => {
		const root = await fixture()
		expect(await resolveAppDirectory(root, 'apps/a')).toBe(await realpath(join(root, 'apps/a')))
		await expect(resolveAppDirectory(root, 'apps/missing')).rejects.toThrow(
			'does not exist on this branch'
		)
		await symlink(tmpdir(), join(root, 'escape'))
		await expect(resolveAppDirectory(root, 'escape')).rejects.toThrow('stay inside')
	})
	it.each([false, true])(
		'builds only the selected app and shared dependency (pnpm: %s)',
		async (pnpm) => {
			const root = await fixture(pnpm)
			const workspace = await resolveWorkspace(root, 'apps/a')
			expect(workspace.root).toBe('')
			expect(workspace.buildPackages.map((pkg) => pkg.path)).toEqual(['packages/shared', 'apps/a'])
			const output = appTemplate(
				getFrameworkConfig('sveltekit'),
				{ frameworkId: 'sveltekit', tier: 'node', stripBuildEnv: true },
				workspace,
				{
					packageManager: pnpm ? 'pnpm' : 'bun',
					lockfile: pnpm ? 'pnpm-lock.yaml' : 'bun.lock',
					lockfilesFound: [],
					warnings: []
				}
			)
			expect(output.indexOf('COPY . .')).toBeLessThan(output.indexOf('install --frozen-lockfile'))
			expect(output).toContain('WORKDIR "/app/apps/a"')
			expect(output).toContain("RUN : > '/app/apps/a/.env'")
			expect(output).toContain('COPY --from=output /app /app')
			expect(output).not.toContain("--filter 'b'")
		}
	)
	it('installs a standalone subdirectory app without requiring a lockfile', () => {
		const content = generateDockerfile({
			frameworkId: 'generic',
			tier: 'node',
			workspace: { root: 'service', app: 'service', buildPackages: [] },
			packageManagerDetection: {
				packageManager: 'npm',
				lockfile: null,
				lockfilesFound: [],
				warnings: []
			}
		}).content
		expect(content).toContain('RUN npm install')
		expect(content).toContain('WORKDIR "/app/service"')
	})

	it('preserves the legacy Dockerfile when optional app configuration is absent', () => {
		const options = {
			frameworkId: 'sveltekit' as const,
			tier: 'node' as const,
			lockfile: 'bun.lock' as const
		}
		expect(generateDockerfile(options).content).toContain(
			'COPY package.json bun.lockb* bun.lock* ./'
		)
		expect(generateDockerfile(options).content).toContain('WORKDIR /app')
		expect(generateDockerfile(options).content).not.toContain('apps/')
	})
	it.each(['bun', 'node'] as const)(
		'preserves the selected %s runtime for workspace builds',
		(runtime) => {
			const content = generateDockerfile({
				frameworkId: 'elysia',
				tier: 'node',
				runtime,
				workspace: { root: '', app: 'apps/api', buildPackages: [] },
				packageManagerDetection: {
					packageManager: 'bun',
					lockfile: 'bun.lock',
					lockfilesFound: [],
					warnings: []
				}
			}).content
			expect(content).toContain(
				`FROM ${runtime === 'bun' ? `oven/bun:${BUN_VERSION}-debian` : 'node:22-slim'} AS runtime`
			)
			expect(content).toContain('ENV PORT=3000')
			expect(content).toContain(`${runtime} dist/index.js`)
		}
	)

	it('preserves Node 24 and the app-relative Adonis runtime directory', () => {
		const content = generateDockerfile({
			frameworkId: 'adonisjs',
			tier: 'node',
			workspace: { root: '', app: 'apps/api', buildPackages: [] },
			packageManagerDetection: {
				packageManager: 'npm',
				lockfile: 'package-lock.json',
				lockfilesFound: [],
				warnings: []
			}
		}).content
		expect(content).toContain('FROM risved-node-build:24 AS build')
		expect(content).toContain('FROM node:24-slim AS runtime')
		expect(content).toContain('WORKDIR "/app/apps/api/build"')
	})

	it('keeps the React Router server-output guard for workspace builds', () => {
		const content = generateDockerfile({
			frameworkId: 'react-router',
			tier: 'node',
			workspace: { root: '', app: 'apps/web', buildPackages: [] },
			packageManagerDetection: {
				packageManager: 'npm',
				lockfile: 'package-lock.json',
				lockfilesFound: [],
				warnings: []
			}
		}).content
		expect(content).toContain("RUN test -f 'build/server/index.js'")
	})
})
