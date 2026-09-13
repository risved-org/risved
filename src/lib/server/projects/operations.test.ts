import './test-fixtures'
import { describe, expect, it } from 'vitest'
import { deployProject } from './deploy'
import { setProjectEnv } from './env'
import { rollbackProject } from './rollback'
import { mocks, project, queueSelects } from './test-fixtures'
import { ServiceError } from './types'

describe('deployProject', () => {
	it('starts a deployment and returns immediately', async () => {
		/* project lookup, then the running-deployment check */
		queueSelects([project], [])

		const result = await deployProject('p-1')

		expect(result.status).toBe('running')
		expect(result.terminal).toBe(false)
		expect(result.deploymentId).toMatch(/^[0-9a-f-]{36}$/)
		expect(mocks.runPipeline).toHaveBeenCalledOnce()
	})

	it('refuses to stack a second build, naming the running one', async () => {
		queueSelects([project], [{ id: 'd-running', status: 'running' }])

		const error = await deployProject('p-1').catch((e) => e as ServiceError)

		expect((error as ServiceError).code).toBe('deploy_in_progress')
		expect((error as ServiceError).data.deploymentId).toBe('d-running')
		expect(mocks.runPipeline).not.toHaveBeenCalled()
	})

	it('queues anyway when the caller allows it', async () => {
		queueSelects([project])

		await expect(deployProject('p-1', { allowConcurrent: true })).resolves.toMatchObject({
			status: 'running'
		})
		expect(mocks.runPipeline).toHaveBeenCalledOnce()
	})

	it('passes ref through as the checkout ref', async () => {
		queueSelects([{ ...project, runtime: 'bun' }], [])

		await deployProject('p-1', { ref: 'abc1234' })

		expect(mocks.runPipeline.mock.calls[0][0]).toMatchObject({
			checkoutRef: 'abc1234',
			runtime: 'bun'
		})
	})

	it('reports not_found for an unknown project', async () => {
		queueSelects([], [])

		await expect(deployProject('nope')).rejects.toMatchObject({ code: 'not_found' })
	})
})

describe('rollbackProject', () => {
	const target = {
		id: 'd-old',
		projectId: 'p-1',
		status: 'live',
		imageTag: 'img:1',
		commitSha: 'a'
	}

	it('redeploys a superseded image with managed Postgres settings', async () => {
		queueSelects(
			[{ ...project, postgresEnabled: true, postgresPassword: 'encrypted' }],
			[{ ...target, status: 'superseded' }]
		)
		mocks.runRollback.mockResolvedValue({ success: true, deploymentId: 'd-new', logs: [] })

		const result = await rollbackProject('p-1', 'd-old')

		expect(result).toMatchObject({ deploymentId: 'd-new', status: 'live', terminal: true })
		expect(mocks.runRollback.mock.calls[0][0]).toMatchObject({
			imageTag: 'img:1',
			postgresEnabled: true,
			postgresPassword: 'encrypted'
		})
	})

	it('refuses a deployment from another project', async () => {
		queueSelects([project], [])

		await expect(rollbackProject('p-1', 'd-foreign')).rejects.toMatchObject({
			code: 'not_found'
		})
	})

	it('refuses a deployment that never went live', async () => {
		queueSelects([project], [{ ...target, status: 'failed' }])

		await expect(rollbackProject('p-1', 'd-old')).rejects.toMatchObject({ code: 'validation' })
	})

	it('refuses a deployment with no cached image', async () => {
		queueSelects([project], [{ ...target, imageTag: null }])

		await expect(rollbackProject('p-1', 'd-old')).rejects.toMatchObject({ code: 'validation' })
	})

	it('surfaces a failed rollback as an internal error', async () => {
		queueSelects([project], [target])
		mocks.runRollback.mockResolvedValue({
			success: false,
			deploymentId: 'd-new',
			error: 'health check failed',
			logs: []
		})

		await expect(rollbackProject('p-1', 'd-old')).rejects.toMatchObject({
			code: 'internal',
			message: 'health check failed'
		})
	})
})

describe('setProjectEnv', () => {
	it('upserts, removes and returns names only', async () => {
		queueSelects([project], [{ key: 'API_URL' }, { key: 'TOKEN' }])

		const result = await setProjectEnv('p-1', { TOKEN: 'sekrit' }, ['OLD'])

		expect(result).toEqual({
			names: ['API_URL', 'TOKEN'],
			removed: ['OLD'],
			requiresRedeploy: true
		})
		expect(JSON.stringify(result)).not.toContain('sekrit')
		expect(mocks.encrypt).toHaveBeenCalledWith('sekrit')
	})

	it('rejects a name that is not a valid shell identifier', async () => {
		queueSelects([project])

		await expect(setProjectEnv('p-1', { 'not valid': 'x' })).rejects.toMatchObject({
			code: 'validation'
		})
		expect(mocks.db.insert).not.toHaveBeenCalled()
	})

	it('rejects an invalid name in remove too', async () => {
		queueSelects([project])

		await expect(setProjectEnv('p-1', {}, ['9LIVES'])).rejects.toMatchObject({
			code: 'validation'
		})
	})
})
