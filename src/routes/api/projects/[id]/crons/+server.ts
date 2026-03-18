import { json } from '@sveltejs/kit'
import { Cron } from 'croner'
import { db } from '$lib/server/db'
import { projects, cronJobs } from '$lib/server/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { getCronScheduler } from '$lib/server/cron'
import type { RequestHandler } from './$types'

function isValidCron(expr: string): boolean {
	try {
		new Cron(expr)
		return true
	} catch {
		return false
	}
}

const MAX_JOBS_PER_PROJECT = 10
const MAX_NAME_LENGTH = 100

/**
 * GET /api/projects/:id/crons — list cron jobs for a project.
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id } = event.params

	const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
	if (proj.length === 0) return jsonError(404, 'Project not found')

	const jobs = await db
		.select()
		.from(cronJobs)
		.where(eq(cronJobs.projectId, id))

	return json(jobs)
}

/**
 * POST /api/projects/:id/crons — create a cron job.
 * Body: { name, route, method?, schedule, timezone? }
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event)

	const { id } = event.params

	const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
	if (proj.length === 0) return jsonError(404, 'Project not found')

	const body = await event.request.json().catch(() => null)
	if (!body || typeof body !== 'object') return jsonError(400, 'Invalid JSON body')

	const { name, route, method, schedule, timezone } = body as Record<string, unknown>

	/* Validate name */
	if (!name || typeof name !== 'string' || name.trim().length === 0) {
		return jsonError(400, 'name is required')
	}
	if (name.length > MAX_NAME_LENGTH) {
		return jsonError(400, `name must be ${MAX_NAME_LENGTH} characters or fewer`)
	}

	/* Validate route */
	if (!route || typeof route !== 'string' || !route.startsWith('/')) {
		return jsonError(400, 'route must start with /')
	}

	/* Validate method */
	const m = (typeof method === 'string' ? method.toUpperCase() : 'GET')
	if (m !== 'GET' && m !== 'POST') {
		return jsonError(400, 'method must be GET or POST')
	}

	/* Validate schedule */
	if (!schedule || typeof schedule !== 'string') {
		return jsonError(400, 'schedule is required')
	}
	if (!isValidCron(schedule)) {
		return jsonError(400, 'Invalid cron expression')
	}

	/* Validate timezone */
	const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC'
	try {
		Intl.DateTimeFormat(undefined, { timeZone: tz })
	} catch {
		return jsonError(400, 'Invalid timezone')
	}

	/* Enforce max jobs per project */
	const existing = await db
		.select({ id: cronJobs.id })
		.from(cronJobs)
		.where(eq(cronJobs.projectId, id))

	if (existing.length >= MAX_JOBS_PER_PROJECT) {
		return jsonError(400, `Maximum of ${MAX_JOBS_PER_PROJECT} cron jobs per project`)
	}

	const [created] = await db
		.insert(cronJobs)
		.values({
			projectId: id,
			name: name.trim(),
			route: route.trim(),
			method: m,
			schedule: schedule.trim(),
			timezone: tz
		})
		.returning()

	getCronScheduler().register(created)

	return json(created, { status: 201 })
}
