import { expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'

it('adds MCP tables after existing migrations without changing project data', async () => {
	const client = createClient({ url: ':memory:' })
	try {
		const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
			entries: Array<{ idx: number; tag: string }>
		}
		const latest = journal.entries.at(-1)!
		expect(latest.tag).toBe('0008_mcp_oauth_and_api_keys')
		expect(journal.entries.map((entry) => entry.idx)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
		for (const entry of journal.entries.slice(0, -1)) {
			await client.executeMultiple(readFileSync(`drizzle/${entry.tag}.sql`, 'utf8'))
		}
		await client.execute(
			"INSERT INTO projects (id, name, slug, repo_url, runtime, created_at, updated_at) VALUES ('existing', 'Existing', 'existing', 'https://github.com/o/r', 'bun', '2026-01-01', '2026-01-01')"
		)
		const before = (await client.execute('SELECT * FROM projects')).rows
		await client.executeMultiple(readFileSync(`drizzle/${latest.tag}.sql`, 'utf8'))
		expect((await client.execute('SELECT * FROM projects')).rows).toEqual(before)
		const tables = (
			await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
		).rows.map((row) => row.name)
		expect(tables).toEqual(
			expect.arrayContaining([
				'api_keys',
				'oauth_application',
				'oauth_access_token',
				'oauth_consent'
			])
		)
	} finally {
		client.close()
	}
})
