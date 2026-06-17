import { randomBytes } from 'node:crypto'
import type { CommandRunner } from './types'

const DOCKER_NETWORK = 'risved'
const POSTGRES_IMAGE = process.env.RISVED_POSTGRES_IMAGE ?? 'postgres:17-alpine'

export interface ManagedPostgresConfig {
	projectId: string
	containerName: string
	volumeName: string
	database: string
	username: string
	network: string
	image: string
}

/**
 * Generate the Docker container name for a project's adjacent Postgres.
 */
export function managedPostgresContainerName(projectId: string): string {
	return `risved-postgres-${dockerSafeName(projectId)}`
}

/**
 * Generate the Docker volume name for a project's adjacent Postgres data.
 */
export function managedPostgresVolumeName(projectId: string): string {
	return `risved-${dockerSafeName(projectId)}-postgres`
}

/**
 * Build the stable container, volume, user, and database names for a project.
 */
export function managedPostgresConfig(projectId: string): ManagedPostgresConfig {
	const identifier = sqlSafeIdentifier(projectId)

	return {
		projectId,
		containerName: managedPostgresContainerName(projectId),
		volumeName: managedPostgresVolumeName(projectId),
		database: identifier,
		username: identifier,
		network: DOCKER_NETWORK,
		image: POSTGRES_IMAGE
	}
}

/**
 * Build database environment variables exposed to the deployed app.
 */
export function buildManagedPostgresEnv(
	config: ManagedPostgresConfig,
	password: string
): Record<string, string> {
	const connectionUrl = `postgresql://${encodeURIComponent(config.username)}:${encodeURIComponent(password)}@${config.containerName}:5432/${encodeURIComponent(config.database)}`

	return {
		DATABASE_URL: connectionUrl,
		POSTGRES_URL: connectionUrl,
		POSTGRES_HOST: config.containerName,
		POSTGRES_PORT: '5432',
		POSTGRES_DB: config.database,
		POSTGRES_USER: config.username,
		POSTGRES_PASSWORD: password,
		PGHOST: config.containerName,
		PGPORT: '5432',
		PGDATABASE: config.database,
		PGUSER: config.username,
		PGPASSWORD: password
	}
}

/**
 * Generate a high-entropy password for a managed Postgres database.
 */
export function generatePostgresPassword(): string {
	return randomBytes(32).toString('base64url')
}

/**
 * Ensure the project's adjacent Postgres container exists and is accepting connections.
 */
export async function ensureManagedPostgres(
	runner: CommandRunner,
	config: ManagedPostgresConfig,
	password: string,
	options: { onLine?: (line: string) => void, timeoutMs?: number, intervalMs?: number } = {}
): Promise<{ success: boolean, started: boolean, error?: string }> {
	const running = await isContainerRunning(runner, config.containerName)
	let started = false

	if (running === true) {
		options.onLine?.(`Managed Postgres already running: ${config.containerName}`)
	} else if (running === false) {
		options.onLine?.(`Starting managed Postgres: ${config.containerName}`)
		const start = await runner.exec('docker', ['start', config.containerName])
		if (start.exitCode !== 0) {
			return { success: false, started, error: start.stderr || start.stdout }
		}
		started = true
	} else {
		options.onLine?.(`Creating managed Postgres: ${config.containerName}`)
		const create = await runner.exec('docker', [
			'run',
			'-d',
			'--name',
			config.containerName,
			'--network',
			config.network,
			'--restart',
			'unless-stopped',
			'--label',
			`risved.project=${config.projectId}`,
			'--label',
			'risved.service=postgres',
			'-v',
			`${config.volumeName}:/var/lib/postgresql/data`,
			'-e',
			`POSTGRES_DB=${config.database}`,
			'-e',
			`POSTGRES_USER=${config.username}`,
			'-e',
			`POSTGRES_PASSWORD=${password}`,
			config.image
		])
		if (create.exitCode !== 0) {
			return { success: false, started, error: create.stderr || create.stdout }
		}
		started = true
	}

	const ready = await waitForManagedPostgres(
		runner,
		config,
		options.timeoutMs ?? 60000,
		options.intervalMs ?? 1000
	)
	if (!ready) {
		return { success: false, started, error: 'Postgres did not become ready in time' }
	}

	return { success: true, started }
}

/**
 * Poll pg_isready inside the Postgres container until it accepts connections.
 */
async function waitForManagedPostgres(
	runner: CommandRunner,
	config: ManagedPostgresConfig,
	timeoutMs: number,
	intervalMs: number
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs

	while (Date.now() < deadline) {
		const result = await runner.exec('docker', [
			'exec',
			config.containerName,
			'pg_isready',
			'-U',
			config.username,
			'-d',
			config.database
		])
		if (result.exitCode === 0) return true
		await new Promise((resolve) => setTimeout(resolve, intervalMs))
	}

	return false
}

/**
 * Inspect a container and return true/false for running, or null when missing.
 */
async function isContainerRunning(
	runner: CommandRunner,
	containerName: string
): Promise<boolean | null> {
	const result = await runner.exec('docker', [
		'inspect',
		'--format',
		'{{.State.Running}}',
		containerName
	])
	if (result.exitCode !== 0) return null
	return result.stdout.trim() === 'true'
}

function sqlSafeIdentifier(projectId: string): string {
	const suffix = projectId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 56)
	return `risved_${suffix || 'project'}`
}

function dockerSafeName(value: string): string {
	return value.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 180)
}
