import { expect, it } from 'vitest'
import { GitHubClient } from './index'

it('distinguishes unavailable repositories from primary and secondary rate limits', async () => {
	for (const response of [
		new Response('rate limit exceeded', { status: 403 }),
		new Response('forbidden', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
		new Response('forbidden', { status: 403, headers: { 'retry-after': '60' } })
	]) {
		const client = new GitHubClient('test', async () => response)
		await expect(client.getRepo('o', 'r')).rejects.toThrow('rate limit')
	}
	const client = new GitHubClient('test', async () => new Response('not found', { status: 404 }))
	await expect(client.getRepo('o', 'r')).resolves.toBeNull()
})
