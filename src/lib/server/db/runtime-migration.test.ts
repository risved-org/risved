import { expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { readFileSync } from 'node:fs'

it('preserves existing projects with Node as the runtime and allows opting into Bun', async () => {
	const client = createClient({ url: ':memory:' })
	try {
		await client.executeMultiple(
			"CREATE TABLE projects (id text PRIMARY KEY); INSERT INTO projects VALUES ('existing')"
		)
		await client.executeMultiple(readFileSync('drizzle/0007_project_runtime.sql', 'utf8'))
		expect((await client.execute('SELECT runtime FROM projects')).rows[0].runtime).toBe('node')
		await client.execute("UPDATE projects SET runtime = 'bun' WHERE id = 'existing'")
		expect((await client.execute('SELECT runtime FROM projects')).rows[0].runtime).toBe('bun')
		await client.execute("INSERT INTO projects (id) VALUES ('new')")
		expect(
			(await client.execute("SELECT runtime FROM projects WHERE id = 'new'")).rows[0].runtime
		).toBe('node')
	} finally {
		client.close()
	}
})
