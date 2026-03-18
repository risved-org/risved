import { json } from '@sveltejs/kit'
import { Cron } from 'croner'
import { db } from '$lib/server/db'

function isValidCron(expr: string): boolean {
	try {
		new Cron(expr)
		return true
	} catch {
		return false
	}
}

import { projects, cronJobs, cronRuns } from '$lib/server/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { getCronScheduler } from '$lib/server/cron'
import type { RequestHandler } from './$types'

const MAX_NAME_LENGTH = 100

/** Find a cron job by ID that belongs to the given project. */
async function findJob(projectId: string, cronId: string) {
	const rows = await db
		.select()
		.from(cronJobs)
		.where(and(eq(cronJobs.id, cronId), eq(cronJobs.projectId, projectId)))
		.limit(1)
	return rows[0] ?? null
}

/**
 * GET /api/projects/:id/crons/:cronId — get a cron job with recent runs.
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id, cronId } = event.params

	const job = await findJob(id, cronId)
	if (!job) return jsonError(404, 'Cron job not found')

	const runs = await db
		.select()
		.from(cronRuns)
		.where(eq(cronRuns.cronJobId, cronId))
		.orderBy(desc(cronRuns.startedAt))
		.limit(50)

	return json({ ...job, runs })
}

/**
 * PUT /api/projects/:id/crons/:cronId — update a cron job.
 * Body: partial { name, route, method, schedule, timezone, enabled }
 */
export const PUT: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id, cronId } = event.params

	const existing = await findJob(id, cronId)
	if (!existing) return jsonError(404, 'Cron job not found')

	const body = await event.request.json().catch(() => null)
	if (!body || typeof body !== 'object') return jsonError(400, 'Invalid JSON body')

	const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
	const b = body as Record<string, unknown>

	if (b.name !== undefined) {
		if (typeof b.name !== 'string' || b.name.trim().length === 0) {
			return jsonError(400, 'name must be a non-empty string')
		}
		if (b.name.length > MAX_NAME_LENGTH) {
			return jsonError(400, `name must be ${MAX_NAME_LENGTH} characters or fewer`)
		}
		updates.name = b.name.trim()
	}

	if (b.route !== undefined) {
		if (typeof b.route !== 'string' || !b.route.startsWith('/')) {
			return jsonError(400, 'route must start with /')
		}
		updates.route = b.route.trim()
	}

	if (b.method !== undefined) {
		const m = typeof b.method === 'string' ? b.method.toUpperCase() : ''
		if (m !== 'GET' && m !== 'POST') {
			return jsonError(400, 'method must be GET or POST')
		}
		updates.method = m
	}

	if (b.schedule !== undefined) {
		if (typeof b.schedule !== 'string' || !isValidCron(b.schedule)) {
			return jsonError(400, 'Invalid cron expression')
		}
		updates.schedule = b.schedule.trim()
	}

	if (b.timezone !== undefined) {
		const tz = typeof b.timezone === 'string' ? b.timezone.trim() : ''
		try {
			Intl.DateTimeFormat(undefined, { timeZone: tz })
		} catch {
			return jsonError(400, 'Invalid timezone')
		}
		updates.timezone = tz
	}

	if (b.enabled !== undefined) {
		if (typeof b.enabled !== 'boolean') {
			return jsonError(400, 'enabled must be a boolean')
		}
		updates.enabled = b.enabled
	}

	await db
		.update(cronJobs)
		.set(updates)
		.where(eq(cronJobs.id, cronId))

	const [updated] = await db
		.select()
		.from(cronJobs)
		.where(eq(cronJobs.id, cronId))
		.limit(1)

	const scheduler = getCronScheduler()
	if (updated.enabled) {
		scheduler.register(updated)
	} else {
		scheduler.unregister(updated.id)
	}

	return json(updated)
}

/**
 * DELETE /api/projects/:id/crons/:cronId — delete a cron job and its runs.
 */
export const DELETE: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id, cronId } = event.params

	const job = await findJob(id, cronId)
	if (!job) return jsonError(404, 'Cron job not found')

	getCronScheduler().unregister(cronId)
	await db.delete(cronRuns).where(eq(cronRuns.cronJobId, cronId))
	await db.delete(cronJobs).where(eq(cronJobs.id, cronId))

	return json({ success: true })
}
