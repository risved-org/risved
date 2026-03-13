import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { domains } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { checkDnsRecord, getServerIp } from '$lib/server/dns';
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
	const serverIp = await getServerIp();

	const result = await checkDnsRecord({
		type: 'A',
		name: domain.hostname,
		value: serverIp,
		purpose: 'Custom domain'
	});

	let sslStatus: string;
	let verifiedAt: string | null = domain.verifiedAt;

	if (result.resolved) {
		sslStatus = domain.sslStatus === 'active' ? 'active' : 'provisioning';
		verifiedAt = verifiedAt ?? new Date().toISOString();
	} else {
		sslStatus = 'pending';
	}

	const [updated] = await db
		.update(domains)
		.set({ sslStatus, verifiedAt })
		.where(eq(domains.id, did))
		.returning();

	return json({
		...updated,
		dnsResolved: result.resolved,
		expectedIp: serverIp
	});
};
