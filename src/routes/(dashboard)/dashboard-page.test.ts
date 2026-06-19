import { describe, it, expect } from 'vitest'
import { load } from './+page.server'

describe('dashboard root page load', () => {
	it('redirects to /projects with 307', () => {
		let thrown: unknown
		try {
			load({} as Parameters<typeof load>[0])
		} catch (e) {
			thrown = e
		}
		expect(thrown).toMatchObject({ status: 307, location: '/projects' })
	})
})
