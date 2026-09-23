import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/server/db', () => ({ db: { update: vi.fn() } }))

vi.mock('$lib/server/db/schema', () => ({
	deployments: { id: 'id', projectId: 'project_id', status: 'status', containerName: 'container_name' }
}))

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((col: unknown, val: unknown) => ({ eq: [col, val] })),
	ne: vi.fn((col: unknown, val: unknown) => ({ ne: [col, val] })),
	and: vi.fn((...args: unknown[]) => ({ and: args }))
}))

import { db } from '$lib/server/db'
import { deployments } from '$lib/server/db/schema'
import { supersedeLiveDeployments } from './supersede'

describe('supersedeLiveDeployments', () => {
	it('marks the other live rows of the same container as superseded', async () => {
		const where = vi.fn().mockResolvedValue(undefined)
		const set = vi.fn().mockReturnValue({ where })
		vi.mocked(db.update).mockReturnValue({ set } as never)

		await supersedeLiveDeployments('proj-1', 'my-app', 'dep-new')

		expect(db.update).toHaveBeenCalledWith(deployments)
		expect(set).toHaveBeenCalledWith({ status: 'superseded' })
		expect(where).toHaveBeenCalledWith({
			and: [
				{ eq: ['project_id', 'proj-1'] },
				{ eq: ['status', 'live'] },
				{ eq: ['container_name', 'my-app'] },
				{ ne: ['id', 'dep-new'] }
			]
		})
	})
})
