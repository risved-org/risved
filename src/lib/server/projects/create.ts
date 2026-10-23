import { generateWebhookSecret, slugify } from '$lib/server/api-utils'
import { registerWebhook } from '$lib/server/auto-webhook'
import { db } from '$lib/server/db'
import { projects } from '$lib/server/db/schema'
import { detectFramework } from '$lib/server/detection'
import { detectors } from '$lib/server/detection/detectors'
import type { FrameworkId, FrameworkResult } from '$lib/server/detection/types'
import {
	createRemoteDetectionContext,
	gitInstallUrl,
	parseOwnerRepo,
	resolveGitHubRepo
} from '$lib/server/git-repo'
import { inspectRepoConfig, type BuildHint } from '$lib/server/hints'
import { getManagedAppDomain } from '$lib/server/pipeline/domains'
import { allocatePort } from '$lib/server/pipeline/port'
import { getSetting } from '$lib/server/settings'
import { eq } from 'drizzle-orm'

import { toSummary } from './read'
import { ServiceError, type ProjectSummary } from './types'
export interface CreateProjectInput {
	/** `owner/name`, or a GitHub URL. */
	repo: string
	branch?: string
	name?: string
	/** Subdirectory holding the app, for a monorepo. */
	rootDir?: string
	/** Origin of the request, used to build the install and webhook URLs. */
	origin: string
}

export interface CreateProjectResult {
	project: ProjectSummary
	detectedFramework: FrameworkResult | null
	buildHints: BuildHint[]
}

/**
 * Create a project from a GitHub repo.
 *
 * Nothing is written until the repo is confirmed reachable, so a failed check
 * never leaves a half-made project behind. The project is *not* deployed — the
 * returned hints exist so config can be fixed before the first build.
 */
export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
	if (input.rootDir && input.rootDir !== '.') {
		throw new ServiceError(
			'validation',
			'Creating projects in subdirectories is not supported by this release'
		)
	}
	const target = parseOwnerRepo(input.repo)
	if (!target) {
		throw new ServiceError(
			'validation',
			`"${input.repo}" is not a GitHub repository reference — use owner/name`
		)
	}

	const resolved = await resolveGitHubRepo(target)
	if (!resolved) {
		throw new ServiceError(
			'github_app_not_installed',
			`Risved cannot see ${target.owner}/${target.repo} — connect the GitHub account that owns it, or grant access to the repository`,
			{ installUrl: gitInstallUrl(input.origin) }
		)
	}

	const branch = input.branch?.trim() || resolved.repo.default_branch || 'main'
	const name = input.name?.trim() || resolved.repo.name
	const slug = slugify(name)
	if (!slug) {
		throw new ServiceError('validation', 'name must contain at least one alphanumeric character')
	}

	const existing = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1)
	if (existing.length > 0) {
		throw new ServiceError('validation', `A project with slug "${slug}" already exists`)
	}

	/* Detect and validate against the repo tree over the API — no clone yet. */
	const ctx = createRemoteDetectionContext(resolved.client, target, branch, input.rootDir)
	const detection = await detectFramework(ctx)
	const buildHints = await inspectRepoConfig(ctx, detection.framework)

	const port = await allocatePort()
	const webhookSecret = generateWebhookSecret()
	const domain = (await getManagedAppDomain(slug)) ?? undefined

	const [created] = await db
		.insert(projects)
		.values({
			name,
			slug,
			repoUrl: resolved.repo.clone_url,
			branch,
			gitConnectionId: resolved.connectionId,
			frameworkId: detection.framework?.id,
			tier: detection.framework?.tier,
			domain,
			port,
			webhookSecret
		})
		.returning()

	/* Fire-and-forget, exactly as the import flow does it. */
	const hostname = await getSetting('hostname')
	registerWebhook({
		connectionId: resolved.connectionId,
		repoUrl: created.repoUrl,
		projectId: created.id,
		webhookSecret,
		origin: hostname ? `https://${hostname}` : input.origin
	})

	return {
		project: await toSummary(created, null),
		detectedFramework: detection.framework,
		buildHints
	}
}

/** The framework ids the detectors know about, for input validation. */
export const KNOWN_FRAMEWORK_IDS: FrameworkId[] = detectors.map((d) => d.id)
