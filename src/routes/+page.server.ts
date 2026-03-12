import { db } from '$lib/server/db';
import { projects, deployments, domains } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { getHealthMonitor } from '$lib/server/health';
import type { PageServerLoad } from './$types';
import { execSync } from 'node:child_process';
import os from 'node:os';

/** Map framework IDs to display names */
export const FRAMEWORK_NAMES: Record<string, string> = {
	sveltekit: 'SvelteKit',
	fresh: 'Fresh',
	astro: 'Astro',
	hono: 'Hono',
	nextjs: 'Next.js',
	nuxt: 'Nuxt',
	lume: 'Lume',
	solidstart: 'SolidStart'
};

/** Reads system health metrics from OS APIs and shell commands */
export function getSystemHealth() {
	const cpus = os.cpus();
	const cpuUsage =
		cpus.length > 0
			? Math.round(
					cpus.reduce((acc, cpu) => {
						const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
						return acc + ((total - cpu.times.idle) / total) * 100;
					}, 0) / cpus.length
				)
			: 0;

	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	const memoryPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);

	let diskPercent = 0;
	try {
		const dfOutput = execSync('df -h / | tail -1', { encoding: 'utf8' });
		const match = dfOutput.match(/(\d+)%/);
		if (match) diskPercent = parseInt(match[1], 10);
	} catch {
		/* disk info unavailable */
	}

	let uptimeStr = '';
	try {
		const uptimeSeconds = os.uptime();
		const days = Math.floor(uptimeSeconds / 86400);
		const hours = Math.floor((uptimeSeconds % 86400) / 3600);
		if (days > 0) uptimeStr = `${days}d ${hours}h`;
		else uptimeStr = `${hours}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`;
	} catch {
		uptimeStr = '—';
	}

	let containerCount = 0;
	try {
		const output = execSync('docker ps -q 2>/dev/null | wc -l', { encoding: 'utf8' });
		containerCount = parseInt(output.trim(), 10) || 0;
	} catch {
		/* docker not available */
	}

	return { cpuPercent: cpuUsage, memoryPercent, diskPercent, uptime: uptimeStr, containerCount };
}

export const load: PageServerLoad = async () => {
	const health = getSystemHealth();

	/* Fetch all projects */
	const allProjects = await db.select().from(projects).orderBy(desc(projects.createdAt));

	/* Fetch latest deployment per project */
	const allDeployments = await db.select().from(deployments).orderBy(desc(deployments.createdAt));

	/* Fetch primary domains */
	const primaryDomains = await db
		.select({ projectId: domains.projectId, hostname: domains.hostname })
		.from(domains)
		.where(eq(domains.isPrimary, true));

	/* Build lookup maps */
	const latestDeployMap = new Map<
		string,
		{ status: string; commitSha: string | null; createdAt: string }
	>();
	for (const dep of allDeployments) {
		if (!latestDeployMap.has(dep.projectId)) {
			latestDeployMap.set(dep.projectId, {
				status: dep.status,
				commitSha: dep.commitSha,
				createdAt: dep.createdAt
			});
		}
	}

	const domainMap = new Map(primaryDomains.map((d) => [d.projectId, d.hostname]));

	/* Health monitor status per project */
	const monitor = getHealthMonitor();
	const healthMap = new Map(monitor.getAll().map((h) => [h.projectId, h]));

	const projectList = allProjects.map((p) => {
		const dep = latestDeployMap.get(p.id);
		const containerHealth = healthMap.get(p.id);
		return {
			id: p.id,
			name: p.name,
			slug: p.slug,
			framework: p.frameworkId ? (FRAMEWORK_NAMES[p.frameworkId] ?? p.frameworkId) : null,
			frameworkId: p.frameworkId,
			domain: domainMap.get(p.id) ?? p.domain ?? null,
			status: dep?.status ?? 'stopped',
			commitSha: dep?.commitSha ?? null,
			lastDeployedAt: dep?.createdAt ?? null,
			containerHealthy: containerHealth?.healthy ?? null,
			totalRestarts: containerHealth?.totalRestarts ?? 0
		};
	});

	return { health, projects: projectList };
};
