import { sql } from 'drizzle-orm'
import { db } from './index'

/**
 * Columns that must exist on each table, with the SQL fragment to add them.
 *
 * Guards against migrations that were recorded as applied in
 * `__drizzle_migrations` but never actually took effect. The original
 * `0005_managed_postgres` migration lacked `--> statement-breakpoint`
 * separators, so its three `ALTER TABLE` statements ran as one and the
 * `postgres_*` columns were never added — yet the migration was still marked
 * applied. Drizzle never re-runs such migrations, so instances that upgraded
 * through that window are left with a schema the query builder expects but the
 * database lacks, crashing any query against `projects` with
 * `no such column: postgres_enabled`.
 *
 * This list lets us reconcile the schema idempotently at boot.
 */
const REQUIRED_COLUMNS: Record<string, Record<string, string>> = {
	projects: {
		postgres_enabled: 'integer DEFAULT false NOT NULL',
		postgres_password: 'text',
		postgres_created_at: 'text'
	}
}

/**
 * Add any columns listed in REQUIRED_COLUMNS that are missing from the live
 * database. Idempotent and safe to run on every boot: existing columns are
 * skipped, so a correctly-migrated database is a no-op.
 */
export async function reconcileSchema(): Promise<void> {
	for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
		const info = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`))
		const existing = new Set(info.map((c) => c.name))

		for (const [name, definition] of Object.entries(columns)) {
			if (existing.has(name)) continue
			await db.run(sql.raw(`ALTER TABLE ${table} ADD ${name} ${definition}`))
			console.log(`[db] reconcile: added missing column ${table}.${name}`)
		}
	}
}
