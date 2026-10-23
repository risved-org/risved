import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

it('upgrades a migrated v0.23.0 database exactly once while preserving MCP credentials', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'risved-v023-upgrade-'))
	const client = createClient({ url: ':memory:' })
	try {
		const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
			entries: Array<{ idx: number; tag: string; when: number }>
		}
		const routing = journal.entries.at(-1)!
		const mcp = journal.entries.at(-2)!
		expect([mcp.idx, mcp.tag, routing.idx, routing.tag]).toEqual([
			8,
			'0008_mcp_oauth_and_api_keys',
			9,
			'0009_domain_paths'
		])
		expect(routing.when).toBeGreaterThan(mcp.when)
		const snapshot = JSON.parse(readFileSync('drizzle/meta/0009_snapshot.json', 'utf8'))
		expect(snapshot.prevId).toBe(
			JSON.parse(readFileSync('drizzle/meta/0008_snapshot.json', 'utf8')).id
		)
		await mkdir(join(directory, 'meta'))
		await writeFile(
			join(directory, 'meta/_journal.json'),
			JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) })
		)
		for (const entry of journal.entries.slice(0, -1)) {
			await copyFile(`drizzle/${entry.tag}.sql`, join(directory, `${entry.tag}.sql`))
		}
		const database = drizzle(client)
		await migrate(database, { migrationsFolder: directory })
		await client.execute(
			"INSERT INTO domains (id, project_id, hostname, created_at) VALUES ('main', 'app', 'onui.com', 'existing')"
		)
		await client.execute(
			"INSERT INTO api_keys (id, user_id, label, key_hash, key_prefix, created_at) VALUES ('key', 'user', 'CI', 'hash', 'rsv_test', 'existing')"
		)
		const credentials = (await client.execute('SELECT * FROM api_keys')).rows
		await migrate(database, { migrationsFolder: 'drizzle' })
		expect((await client.execute('SELECT * FROM domains')).rows[0]).toMatchObject({
			id: 'main',
			hostname: 'onui.com',
			path_prefix: '/',
			forwarding_mode: 'preserve'
		})
		expect((await client.execute('SELECT * FROM api_keys')).rows).toEqual(credentials)
		const applied = (
			await client.execute('SELECT created_at FROM __drizzle_migrations ORDER BY created_at')
		).rows
		expect(applied.map(row => Number(row.created_at))).toEqual(
			journal.entries.map(entry => entry.when)
		)
		await migrate(database, { migrationsFolder: 'drizzle' })
		expect(
			(await client.execute('SELECT created_at FROM __drizzle_migrations ORDER BY created_at')).rows
		).toEqual(applied)
	} finally {
		client.close()
		await rm(directory, { recursive: true, force: true })
	}
})
