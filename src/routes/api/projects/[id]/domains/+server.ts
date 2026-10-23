import { hasRootConflict } from '$lib/server/domain-conflicts'
import { parseMapping, isMappingConflict } from '$lib/server/domain-mapping'
import { json } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { projects, domains } from '$lib/server/db/schema'
import { eq, and } from 'drizzle-orm'
import { requireAuth, jsonError } from '$lib/server/api-utils'
import { createCaddyClient } from '$lib/server/caddy'
import type { RequestHandler } from './$types'

/**
 * GET /api/projects/:id/domains — list domains with SSL status.
 */
export const GET: RequestHandler = async event => {
	await requireAuth(event)

	const { id } = event.params

	const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
	if (proj.length === 0) {
		return jsonError(404, 'Project not found')
	}

	const rows = await db.select().from(domains).where(eq(domains.projectId, id))

	return json(rows)
}

/**
 * POST /api/projects/:id/domains — add a custom domain.
 * Body: { hostname, pathPrefix?: string, forwardingMode?: "preserve" | "strip" }
 */
export const POST: RequestHandler = async event => {
	await requireAuth(event)

	const { id } = event.params

	const proj = await db.select().from(projects).where(eq(projects.id, id)).limit(1)
	if (proj.length === 0) {
		return jsonError(404, 'Project not found')
	}

	const body = await event.request.json().catch(() => null)
	if (!body || typeof body !== 'object') {
		return jsonError(400, 'Invalid JSON body')
	}

	const { hostname } = body as Record<string, unknown>

	if (!hostname || typeof hostname !== 'string' || hostname.trim().length === 0) {
		return jsonError(400, 'hostname is required')
	}

	const trimmed = hostname.trim().toLowerCase()

	/* Basic hostname validation */
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(trimmed)) {
		return jsonError(400, 'Invalid hostname format')
	}

	let mapping
	try {
		mapping = parseMapping(body.pathPrefix, body.forwardingMode)
	} catch (err) {
		return jsonError(400, (err as Error).message)
	}

	/* Check uniqueness across all projects */
	const existing = await db
		.select()
		.from(domains)
		.where(and(eq(domains.hostname, trimmed), eq(domains.pathPrefix, mapping.pathPrefix)))
		.limit(1)

	if (existing.length > 0) {
		return jsonError(409, `Domain "${trimmed}" is already in use`)
	}

	if (mapping.pathPrefix === '/' && (await hasRootConflict(trimmed, id))) {
		return jsonError(409, 'Hostname and path prefix are already in use')
	}

	const project = proj[0]

	let created
	try {
		const result = await db
			.insert(domains)
			.values({
				projectId: id,
				hostname: trimmed,
				...mapping,
				sslStatus: 'pending'
			})
			.returning()
		created = result[0]
	} catch (error) {
		if (isMappingConflict(error))
			return jsonError(409, 'Hostname and path prefix are already in use')
		throw error
	}

	/* Create Caddy route if project has a port */
	if (project.port) {
		try {
			const caddy = createCaddyClient()
			await caddy.addRoute({ hostname: trimmed, port: project.port, ...mapping })
			/* Auto-add www → non-www redirect for non-www domains */
			if (!trimmed.startsWith('www.')) {
				await caddy.addRedirectRoute(`www.${trimmed}`, trimmed, mapping.pathPrefix)
			}
		} catch {
			/* Caddy may not be running — continue, route will be added on next deploy */
		}
	}

	return json(created, { status: 201 })
}
