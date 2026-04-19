import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, jsonError } from '$lib/server/api-utils';
import { GitHubClient } from '$lib/server/github';
import { safeDecrypt } from '$lib/server/crypto';
import { detectScripts, type DetectedLockfile, type Lockfile } from '$lib/scripts-detect';
import type { RequestHandler } from './$types';

const LOCKFILES: Lockfile[] = [
	'bun.lockb',
	'bun.lock',
	'pnpm-lock.yaml',
	'yarn.lock',
	'package-lock.json'
];

/**
 * GET /api/git/github/detect-scripts — parse package.json scripts for onboarding suggestions.
 * Query params: connectionId, owner, repo, branch
 *
 * Cosmetic only: result is displayed as chips in the UI. Must never feed
 * deploy behaviour.
 */
export const GET: RequestHandler = async (event) => {
	await requireAuth(event);

	const { searchParams } = event.url;
	const connectionId = searchParams.get('connectionId');
	const owner = searchParams.get('owner');
	const repo = searchParams.get('repo');
	const branch = searchParams.get('branch');

	if (!connectionId || !owner || !repo || !branch) {
		return jsonError(400, 'connectionId, owner, repo, and branch are required');
	}

	const rows = await db
		.select()
		.from(gitConnections)
		.where(eq(gitConnections.id, connectionId))
		.limit(1);

	if (rows.length === 0) {
		return jsonError(404, 'Connection not found');
	}

	const client = new GitHubClient(safeDecrypt(rows[0].accessToken));

	/* Root directory listing tells us which lockfiles are present. */
	const rootFiles = await client.listRootFiles(owner, repo, branch);
	const presentLockfiles: DetectedLockfile[] = [];
	for (const file of rootFiles) {
		if (file.type !== 'file') continue;
		if ((LOCKFILES as string[]).includes(file.name)) {
			presentLockfiles.push({ name: file.name as Lockfile });
		}
	}

	const pkgJson = await client.getFileContents(owner, repo, 'package.json', branch);

	const detection = detectScripts(pkgJson, presentLockfiles);
	return json(detection);
};
