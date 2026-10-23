import { it, expect } from 'vitest'
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'

it('migrates existing domains without data loss and enforces unique hostname/prefix pairs', async () => {
	const client = createClient({ url: ':memory:' })
	try {
		await client.executeMultiple(`CREATE TABLE domains (
			id text PRIMARY KEY, project_id text NOT NULL, hostname text NOT NULL UNIQUE,
			is_primary integer DEFAULT false NOT NULL, ssl_status text DEFAULT 'pending' NOT NULL,
			verified_at text, created_at text NOT NULL);
			INSERT INTO domains VALUES ('main', 'p1', 'onui.com', 1, 'active', 'verified', 'created');`)
		await client.executeMultiple(readFileSync('drizzle/0009_domain_paths.sql', 'utf8'))
		expect((await client.execute('SELECT * FROM domains')).rows[0]).toMatchObject({
			id: 'main',
			path_prefix: '/',
			forwarding_mode: 'preserve',
			ssl_status: 'active',
			verified_at: 'verified',
			is_primary: 1
		})
		await client.execute(
			"INSERT INTO domains (id, project_id, hostname, path_prefix, created_at) VALUES ('blog', 'p2', 'onui.com', '/blog', 'today')"
		)
		await expect(
			client.execute(
				"INSERT INTO domains (id, project_id, hostname, path_prefix, created_at) VALUES ('duplicate', 'p3', 'onui.com', '/blog', 'today')"
			)
		).rejects.toThrow(/UNIQUE/)
		await client.execute("UPDATE domains SET forwarding_mode = 'strip' WHERE id = 'blog'")
		await client.execute("DELETE FROM domains WHERE id = 'blog'")
		expect((await client.execute('SELECT hostname, path_prefix FROM domains')).rows).toEqual([
			expect.objectContaining({ hostname: 'onui.com', path_prefix: '/' })
		])
	} finally {
		client.close()
	}
})
