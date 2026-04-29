import { db } from '$lib/server/db'
import { deployments } from '$lib/server/db/schema'
import { inArray } from 'drizzle-orm'
import { getSetting, setSetting } from '$lib/server/settings'
import type { UpdateCheckerConfig, UpdateInfo, VersionManifest, PreflightResult } from './types'

const DEFAULT_CONFIG: UpdateCheckerConfig = {
	intervalMs: 60 * 60 * 1000,
	versionUrl: 'https://risved.com/version.json',
	installDir: '/opt/risved'
}

/**
 * Compares two semver strings. Returns:
 *  -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareSemver(a: string, b: string): number {
	const pa = a.replace(/^v/, '').split('.').map(Number)
	const pb = b.replace(/^v/, '').split('.').map(Number)
	for (let i = 0; i < 3; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
		if (diff !== 0) return diff > 0 ? 1 : -1
	}
	return 0
}

/**
 * UpdateChecker periodically checks for new Risved versions
 * and provides the update/restart mechanism.
 */
export class UpdateChecker {
	private config: UpdateCheckerConfig
	private timer: ReturnType<typeof setInterval> | null = null
	private updating = false

	constructor(config: Partial<UpdateCheckerConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/** Start periodic update checks. */
	start(): void {
		if (this.timer) return
		this.timer = setInterval(() => this.checkForUpdates(), this.config.intervalMs)
		/* Run initial check after 10 seconds */
		setTimeout(() => this.checkForUpdates(), 10_000)
	}

	/** Stop periodic checks. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
	}

	isRunning(): boolean {
		return this.timer !== null
	}

	/** Get the current version from package.json. */
	async getCurrentVersion(): Promise<string> {
		/* Always read from package.json — try install dir first, then cwd */
		const { readFileSync } = await import('node:fs')
		const { resolve } = await import('node:path')
		const candidates = [
			resolve(this.config.installDir, 'package.json'),
			resolve(process.cwd(), 'package.json')
		]

		for (const pkgPath of candidates) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
				if (pkg.version) return pkg.version
			} catch {
				/* try next candidate */
			}
		}

		return '0.0.1'
	}

	/** Fetch the latest version manifest from the remote URL. */
	async fetchVersionManifest(): Promise<VersionManifest | null> {
		try {
			const res = await fetch(this.config.versionUrl, {
				signal: AbortSignal.timeout(10_000)
			})
			if (!res.ok) return null
			return await res.json() as VersionManifest
		} catch {
			return null
		}
	}

	/** Check for updates and store the result in settings. */
	async checkForUpdates(): Promise<UpdateInfo> {
		const currentVersion = await this.getCurrentVersion()
		const manifest = await this.fetchVersionManifest()
		const now = new Date().toISOString()

		await setSetting('last_update_check', now)
		await setSetting('last_update_error', '')

		if (!manifest) {
			return {
				currentVersion,
				latestVersion: null,
				updateAvailable: false,
				releaseNotes: null,
				checkedAt: now,
				error: 'Could not reach update server'
			}
		}

		const updateAvailable = compareSemver(manifest.version, currentVersion) > 0
		if (updateAvailable) {
			await setSetting('update_available_version', manifest.version)
			await setSetting('update_release_notes', manifest.releaseNotes)
			await setSetting('update_min_version', manifest.minVersion)
		} else {
			await setSetting('update_available_version', '')
			await setSetting('update_release_notes', '')
		}

		return {
			currentVersion,
			latestVersion: manifest.version,
			updateAvailable,
			releaseNotes: manifest.releaseNotes,
			checkedAt: now,
			error: null
		}
	}

	/** Get cached update info without hitting the network. */
	async getCachedUpdateInfo(): Promise<UpdateInfo> {
		const currentVersion = await this.getCurrentVersion()
		const latestVersion = await getSetting('update_available_version')
		const checkedAt = await getSetting('last_update_check')
		const releaseNotes = await getSetting('update_release_notes')
		const lastError = await getSetting('last_update_error')

		return {
			currentVersion,
			latestVersion: latestVersion || null,
			updateAvailable: !!latestVersion && compareSemver(latestVersion, currentVersion) > 0,
			releaseNotes: releaseNotes || null,
			checkedAt: checkedAt || null,
			error: lastError || null
		}
	}

	/** Run pre-flight checks before updating. */
	async preflightCheck(): Promise<PreflightResult> {
		/* Check for active builds */
		const activeBuilds = await db
			.select()
			.from(deployments)
			.where(
				inArray(deployments.status, ['cloning', 'detecting', 'building', 'starting'])
			)

		if (activeBuilds.length > 0) {
			return { ok: false, reason: 'Wait for active builds to finish before updating.' }
		}

		/* Check disk space */
		try {
			const { execSync } = await import('node:child_process')
			const output = execSync("df -k / | tail -1 | awk '{print $4}'", { encoding: 'utf8' })
			const freeKb = parseInt(output.trim(), 10)
			if (!isNaN(freeKb) && freeKb < 500_000) {
				return { ok: false, reason: 'Less than 500 MB disk space available. Free up space first.' }
			}
		} catch {
			/* disk check failed, proceed anyway */
		}

		/* Check minimum version compatibility */
		const minVersion = await getSetting('update_min_version')
		const currentVersion = await this.getCurrentVersion()
		if (minVersion && compareSemver(currentVersion, minVersion) < 0) {
			return {
				ok: false,
				reason: `Current version ${currentVersion} is too old for a direct update. Minimum required: ${minVersion}. Please update manually.`
			}
		}

		return { ok: true }
	}

	/** Pull the new Docker image. */
	async pullUpdate(version: string): Promise<void> {
		const { execFile } = await import('node:child_process')
		const { promisify } = await import('node:util')
		const execFileAsync = promisify(execFile)

		const tag = version.replace(/^v/, '')
		const image = `ghcr.io/risved-org/risved:${tag}`
		await execFileAsync('docker', ['pull', image], { timeout: 300_000 })
	}

	/** Replace the running container with the new image. */
	async restartControlPlane(targetVersion: string): Promise<void> {
		const { execFile } = await import('node:child_process')
		const { promisify } = await import('node:util')
		const execFileAsync = promisify(execFile)

		await setSetting('risved_version', targetVersion)
		await setSetting('update_available_version', '')
		await setSetting('last_update_error', '')

		const containerName = 'risved-control'
		const tag = targetVersion.replace(/^v/, '')
		const image = `ghcr.io/risved-org/risved:${tag}`

		/* Read the current container's config so we can recreate it */
		const { stdout } = await execFileAsync('docker', ['inspect', containerName])
		const info = JSON.parse(stdout)[0]
		const config = info.Config
		const hostConfig = info.HostConfig

		/* Extract env vars, port bindings, volumes, and network */
		const env = config.Env || []
		const portBindings = hostConfig.PortBindings || {}
		const binds = hostConfig.Binds || []
		const networkName = Object.keys(info.NetworkSettings?.Networks || {})[0] || 'risved'

		/* Build docker run args for the new container */
		const runArgs: string[] = ['run', '-d', '--name', containerName, '--network', networkName, '--restart', 'unless-stopped']

		for (const e of env) {
			runArgs.push('-e', e)
		}

		for (const bind of binds) {
			runArgs.push('-v', bind)
		}

		for (const [containerPort, hostBindings] of Object.entries(portBindings)) {
			const port = containerPort.replace('/tcp', '').replace('/udp', '')
			for (const binding of hostBindings as Array<{ HostPort: string }>) {
				runArgs.push('-p', `${binding.HostPort}:${port}`)
			}
		}

		runArgs.push(image)

		/* Write the docker run command to a script file inside the shared
		   data volume, so we avoid shell escaping issues with env vars.
		   The helper container mounts the same volume to read the script. */
		const { writeFile } = await import('node:fs/promises')
		const scriptPath = '/app/data/.risved-update.sh'
		const shellLines = [
			'#!/bin/sh',
			'set -e',
			'sleep 1',
			`docker stop ${containerName} || true`,
			`docker rm ${containerName} || true`,
			`docker ${runArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`,
			`rm -f /data/.risved-update.sh`
		]
		await writeFile(scriptPath, shellLines.join('\n'), { mode: 0o755 })

		/* Find the host path for /app/data from our own bind mounts */
		const dataBind = binds.find((b: string) => b.endsWith(':/app/data'))
		const dataHostPath = dataBind ? dataBind.split(':')[0] : '/opt/risved/data'

		/* Spawn a helper container that runs the script */
		await execFileAsync('docker', [
			'run', '-d', '--rm',
			'-v', '/var/run/docker.sock:/var/run/docker.sock',
			'-v', `${dataHostPath}:/data`,
			'docker:cli', 'sh', '/data/.risved-update.sh'
		], { timeout: 10_000 })
	}

	/** Run the full update process in the background. */
	async performUpdate(targetVersion: string): Promise<void> {
		if (this.updating) {
			throw new Error('An update is already in progress')
		}
		this.updating = true

		try {
			await setSetting('update_status', 'pulling')
			await this.pullUpdate(targetVersion)

			await setSetting('update_status', 'restarting')
			await this.restartControlPlane(targetVersion)
		} catch (error) {
			this.updating = false
			const message = error instanceof Error ? error.message : String(error)
			await setSetting('last_update_error', message)
			await setSetting('update_status', '')
			throw error
		}
	}

	isUpdating(): boolean {
		return this.updating
	}
}

/* Singleton */
let instance: UpdateChecker | null = null

export function getUpdateChecker(config?: Partial<UpdateCheckerConfig>): UpdateChecker {
	if (!instance) {
		instance = new UpdateChecker(config)
	}
	return instance
}
