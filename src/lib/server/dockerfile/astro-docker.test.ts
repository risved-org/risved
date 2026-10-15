import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { generateDockerfile } from './index'

/** Run Docker against a disposable Astro application. */
function docker(...args: string[]) {
	return execFileSync('docker', args, { encoding: 'utf8', timeout: 240000 })
}

describe.skipIf(process.env.RUN_DOCKER_RUNTIME_TESTS !== '1')('Astro Node container', () => {
	it.each(['npm', 'yarn'] as const)(
		'builds and serves SSR on port 3000 with %s production dependencies',
		packageManager => {
			const dir = mkdtempSync(join(tmpdir(), 'risved-astro-'))
			const tag = `risved-astro-test:${randomUUID()}`
			let container: string | undefined
			try {
				mkdirSync(join(dir, 'src/pages'), { recursive: true })
				writeFileSync(
					join(dir, 'package.json'),
					JSON.stringify({
						name: 'astro-runtime-fixture',
						type: 'module',
						...(packageManager === 'yarn' ? { packageManager: 'yarn@4.9.2' } : {}),
						scripts: { build: 'astro build' },
						dependencies: { astro: '7.4.0', '@astrojs/node': '11.1.8' }
					})
				)
				writeFileSync(
					join(dir, 'astro.config.mjs'),
					'import { defineConfig } from "astro/config"\nimport node from "@astrojs/node"\nexport default defineConfig({ output: "server", adapter: node({ mode: "standalone" }) })\n'
				)
				writeFileSync(join(dir, 'src/pages/index.astro'), '<h1>Astro Node works</h1>')
				if (packageManager === 'yarn') {
					writeFileSync(join(dir, '.yarnrc.yml'), 'nodeLinker: pnp\n')
				}
				const { content } = generateDockerfile({
					frameworkId: 'astro',
					tier: 'node',
					installCommand:
						packageManager === 'yarn' ? 'corepack enable && yarn install' : 'npm install',
					...(packageManager === 'yarn'
						? { lockfile: 'yarn.lock' as const, yarnVersion: 'berry' as const }
						: {})
				})
				writeFileSync(
					join(dir, 'Dockerfile'),
					content.replace('risved-node-build:22', 'node:22-slim')
				)
				docker('build', '--progress=plain', '-t', tag, dir)
				container = docker('run', '-d', '--network', 'none', tag).trim()
				const response = docker(
					'exec',
					container,
					'node',
					'-e',
					'(async () => { for (let i = 0; i < 50; i++) { try { console.log(await (await fetch("http://127.0.0.1:3000")).text()); return } catch { await new Promise(r => setTimeout(r, 100)) } } process.exit(1) })()'
				)
				expect(response).toContain('Astro Node works')
			} finally {
				if (container) docker('rm', '-f', container)
				try {
					docker('image', 'rm', tag)
				} catch {
					/* Build may have failed. */
				}
				rmSync(dir, { recursive: true, force: true })
			}
		},
		300000
	)
})
