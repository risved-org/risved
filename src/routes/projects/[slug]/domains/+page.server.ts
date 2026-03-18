import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, domains } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getServerIps, checkDnsRecord } from '$lib/server/dns';
import { CaddyClient } from '$lib/server/caddy';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params;

	const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
	if (proj.length === 0) {
		error(404, 'Project not found');
	}

	const project = proj[0];
	const doms = await db.select().from(domains).where(eq(domains.projectId, project.id));
	const serverIps = await getServerIps();

	return {
		project: {
			id: project.id,
			name: project.name,
			slug: project.slug,
			port: project.port
		},
		domains: doms.map((d) => ({
			id: d.id,
			hostname: d.hostname,
			isPrimary: d.isPrimary,
			sslStatus: d.sslStatus,
			verifiedAt: d.verifiedAt,
			createdAt: d.createdAt
		})),
		serverIps
	};
};

export const actions: Actions = {
	/** Add a new domain to the project. */
	add: async ({ params, request }) => {
		const { slug } = params;
		const formData = await request.formData();
		const hostname = (formData.get('hostname') as string)?.trim().toLowerCase();

		if (!hostname) {
			return fail(400, { error: 'Hostname is required', hostname: '' });
		}

		if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(hostname)) {
			return fail(400, { error: 'Invalid hostname format', hostname });
		}

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (proj.length === 0) {
			return fail(404, { error: 'Project not found', hostname });
		}

		const project = proj[0];

		const existing = await db.select().from(domains).where(eq(domains.hostname, hostname)).limit(1);
		if (existing.length > 0) {
			return fail(409, { error: `Domain "${hostname}" is already in use`, hostname });
		}

		if (project.port) {
			try {
				const caddy = new CaddyClient();
				await caddy.addRoute({ hostname, port: project.port });
			} catch {
				/* Caddy may not be running */
			}
		}

		await db.insert(domains).values({
			projectId: project.id,
			hostname,
			sslStatus: 'pending'
		});

		return { added: true };
	},

	/** Verify DNS for a domain. */
	verify: async ({ params, request }) => {
		const { slug } = params;
		const formData = await request.formData();
		const domainId = formData.get('domainId') as string;

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (proj.length === 0) {
			return fail(404, { error: 'Project not found' });
		}

		const rows = await db
			.select()
			.from(domains)
			.where(and(eq(domains.id, domainId), eq(domains.projectId, proj[0].id)))
			.limit(1);
		if (rows.length === 0) {
			return fail(404, { error: 'Domain not found' });
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

		let sslStatus: string;
		let verifiedAt: string | null = domain.verifiedAt;

		if (anyResolved) {
			sslStatus = domain.sslStatus === 'active' ? 'active' : 'provisioning';
			verifiedAt = verifiedAt ?? new Date().toISOString();
		} else {
			sslStatus = 'pending';
		}

		await db.update(domains).set({ sslStatus, verifiedAt }).where(eq(domains.id, domainId));

		return { verified: anyResolved, domainId, sslStatus };
	},

	/** Set a domain as primary. */
	primary: async ({ params, request }) => {
		const { slug } = params;
		const formData = await request.formData();
		const domainId = formData.get('domainId') as string;

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (proj.length === 0) {
			return fail(404, { error: 'Project not found' });
		}

		const projectId = proj[0].id;

		const rows = await db
			.select()
			.from(domains)
			.where(and(eq(domains.id, domainId), eq(domains.projectId, projectId)))
			.limit(1);
		if (rows.length === 0) {
			return fail(404, { error: 'Domain not found' });
		}

		await db.update(domains).set({ isPrimary: false }).where(eq(domains.projectId, projectId));

		await db.update(domains).set({ isPrimary: true }).where(eq(domains.id, domainId));

		return { primarySet: true, domainId };
	},

	/** Remove a domain. */
	remove: async ({ params, request }) => {
		const { slug } = params;
		const formData = await request.formData();
		const domainId = formData.get('domainId') as string;

		const proj = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (proj.length === 0) {
			return fail(404, { error: 'Project not found' });
		}

		const rows = await db
			.select()
			.from(domains)
			.where(and(eq(domains.id, domainId), eq(domains.projectId, proj[0].id)))
			.limit(1);
		if (rows.length === 0) {
			return fail(404, { error: 'Domain not found' });
		}

		try {
			const caddy = new CaddyClient();
			await caddy.removeRoute(rows[0].hostname);
		} catch {
			/* Caddy may not be running */
		}

		await db.delete(domains).where(eq(domains.id, domainId));

		return { removed: true, domainId };
	}
};
