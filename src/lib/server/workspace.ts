import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { minimatch } from 'minimatch'
import { parse } from 'yaml'
import { parseAppDirectory } from './app-directory'

interface Manifest {
	name?: string
	workspaces?: string[] | { packages?: string[] }
	scripts?: Record<string, string>
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	optionalDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
}

export interface WorkspacePackage {
	path: string
	manifest: Manifest
}

export interface AppWorkspace {
	/** All paths are relative to the repository root. */
	root: string
	app: string
	buildPackages: WorkspacePackage[]
}

/** Read an optional manifest without hiding malformed JSON. */
async function manifestAt(path: string): Promise<Manifest | null> {
	try {
		return JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
		throw error
	}
}

/** Read workspace patterns from either package.json form or pnpm configuration. */
async function patternsAt(path: string, manifest: Manifest | null): Promise<string[]> {
	const workspaces = manifest?.workspaces
	let patterns = Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? [])
	try {
		const config = parse(await readFile(join(path, 'pnpm-workspace.yaml'), 'utf8'))
		if (Array.isArray(config?.packages)) patterns = config.packages
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	if (!patterns.every(pattern => typeof pattern === 'string')) {
		throw new Error('Workspace paths must be strings')
	}
	return patterns
}

/** Find workspace packages without following directory symlinks or dependency trees. */
async function findPackages(root: string, patterns: string[]): Promise<WorkspacePackage[]> {
	const packages: WorkspacePackage[] = []
	const include = patterns.filter(pattern => !pattern.startsWith('!'))
	const exclude = patterns
		.filter(pattern => pattern.startsWith('!'))
		.map(pattern => pattern.slice(1))
	async function visit(path: string) {
		for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules')
				continue
			const child = path ? `${path}/${entry.name}` : entry.name
			if (exclude.some(pattern => minimatch(child, pattern))) continue
			if (include.some(pattern => minimatch(child, pattern))) {
				const manifest = await manifestAt(join(root, child))
				if (manifest) packages.push({ path: child, manifest })
			}
			await visit(child)
		}
	}
	await visit('')
	return packages
}

/** Resolve local dependencies in build order, never including unrelated applications. */
export function dependencyOrder(
	app: WorkspacePackage,
	packages: WorkspacePackage[]
): WorkspacePackage[] {
	const byName = new Map(
		packages.filter(pkg => pkg.manifest.name).map(pkg => [pkg.manifest.name!, pkg])
	)
	const visited = new Set<string>()
	const visiting = new Set<string>()
	const ordered: WorkspacePackage[] = []
	function visit(pkg: WorkspacePackage) {
		if (visited.has(pkg.path)) return
		if (visiting.has(pkg.path)) throw new Error(`Circular workspace dependency at ${pkg.path}`)
		visiting.add(pkg.path)
		const dependencies = {
			...pkg.manifest.peerDependencies,
			...pkg.manifest.devDependencies,
			...pkg.manifest.optionalDependencies,
			...pkg.manifest.dependencies
		}
		for (const [name, version] of Object.entries(dependencies)) {
			let dependency = byName.get(name)
			if (version.startsWith('file:') || version.startsWith('link:')) {
				const target = join(pkg.path, version.slice(version.indexOf(':') + 1))
				dependency = packages.find(candidate => candidate.path === target)
			}
			if (dependency) visit(dependency)
			else if (version.startsWith('workspace:'))
				throw new Error(
					`Workspace dependency ${name} was not found. Check the workspace manifests at the workspace root.`
				)
		}
		visiting.delete(pkg.path)
		visited.add(pkg.path)
		ordered.push(pkg)
	}
	visit(app)
	return ordered
}

/** Locate the nearest enclosing workspace for an explicitly selected application. */
export async function resolveWorkspace(repo: string, appPath: string): Promise<AppWorkspace> {
	const app = parseAppDirectory(appPath)!
	let directory = dirname(join(repo, app))
	while (directory === repo || directory.startsWith(`${repo}/`)) {
		const patterns = await patternsAt(directory, await manifestAt(directory))
		if (patterns.length) {
			const packages = await findPackages(directory, patterns)
			const selected = packages.find(pkg => pkg.path === relative(directory, join(repo, app)))
			if (selected) {
				const root = relative(repo, directory)
				return {
					root,
					app,
					buildPackages: dependencyOrder(selected, packages).map(pkg => ({
						...pkg,
						path: root ? `${root}/${pkg.path}` : pkg.path
					}))
				}
			}
		}
		if (directory === repo) break
		directory = dirname(directory)
	}
	const manifest = await manifestAt(join(repo, app))
	return { root: app, app, buildPackages: manifest ? [{ path: app, manifest }] : [] }
}
