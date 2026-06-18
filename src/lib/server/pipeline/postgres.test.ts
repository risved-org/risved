import { describe, expect, it } from 'vitest'
import {
	buildManagedPostgresEnv,
	ensureManagedPostgres,
	generatePostgresPassword,
	managedPostgresConfig,
	managedPostgresContainerName,
	managedPostgresVolumeName
} from './postgres'
import type { CommandRunner } from './types'

describe('managed Postgres', () => {
	it('derives container and volume names from project id', () => {
		const projectId = 'proj-123'

		expect(managedPostgresContainerName(projectId)).toBe('risved-postgres-proj-123')
		expect(managedPostgresVolumeName(projectId)).toBe('risved-proj-123-postgres')
	})

	it('builds app database env vars for the owned container', () => {
		const config = managedPostgresConfig('proj-123')
		const env = buildManagedPostgresEnv(config, 'secret')

		expect(env.DATABASE_URL).toBe(
			'postgresql://risved_proj123:secret@risved-postgres-proj-123:5432/risved_proj123'
		)
		expect(env.POSTGRES_HOST).toBe('risved-postgres-proj-123')
		expect(env.POSTGRES_DB).toBe('risved_proj123')
		expect(env.PGUSER).toBe('risved_proj123')
	})

	it('creates a labeled Postgres container when missing', async () => {
		const calls: string[][] = []
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args])
				const joined = `${cmd} ${args.join(' ')}`
				if (joined.includes('docker inspect')) {
					return { exitCode: 1, stdout: '', stderr: 'No such container' }
				}
				if (joined.includes('docker exec')) {
					return { exitCode: 0, stdout: 'accepting connections', stderr: '' }
				}
				return { exitCode: 0, stdout: 'containerid', stderr: '' }
			}
		}

		const config = managedPostgresConfig('proj-123')
		const result = await ensureManagedPostgres(runner, config, 'secret', { timeoutMs: 50 })

		expect(result.success).toBe(true)
		const runCall = calls.find((call) => call.join(' ').includes('docker run'))
		expect(runCall).toContain('--label')
		expect(runCall).toContain('risved.project=proj-123')
		expect(runCall).toContain('risved.service=postgres')
		expect(runCall).toContain('risved-proj-123-postgres:/var/lib/postgresql/data')
	})

	it('reports already running when container is running', async () => {
		const lines: string[] = []
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`
				if (joined.includes('docker inspect')) {
					return { exitCode: 0, stdout: 'true\n', stderr: '' }
				}
				if (joined.includes('docker exec')) {
					return { exitCode: 0, stdout: 'accepting connections', stderr: '' }
				}
				return { exitCode: 0, stdout: '', stderr: '' }
			}
		}

		const config = managedPostgresConfig('proj-123')
		const result = await ensureManagedPostgres(runner, config, 'secret', {
			onLine: (line) => lines.push(line),
			timeoutMs: 200
		})

		expect(result.success).toBe(true)
		expect(result.started).toBe(false)
		expect(lines.some((l) => l.includes('already running'))).toBe(true)
	})

	it('starts an existing stopped container', async () => {
		const calls: string[][] = []
		const runner: CommandRunner = {
			async exec(cmd, args) {
				calls.push([cmd, ...args])
				const joined = `${cmd} ${args.join(' ')}`
				if (joined.includes('docker inspect')) {
					return { exitCode: 0, stdout: 'false\n', stderr: '' }
				}
				if (joined.includes('docker exec')) {
					return { exitCode: 0, stdout: 'accepting connections', stderr: '' }
				}
				return { exitCode: 0, stdout: '', stderr: '' }
			}
		}

		const config = managedPostgresConfig('proj-123')
		const result = await ensureManagedPostgres(runner, config, 'secret', {
			timeoutMs: 200,
			intervalMs: 10
		})

		expect(result.success).toBe(true)
		expect(result.started).toBe(true)
		const startCall = calls.find((call) => call.join(' ').includes('docker start'))
		expect(startCall).toBeDefined()
		expect(startCall).toContain('risved-postgres-proj-123')
	})

	it('returns failure when docker start fails', async () => {
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`
				if (joined.includes('docker inspect')) {
					return { exitCode: 0, stdout: 'false\n', stderr: '' }
				}
				if (joined.includes('docker start')) {
					return { exitCode: 1, stdout: '', stderr: 'container start failed' }
				}
				return { exitCode: 0, stdout: '', stderr: '' }
			}
		}

		const config = managedPostgresConfig('proj-123')
		const result = await ensureManagedPostgres(runner, config, 'secret')

		expect(result.success).toBe(false)
		expect(result.error).toContain('container start failed')
	})

	it('returns failure when docker run fails during create', async () => {
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`
				if (joined.includes('docker inspect')) {
					return { exitCode: 1, stdout: '', stderr: 'No such container' }
				}
				if (joined.includes('docker run')) {
					return { exitCode: 1, stdout: '', stderr: 'image pull failed' }
				}
				return { exitCode: 0, stdout: '', stderr: '' }
			}
		}

		const config = managedPostgresConfig('proj-123')
		const result = await ensureManagedPostgres(runner, config, 'secret')

		expect(result.success).toBe(false)
		expect(result.error).toContain('image pull failed')
	})

	it('returns failure when postgres does not become ready within timeout', async () => {
		const runner: CommandRunner = {
			async exec(cmd, args) {
				const joined = `${cmd} ${args.join(' ')}`
				if (joined.includes('docker inspect')) {
					return { exitCode: 1, stdout: '', stderr: 'No such container' }
				}
				if (joined.includes('docker exec')) {
					return { exitCode: 1, stdout: '', stderr: 'connection refused' }
				}
				return { exitCode: 0, stdout: '', stderr: '' }
			}
		}

		const config = managedPostgresConfig('proj-123')
		const result = await ensureManagedPostgres(runner, config, 'secret', {
			timeoutMs: 50,
			intervalMs: 10
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain('did not become ready')
	})

	it('generatePostgresPassword returns a unique random string each call', () => {
		const p1 = generatePostgresPassword()
		const p2 = generatePostgresPassword()
		expect(typeof p1).toBe('string')
		expect(p1.length).toBeGreaterThan(20)
		expect(p1).not.toBe(p2)
	})
})
