import { describe, it, expect } from 'vitest'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { resolveWorkspace } from './workspace'
import { detectPackageManager } from './detect-package-manager'
import { generateDockerfile } from './dockerfile'

const execFile = promisify(execFileCallback)

/** Exercise actual workspace installs, dependency build ordering, and runtime links in Docker. */
describe('workspace build integration', () => {
	it.runIf(process.env.RISVED_DOCKER_TESTS === '1').each(['bun', 'pnpm'])(
		'%s runs only the app and shared build and resolves runtime dependencies',
		async manager => {
			const root = await mkdtemp(join(process.cwd(), '.risved-build-fixture-'))
			const image = `risved-app-fixture-${manager}:${Date.now()}`
			try {
				for (const path of ['apps/a', 'apps/b', 'packages/shared'])
					await mkdir(join(root, path), { recursive: true })
				await writeFile(
					join(root, 'package.json'),
					JSON.stringify({ name: 'fixture', private: true, workspaces: ['apps/*', 'packages/*'] })
				)
				if (manager === 'pnpm')
					await writeFile(
						join(root, 'pnpm-workspace.yaml'),
						'packages:\n  - apps/*\n  - packages/*\n'
					)
				await writeFile(
					join(root, 'packages/shared/package.json'),
					JSON.stringify({
						name: 'shared',
						version: '1.0.0',
						main: 'output.cjs',
						scripts: { build: 'node build.cjs' }
					})
				)
				await writeFile(
					join(root, 'packages/shared/build.cjs'),
					`require('fs').writeFileSync('output.cjs', 'module.exports = "shared works"')`
				)
				await writeFile(
					join(root, 'apps/a/package.json'),
					JSON.stringify({
						name: 'app-a',
						scripts: { build: 'node build.cjs' },
						dependencies: { shared: 'workspace:*' }
					})
				)
				await writeFile(
					join(root, 'apps/a/build.cjs'),
					`if (require('shared') !== 'shared works') throw new Error('dependency not built'); require('fs').mkdirSync('build', { recursive: true }); require('fs').writeFileSync('build/index.js', 'console.log(require("shared"))')`
				)
				await writeFile(
					join(root, 'apps/b/package.json'),
					JSON.stringify({
						name: 'app-b',
						scripts: { build: 'exit 77' },
						dependencies: { shared: 'workspace:*' }
					})
				)
				await writeFile(join(root, 'apps/a/.env'), 'PRIVATE_TEST_VALUE=must-not-ship')
				await writeFile(join(root, '.dockerignore'), '**/node_modules\nDockerfile\n')
				await execFile(
					'docker',
					[
						'run',
						'--rm',
						'-v',
						`${root}:/fixture`,
						'-w',
						'/fixture',
						'risved-node-build:22',
						manager,
						'install',
						'--lockfile-only'
					],
					{ timeout: 120000 }
				)
				const workspace = await resolveWorkspace(root, 'apps/a')
				const pm = await detectPackageManager(root)
				expect(pm.packageManager).toBe(manager)
				const dockerfile = generateDockerfile({
					frameworkId: 'sveltekit',
					tier: 'node',
					stripBuildEnv: true,
					workspace,
					packageManagerDetection: pm
				}).content
				await writeFile(join(root, 'Dockerfile'), dockerfile)
				await execFile('docker', ['build', '-t', image, root], {
					timeout: 180000,
					maxBuffer: 8 * 1024 * 1024
				})
				const result = await execFile('docker', ['run', '--rm', image], { timeout: 30000 })
				expect(result.stdout.trim()).toBe('shared works')
				const env = await execFile('docker', ['run', '--rm', image, 'cat', '.env'])
				expect(env.stdout).toBe('')
			} finally {
				await execFile('docker', ['image', 'rm', '-f', image]).catch(() => {})
				await rm(root, { recursive: true, force: true })
			}
		},
		300000
	)

	it('migrates an existing project without changing its source or commands', async () => {
		const client = createClient({ url: ':memory:' })
		try {
			await client.executeMultiple(
				"CREATE TABLE projects (id TEXT PRIMARY KEY, repo_url TEXT, branch TEXT, build_command TEXT); INSERT INTO projects VALUES ('old', 'https://example.com/repo', 'main', 'bun run build');"
			)
			const before = (await client.execute('SELECT * FROM projects')).rows[0]
			await client.executeMultiple(await readFile('drizzle/0010_app_directory.sql', 'utf8'))
			const after = (await client.execute('SELECT * FROM projects')).rows[0]
			expect(after).toEqual({ ...before, root_directory: null })
		} finally {
			client.close()
		}
	})
})
