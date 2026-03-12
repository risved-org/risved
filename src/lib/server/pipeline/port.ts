import { db } from '$lib/server/db';
import { projects } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';

const PORT_MIN = 3001;
const PORT_MAX = 3999;

/**
 * Allocate the next available port in the 3001-3999 range.
 * Finds the lowest unused port by querying existing project assignments.
 */
export async function allocatePort(): Promise<number> {
	const usedPorts = await db
		.select({ port: projects.port })
		.from(projects)
		.where(sql`${projects.port} IS NOT NULL`)
		.orderBy(projects.port);

	const usedSet = new Set(usedPorts.map((r) => r.port));

	for (let port = PORT_MIN; port <= PORT_MAX; port++) {
		if (!usedSet.has(port)) {
			return port;
		}
	}

	throw new Error(`No available ports in range ${PORT_MIN}-${PORT_MAX}`);
}

/**
 * Check if a port is currently allocated to any project.
 */
export async function isPortAllocated(port: number): Promise<boolean> {
	const result = await db
		.select({ port: projects.port })
		.from(projects)
		.where(sql`${projects.port} = ${port}`)
		.limit(1);

	return result.length > 0;
}
