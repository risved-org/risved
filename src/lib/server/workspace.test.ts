import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dependencyOrder, resolveWorkspace, type WorkspacePackage } from './workspace'

const directories: string[] = []
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
	)
})

/** Create workspace packages with independent runtime and development edges. */
function pkg(
	name: string,
	dependencies = {},
	devDependencies = {},
	peerDependencies = {}
): WorkspacePackage {
	return {
		path: `packages/${name}`,
		manifest: { name, dependencies, devDependencies, peerDependencies }
	}
}

describe('workspace dependency order', () => {
	it('allows a core/plugin development-peer cycle without duplicating packages', () => {
		const core = pkg('core', {}, { plugin: 'workspace:*' })
		const plugin = pkg('plugin', {}, {}, { core: 'workspace:*' })
		expect(dependencyOrder(core, [core, plugin]).map((p) => p.manifest.name)).toEqual([
			'plugin',
			'core'
		])
	})

	it('prioritizes runtime order over a development back edge', () => {
		const core = pkg('core', {}, { plugin: 'workspace:*' })
		const plugin = pkg('plugin', { core: 'workspace:*' })
		expect(dependencyOrder(core, [core, plugin])).toEqual([core, plugin])
	})

	it('allows mutual development dependencies', () => {
		const core = pkg('core', {}, { utils: 'workspace:*' })
		const utils = pkg('utils', {}, { core: 'workspace:*' })
		expect(dependencyOrder(core, [core, utils]).map((p) => p.manifest.name)).toEqual([
			'utils',
			'core'
		])
	})

	it('retains dependency-first order for acyclic builds and ignores unrelated packages', () => {
		const core = pkg('core', { shared: 'workspace:*' })
		const shared = pkg('shared')
		expect(dependencyOrder(core, [pkg('unrelated'), core, shared])).toEqual([shared, core])
	})

	it('still rejects runtime cycles, including those reached through a soft back edge', () => {
		const core = pkg('core', { plugin: 'workspace:*', utils: 'workspace:*' })
		const plugin = pkg('plugin', {}, { utils: 'workspace:*' })
		const utils = pkg('utils', { core: 'workspace:*' })
		expect(() => dependencyOrder(core, [core, plugin, utils])).toThrow(
			'Circular workspace runtime dependency'
		)
	})

	it('still reports missing workspace dependencies', () => {
		expect(() => dependencyOrder(pkg('core', { missing: 'workspace:*' }), [])).toThrow(
			'Workspace dependency missing was not found'
		)
	})
})

it.each(['package.json', 'pnpm-workspace.yaml'])(
	'normalizes leading ./, trailing / and negations from %s',
	async (configuration) => {
		const root = await mkdtemp(join(tmpdir(), 'risved-patterns-'))
		directories.push(root)
		const patterns = ['./apps/*/', './packages/*/', '!./packages/excluded/']
		await writeFile(
			join(root, 'package.json'),
			JSON.stringify({ workspaces: configuration === 'package.json' ? patterns : undefined })
		)
		if (configuration === 'pnpm-workspace.yaml') {
			await writeFile(
				join(root, configuration),
				`packages:\n${patterns.map((pattern) => `  - '${pattern}'`).join('\n')}\n`
			)
		}
		for (const [path, manifest] of [
			['apps/web', { name: 'web', dependencies: { shared: 'workspace:*' } }],
			['packages/shared', { name: 'shared' }],
			['packages/excluded', { name: 'excluded' }]
		] as const) {
			await mkdir(join(root, path), { recursive: true })
			await writeFile(join(root, path, 'package.json'), JSON.stringify(manifest))
		}
		const workspace = await resolveWorkspace(root, 'apps/web')
		expect(workspace.root).toBe('')
		expect(workspace.buildPackages.map((p) => p.path)).toEqual(['packages/shared', 'apps/web'])
		await writeFile(
			join(root, 'apps/web/package.json'),
			JSON.stringify({ name: 'web', dependencies: { excluded: 'workspace:*' } })
		)
		await expect(resolveWorkspace(root, 'apps/web')).rejects.toThrow(
			'Workspace dependency excluded was not found'
		)
	}
)
