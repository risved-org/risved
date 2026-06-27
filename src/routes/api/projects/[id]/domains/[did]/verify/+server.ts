import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, domains } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { checkDnsRecord, getServerIps } from '$lib/server/dns';
import { resolveSslStatus } from '$lib/server/ssl';
import { repairDomainRoute } from '$lib/server/caddy/repair';
import type { RequestHandler } from './$types';

/**
 * POST /api/projects/:id/domains/:did/verify — trigger DNS verification.
 */
export const POST: RequestHandler = async (event) => {
	await requireAuth(event);

	const { id, did } = event.params;

	const rows = await db
		.select()
		.from(domains)
		.where(and(eq(domains.id, did), eq(domains.projectId, id)))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Domain not found');
	}

	const domain = rows[0];
	const serverIps = await getServerIps();

	const checks = []
	if (serverIps.ipv4) {
		checks.push(checkDnsRecord({ type: 'A', name: domain.hostname, value: serverIps.ipv4, purpose: 'Custom domain' }))
	}
	if (serverIps.ipv6) {
		checks.push(checkDnsRecord({ type: 'AAAA', name: domain.hostname, value: serverIps.ipv6, purpose: 'Custom domain (IPv6)' }))
	}

	const results = await Promise.all(checks)
	const anyResolved = results.some((r) => r.resolved)

	let verifiedAt: string | null = domain.verifiedAt;

	const sslStatus = await resolveSslStatus(domain.hostname, anyResolved);
	if (anyResolved) {
		verifiedAt = verifiedAt ?? new Date().toISOString();
		if (sslStatus !== 'active') {
			const projectRows = await db
				.select({ port: projects.port })
				.from(projects)
				.where(eq(projects.id, id))
				.limit(1)
			const port = projectRows[0]?.port
			if (port) await repairDomainRoute(domain.hostname, port)
		}
	}

	const [updated] = await db
		.update(domains)
		.set({ sslStatus, verifiedAt })
		.where(eq(domains.id, did))
		.returning();

	return json({
		...updated,
		dnsResolved: anyResolved,
		expectedIps: serverIps
	});
};
