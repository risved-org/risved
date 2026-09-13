import './test-fixtures'
import { describe, expect, it, vi } from 'vitest'
import { createProject } from './create'
import { mocks, project, queueSelects } from './test-fixtures'
import { ServiceError } from './types'

describe('createProject', () => {
	it('rejects a subdirectory before creating a project that would deploy the wrong root', async () => {
		await expect(
			createProject({ repo: 'o/r', rootDir: 'apps/web', origin: 'https://risved.test' })
		).rejects.toMatchObject({ code: 'validation' })
		expect(mocks.db.insert).not.toHaveBeenCalled()
	})

	it('rejects a reference that is not owner/name', async () => {
		await expect(
			createProject({ repo: 'not-a-repo', origin: 'https://risved.test' })
		).rejects.toMatchObject({ code: 'validation' })
	})

	it('reports github_app_not_installed with an install URL, writing nothing', async () => {
		mocks.resolveGitHubRepo.mockResolvedValue(null)

		const error = await createProject({
			repo: 'o/r',
			origin: 'https://risved.test'
		}).catch((e) => e as ServiceError)

		expect(error).toBeInstanceOf(ServiceError)
		expect((error as ServiceError).code).toBe('github_app_not_installed')
		expect((error as ServiceError).data.installUrl).toBe('https://risved.test/settings/git')
		expect(mocks.db.insert).not.toHaveBeenCalled()
	})

	it('refuses a duplicate slug', async () => {
		mocks.resolveGitHubRepo.mockResolvedValue({
			connectionId: 'c-1',
			client: {},
			repo: { name: 'my-app', default_branch: 'main', clone_url: 'https://github.com/o/r.git' }
		})
		queueSelects([project])

		await expect(
			createProject({ repo: 'o/my-app', origin: 'https://risved.test' })
		).rejects.toMatchObject({ code: 'validation' })
	})

	it('creates the project without deploying it', async () => {
		mocks.resolveGitHubRepo.mockResolvedValue({
			connectionId: 'c-1',
			client: {},
			repo: { name: 'my-app', default_branch: 'trunk', clone_url: 'https://github.com/o/r.git' }
		})
		mocks.inspectRepoConfig.mockResolvedValue([
			{ code: 'missing_adapter_node', severity: 'error', message: 'nope' }
		])
		queueSelects([])

		const result = await createProject({ repo: 'o/my-app', origin: 'https://risved.test' })

		expect(result.project.slug).toBe('my-app')
		expect(result.detectedFramework?.id).toBe('sveltekit')
		expect(result.buildHints).toHaveLength(1)
		expect(mocks.runPipeline).not.toHaveBeenCalled()
		expect(mocks.registerWebhook).toHaveBeenCalledOnce()
	})

	it("defaults the branch to the repo's default", async () => {
		mocks.resolveGitHubRepo.mockResolvedValue({
			connectionId: 'c-1',
			client: {},
			repo: { name: 'my-app', default_branch: 'trunk', clone_url: 'https://github.com/o/r.git' }
		})
		queueSelects([])

		const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([project]) })
		mocks.db.insert.mockReturnValue({ values })

		await createProject({ repo: 'o/my-app', origin: 'https://risved.test' })

		expect(values.mock.calls[0][0]).toMatchObject({ branch: 'trunk' })
	})
})
