import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { generateDockerfile } from './index'

/** Execute Docker against disposable fixtures only. */
function docker(...args: string[]) {
	return execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 })
}

describe.skipIf(process.env.RUN_DOCKER_RUNTIME_TESTS !== '1')('Bun runtime containers', () => {
	it.each(['sveltekit', 'generic'] as const)(
		'serves a %s output fixture using the generated start command',
		frameworkId => {
			const dir = mkdtempSync(join(tmpdir(), 'risved-bun-'))
			const tag = `risved-bun-test:${randomUUID()}`
			let container: string | undefined
			try {
				writeFileSync(
					join(dir, 'package.json'),
					JSON.stringify({
						name: 'runtime-fixture',
						version: '1.0.0',
						type: 'module',
						scripts: { build: 'node build.js' }
					})
				)
				writeFileSync(
					join(dir, 'index.js'),
					'import { Database } from "bun:sqlite"\nconst db = new Database(":memory:")\nimport { createServer } from "node:http"\ncreateServer((req, res) => res.end(db.query("SELECT 1 AS ok").get().ok === 1 ? "bun-ok" : "failed")).listen(8000, "0.0.0.0")\n'
				)
				writeFileSync(
					join(dir, 'build.js'),
					'import { Database } from "bun:sqlite"\nimport { mkdirSync, copyFileSync } from "node:fs"\nnew Database(":memory:").query("SELECT 1").get()\nmkdirSync("build", { recursive: true })\ncopyFileSync("index.js", "build/index.js")\n'
				)
				const { content } = generateDockerfile({
					frameworkId,
					tier: 'node',
					runtime: 'bun',
					installCommand: 'mkdir -p node_modules'
				})
				// Fixtures need only Node/npm, not the production builder's other package managers.
				writeFileSync(
					join(dir, 'Dockerfile'),
					content.replace('risved-node-build:22', 'node:22-slim')
				)
				docker('build', '-q', '-t', tag, dir)
				container = docker('run', '-d', '--network', 'none', tag).trim()
				const response = docker(
					'exec',
					container,
					'bun',
					'-e',
					'for (let i = 0; i < 50; i++) { try { console.log(await (await fetch("http://127.0.0.1:8000")).text()); process.exit(0) } catch { await Bun.sleep(100) } } process.exit(1)'
				)
				expect(response.trim()).toBe('bun-ok')
			} finally {
				if (container) docker('rm', '-f', container)
				try {
					docker('image', 'rm', tag)
				} catch {
					/* build may have failed */
				}
				rmSync(dir, { recursive: true, force: true })
			}
		},
		180000
	)
})
