/**
 * Resolving a `owner/name` reference to a Git connection that can actually
 * deploy it, and reading that repo's files without cloning it.
 *
 * Used by project creation to answer two questions before anything is written
 * to the database: can Risved reach this repo at all, and what is in it?
 */

import { db } from '$lib/server/db';
import { gitConnections } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { safeDecrypt } from '$lib/server/crypto';
import { GitHubClient } from '$lib/server/github';
import type { GitHubRepo } from '$lib/server/github/types';
import type { DetectionContext } from '$lib/server/detection/types';

export interface OwnerRepo {
	owner: string;
	repo: string;
}

/**
 * Parse `owner/name`, `github.com/owner/name` or a full clone URL into its
 * parts. Returns null for anything that is not a GitHub repo reference.
 */
export function parseOwnerRepo(input: string): OwnerRepo | null {
	const trimmed = input
		.trim()
		.replace(/\.git$/, '')
		.replace(/\/+$/, '');
	if (!trimmed) return null;

	/* Full URL, or a scp-style git@github.com:owner/repo */
	let path = trimmed;
	if (/^[a-z]+:\/\//i.test(trimmed)) {
		try {
			const url = new URL(trimmed);
			if (!url.hostname.endsWith('github.com')) return null;
			path = url.pathname.replace(/^\//, '');
		} catch {
			return null;
		}
	} else if (trimmed.startsWith('git@')) {
		const [host, rest] = trimmed.slice(4).split(':');
		if (!host?.endsWith('github.com') || !rest) return null;
		path = rest;
	} else if (trimmed.startsWith('github.com/')) {
		path = trimmed.slice('github.com/'.length);
	}

	const parts = path.split('/').filter(Boolean);
	if (parts.length !== 2) return null;
	if (!/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) return null;

	return { owner: parts[0], repo: parts[1] };
}

export interface ResolvedRepo {
	connectionId: string;
	client: GitHubClient;
	repo: GitHubRepo;
}

/**
 * Find a stored GitHub connection that can see `owner/repo`.
 *
 * Returns null when none can — either no GitHub account is connected, or the
 * connected account has not granted Risved access to that repository. Callers
 * turn that into `github_app_not_installed` plus an install URL.
 */
export async function resolveGitHubRepo(target: OwnerRepo): Promise<ResolvedRepo | null> {
	const connections = await db
		.select()
		.from(gitConnections)
		.where(eq(gitConnections.provider, 'github'));

	for (const connection of connections) {
		const client = new GitHubClient(safeDecrypt(connection.accessToken));
		let repo: GitHubRepo | null = null;
		try {
			repo = await client.getRepo(target.owner, target.repo);
		} catch {
			/* Transient provider failure on one connection — try the next. */
			continue;
		}
		if (repo) return { connectionId: connection.id, client, repo };
	}

	return null;
}

/**
 * Where an agent should send its human to grant Risved access to the repo.
 * Absolute, because the agent renders it in a terminal far from this origin.
 */
export function gitInstallUrl(origin: string): string {
	return new URL('/settings/git', origin).toString();
}

/**
 * A DetectionContext that reads the repo over the GitHub API instead of from a
 * clone, so framework detection and config checks can run before the first
 * build. Files are fetched once and memoised — detectors read the same handful
 * of paths repeatedly.
 */
export function createRemoteDetectionContext(
	client: GitHubClient,
	target: OwnerRepo,
	ref: string,
	rootDir?: string
): DetectionContext {
	const prefix = rootDir ? `${rootDir.replace(/^\/+|\/+$/g, '')}/` : '';
	const cache = new Map<string, Promise<string | null>>();

	function read(path: string): Promise<string | null> {
		const full = `${prefix}${path}`;
		let pending = cache.get(full);
		if (!pending) {
			pending = client.getFileContents(target.owner, target.repo, full, ref).catch(() => null);
			cache.set(full, pending);
		}
		return pending;
	}

	return {
		async fileExists(path: string): Promise<boolean> {
			return (await read(path)) !== null;
		},
		readFile: read
	};
}
