import { describe, expect, it } from 'vitest'
import {
	buildManagedPostgresEnv,
	ensureManagedPostgres,
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
})
