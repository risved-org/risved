import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRunPipeline = vi.fn()

vi.mock('$lib/server/db', () => {
	const select = vi.fn()
	const insert = vi.fn()
	return { db: { select, insert } }
})

vi.mock('$lib/server/db/schema', () => ({
	projects: { id: 'id' },
	deployments: { id: 'id', projectId: 'project_id', status: 'status' }
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn(() => 'eq_fn'),
	and: vi.fn((...args: unknown[]) => args)
}))

vi.mock('$lib/server/api-utils', () => ({
	requireAuth: vi.fn().mockReturnValue({ id: 'user-1', email: 'admin@test.com' }),
	jsonError: vi.fn((status: number, message: string) =>
		new Response(JSON.stringify({ error: message }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		})
	)
}))

vi.mock('$lib/server/pipeline', () => ({
	runPipeline: (...args: unknown[]) => mockRunPipeline(...args)
}))

vi.mock('$lib/server/pipeline/docker', () => ({
	createCommandRunner: vi.fn().mockReturnValue({ exec: vi.fn() })
}))

import { db } from '$lib/server/db'
import { POST } from './+server'

const mockSelect = db.select as ReturnType<typeof vi.fn>
const mockInsert = db.insert as ReturnType<typeof vi.fn>

const projectRow = {
	id: 'proj-1',
	slug: 'my-app',
	repoUrl: 'https://github.com/user/repo.git',
	branch: 'main',
	gitConnectionId: 'git-1',
	port: 3001,
	domain: 'my-app.example.com',
	frameworkId: 'sveltekit',
	tier: 'node',
	buildCommand: 'bun run build',
	startCommand: 'node build',
	releaseCommand: null,
	postgresEnabled: false,
	postgresPassword: null
}

const deploymentRow = {
	id: 'dep-1',
	projectId: 'proj-1',
	status: 'failed',
	commitSha: 'abc1234'
}

let selectCallCount = 0

function setupSelectChain(rows: unknown[][]) {
	selectCallCount = 0
	mockSelect.mockImplementation(() => ({
		from: vi.fn().mockImplementation(() => ({
			where: vi.fn().mockImplementation(() => ({
				limit: vi.fn().mockImplementation(() => {
					const result = rows[selectCallCount] ?? []
					selectCallCount++
					return Promise.resolve(result)
				})
			}))
		}))
	}))
}

function setupInsertChain() {
	mockInsert.mockReturnValue({
		values: vi.fn().mockResolvedValue(undefined)
	})
}

function makeEvent(params: Record<string, string> = {}) {
	return {
		request: new Request('http://localhost/api/projects/proj-1/deployments/dep-1/rebuild', {
			method: 'POST'
		}),
		locals: { user: { id: 'user-1' }, session: {} },
		params: { id: 'proj-1', did: 'dep-1', ...params },
		url: new URL('http://localhost/api/projects/proj-1/deployments/dep-1/rebuild')
	} as never
}

describe('POST /api/projects/:id/deployments/:did/rebuild', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		selectCallCount = 0
		mockRunPipeline.mockResolvedValue({ success: true, deploymentId: 'new-dep-1' })
		setupInsertChain()
	})

	it('returns 404 when project not found', async () => {
		setupSelectChain([[]])
		const res = await POST(makeEvent())
		expect(res.status).toBe(404)
	})

	it('returns 400 when project has no port', async () => {
		setupSelectChain([[{ ...projectRow, port: null }]])
		const res = await POST(makeEvent())
		expect(res.status).toBe(400)
	})

	it('returns 404 when deployment not found', async () => {
		setupSelectChain([[projectRow], []])
		const res = await POST(makeEvent())
		expect(res.status).toBe(404)
	})

	it('returns 400 when deployment has no commit', async () => {
		setupSelectChain([[projectRow], [{ ...deploymentRow, commitSha: null }]])
		const res = await POST(makeEvent())
		expect(res.status).toBe(400)
	})

	it('creates a rebuild deployment and starts the pipeline at the saved commit', async () => {
		setupSelectChain([[projectRow], [deploymentRow]])

		const res = await POST(makeEvent())
		expect(res.status).toBe(200)

		const body = await res.json()
		expect(body.success).toBe(true)
		expect(body.deploymentId).toBeTruthy()

		expect(db.insert).toHaveBeenCalled()
		expect(mockRunPipeline).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'proj-1',
				projectSlug: 'my-app',
				repoUrl: 'https://github.com/user/repo.git',
				branch: 'main',
				checkoutRef: 'abc1234',
				port: 3001,
				domain: 'my-app.example.com'
			}),
			expect.anything(),
			expect.objectContaining({ deploymentId: body.deploymentId })
		)
	})
})
