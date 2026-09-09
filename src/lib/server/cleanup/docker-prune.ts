import { db } from '$lib/server/db';
import { deployments, projects } from '$lib/server/db/schema';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import type { CommandRunner } from '$lib/server/pipeline/types';

/** Successful deployments per project whose images are kept for rollback. */
export const KEEP_IMAGES_PER_PROJECT = 3;

/** Below either of these the disk is treated as under pressure. */
export const LOW_DISK_FREE_PERCENT = 15;
export const LOW_DISK_FREE_BYTES = 5 * 1000 * 1000 * 1000;

/** How much BuildKit cache a routine prune leaves behind. */
const BUILD_CACHE_KEEP = '2GB';

/** Self-update pulls a new one of these per release; each is over 2GB. */
const CONTROL_PLANE_IMAGE = 'ghcr.io/risved-org/risved';

/**
 * /app/data is bind-mounted from the host, so probing it with `df` reports the
 * host disk that Docker images, volumes and logs actually live on.
 */
export const HOST_DISK_PROBE_PATH = '/app/data';

export interface DiskSpace {
	totalBytes: number;
	freeBytes: number;
	freePercent: number;
}

export interface DockerPruneSummary {
	imagesRemoved: string[];
	danglingReclaimed: string;
	buildCacheReclaimed: string;
}

export interface PruneOptions {
	/** Successful deployments per project whose images survive (default 3). */
	keepPerProject?: number;
	/** Only prune images belonging to this project. */
	projectId?: string;
	/** Drop the whole build cache instead of trimming it. */
	aggressive?: boolean;
}

/**
 * Read free space on the host disk via POSIX `df`.
 * Returns null when the probe path does not exist (e.g. in development).
 */
export async function getDiskSpace(
	runner: CommandRunner,
	path = HOST_DISK_PROBE_PATH
): Promise<DiskSpace | null> {
	const result = await runner.exec('df', ['-kP', path]);
	if (result.exitCode !== 0) return null;

	const lines = result.stdout.trim().split('\n');
	const columns = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
	/* Filesystem 1024-blocks Used Available Capacity Mounted on */
	if (columns.length < 6) return null;

	const totalBytes = parseInt(columns[1], 10) * 1024;
	const freeBytes = parseInt(columns[3], 10) * 1024;
	if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0) return null;

	return { totalBytes, freeBytes, freePercent: (freeBytes / totalBytes) * 100 };
}

export function isDiskLow(space: DiskSpace): boolean {
	return space.freeBytes < LOW_DISK_FREE_BYTES || space.freePercent < LOW_DISK_FREE_PERCENT;
}

function imageRepository(tag: string): string {
	const idx = tag.lastIndexOf(':');
	return idx === -1 ? tag : tag.slice(0, idx);
}

/** Project images are tagged `<slug>:<sha>`; PR previews use `<slug>-pr-<n>:<sha>`. */
function belongsToProject(tag: string, slug: string): boolean {
	const repo = imageRepository(tag);
	return repo === slug || repo.startsWith(`${slug}-pr-`);
}

function parseReclaimed(stdout: string): string {
	return stdout.match(/reclaimed\s+space:\s*(.+)/i)?.[1]?.trim() || '0B';
}

/**
 * Remove images of old deployments. Every live deployment's image is always
 * kept, plus the newest `keepPerProject` successful deployments per project so
 * rollback keeps working. Images still used by a container are refused by
 * Docker and left alone. Deployments whose image was removed lose their
 * cached image reference so the UI no longer offers a rollback to them.
 */
export async function pruneProjectImages(
	runner: CommandRunner,
	keepPerProject = KEEP_IMAGES_PER_PROJECT,
	projectId?: string
): Promise<string[]> {
	const projectQuery = db.select({ id: projects.id, slug: projects.slug }).from(projects);
	const projectRows = projectId
		? await projectQuery.where(eq(projects.id, projectId))
		: await projectQuery;
	if (projectRows.length === 0) return [];

	const listed = await runner.exec('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}']);
	if (listed.exitCode !== 0) return [];
	const present = listed.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('<none>'));
	if (present.length === 0) return [];

	const rows = await db
		.select({
			projectId: deployments.projectId,
			status: deployments.status,
			imageTag: deployments.imageTag,
			createdAt: deployments.createdAt
		})
		.from(deployments)
		.where(isNotNull(deployments.imageTag));

	const byProject = new Map<string, typeof rows>();
	for (const row of rows) {
		const list = byProject.get(row.projectId) ?? [];
		list.push(row);
		byProject.set(row.projectId, list);
	}

	const removed: string[] = [];
	for (const project of projectRows) {
		const protectedTags = new Set<string>();
		const successful = (byProject.get(project.id) ?? [])
			.filter((row) => row.status === 'live' || row.status === 'stopped')
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		for (const row of successful) {
			if (row.status === 'live' && row.imageTag) protectedTags.add(row.imageTag);
		}
		for (const row of successful.slice(0, keepPerProject)) {
			if (row.imageTag) protectedTags.add(row.imageTag);
		}

		const candidates = present.filter(
			(tag) => belongsToProject(tag, project.slug) && !protectedTags.has(tag)
		);
		for (const tag of candidates) {
			const result = await runner.exec('docker', ['rmi', tag]);
			if (result.exitCode === 0) removed.push(tag);
		}
	}

	if (removed.length > 0) {
		await db
			.update(deployments)
			.set({ imageTag: null })
			.where(inArray(deployments.imageTag, removed));
	}

	return removed;
}

/**
 * Remove control-plane images left behind by self-updates. The running
 * version is refused by Docker because its container uses it.
 */
export async function pruneControlPlaneImages(runner: CommandRunner): Promise<string[]> {
	const listed = await runner.exec('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}']);
	if (listed.exitCode !== 0) return [];

	const removed: string[] = [];
	for (const tag of listed.stdout.split('\n').map((line) => line.trim())) {
		if (!tag || imageRepository(tag) !== CONTROL_PLANE_IMAGE) continue;
		const result = await runner.exec('docker', ['rmi', tag]);
		if (result.exitCode === 0) removed.push(tag);
	}
	return removed;
}

/**
 * Full Docker housekeeping: old project images, stale control-plane images,
 * dangling layers and the BuildKit cache (trimmed to a fixed size, or dropped
 * entirely when aggressive). Never touches containers or volumes.
 */
export async function pruneDockerResources(
	runner: CommandRunner,
	options: PruneOptions = {}
): Promise<DockerPruneSummary> {
	const imagesRemoved = await pruneProjectImages(
		runner,
		options.keepPerProject ?? KEEP_IMAGES_PER_PROJECT,
		options.projectId
	);
	imagesRemoved.push(...(await pruneControlPlaneImages(runner)));

	const dangling = await runner.exec('docker', ['image', 'prune', '-f']);

	const cacheArgs = options.aggressive
		? ['builder', 'prune', '-af']
		: ['builder', 'prune', '-f', '--keep-storage', BUILD_CACHE_KEEP];
	const cache = await runner.exec('docker', cacheArgs);

	return {
		imagesRemoved,
		danglingReclaimed: parseReclaimed(dangling.stdout),
		buildCacheReclaimed: parseReclaimed(cache.stdout)
	};
}
