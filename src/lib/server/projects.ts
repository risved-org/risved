/**
 * Project service layer.
 *
 * The operations behind both the dashboard and the MCP server: create a
 * project, deploy it, read a deployment, set env vars, roll back. Route
 * handlers and MCP tools are thin wrappers — the rules live here, once.
 */

import { db } from '$lib/server/db';
import { projects, deployments, envVars, buildLogs } from '$lib/server/db/schema';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { slugify, generateWebhookSecret } from '$lib/server/api-utils';
import { encrypt } from '$lib/server/crypto';
import { allocatePort } from '$lib/server/pipeline/port';
import { runPipeline } from '$lib/server/pipeline';
import { runRollback } from '$lib/server/pipeline/rollback';
import { createCommandRunner } from '$lib/server/pipeline/docker';
import { getManagedAppDomain } from '$lib/server/pipeline/domains';
import { detectFramework } from '$lib/server/detection';
import { detectors } from '$lib/server/detection/detectors';
import { registerWebhook } from '$lib/server/auto-webhook';
import { getSetting } from '$lib/server/settings';
import { inspectRepoConfig, hintsFromLogs, type BuildHint } from '$lib/server/hints';
import {
	createRemoteDetectionContext,
	gitInstallUrl,
	parseOwnerRepo,
	resolveGitHubRepo
} from '$lib/server/git-repo';
import type { FrameworkId, FrameworkResult, Tier } from '$lib/server/detection/types';

/** Error codes shared by every caller of this module. */
export type ServiceErrorCode =
	| 'not_found'
	| 'forbidden'
	| 'validation'
	| 'github_app_not_installed'
	| 'deploy_in_progress'
	| 'internal';

/** A failure a caller is expected to render, not a crash. */
export class ServiceError extends Error {
	constructor(
		readonly code: ServiceErrorCode,
		message: string,
		/** Extra fields the caller should pass through, e.g. `installUrl`. */
		readonly data: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'ServiceError';
	}
}

/**
 * Deployment statuses, as written by the pipeline. `pending` only exists as the
 * column default; the pipeline moves straight to `running`.
 */
export const DEPLOYMENT_STATUSES = ['pending', 'running', 'live', 'failed', 'stopped'] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/** Statuses that will never change again — an agent can stop polling. */
export const TERMINAL_STATUSES: readonly string[] = ['live', 'failed', 'stopped'];

export function isTerminalStatus(status: string): boolean {
	return TERMINAL_STATUSES.includes(status);
}

export interface DeploymentSummary {
	id: string;
	status: string;
	terminal: boolean;
	createdAt: string;
}

export interface ProjectSummary {
	id: string;
	name: string;
	slug: string;
	repo: string;
	branch: string;
	framework: string | null;
	url: string | null;
	lastDeployment: DeploymentSummary | null;
}

export interface ProjectDetail extends ProjectSummary {
	/** Names only. Values are never returned — some are secrets, all are noise. */
	envVarNames: string[];
	buildCommand: string | null;
	startCommand: string | null;
	releaseCommand: string | null;
	currentDeployment: DeploymentSummary | null;
	recentDeployments: DeploymentSummary[];
	createdAt: string;
}

export interface DeploymentDetail {
	id: string;
	projectId: string;
	status: string;
	terminal: boolean;
	ref: string | null;
	commitMessage: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	url: string | null;
	buildHints: BuildHint[];
	logTail: string;
}

type ProjectRow = typeof projects.$inferSelect;
type DeploymentRow = typeof deployments.$inferSelect;

function toDeploymentSummary(row: DeploymentRow): DeploymentSummary {
	return {
		id: row.id,
		status: row.status,
		terminal: isTerminalStatus(row.status),
		createdAt: row.createdAt
	};
}

/**
 * The address the project is served at: its own domain, else the wildcard
 * subdomain the control plane routes. Null when neither is configured.
 */
async function projectUrl(project: ProjectRow): Promise<string | null> {
	if (project.domain) return `https://${project.domain}`;
	const managed = await getManagedAppDomain(project.slug);
	return managed ? `https://${managed}` : null;
}

async function toSummary(project: ProjectRow, last: DeploymentRow | null): Promise<ProjectSummary> {
	return {
		id: project.id,
		name: project.name,
		slug: project.slug,
		repo: project.repoUrl,
		branch: project.branch,
		framework: project.frameworkId,
		url: await projectUrl(project),
		lastDeployment: last ? toDeploymentSummary(last) : null
	};
}

/** Every project, newest first, each with its latest deployment. */
export async function listProjects(): Promise<ProjectSummary[]> {
	const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
	if (rows.length === 0) return [];

	/* One query for every project's deployments, then pick the newest per id. */
	const allDeployments = await db
		.select()
		.from(deployments)
		.where(
			inArray(
				deployments.projectId,
				rows.map((r) => r.id)
			)
		)
		.orderBy(desc(deployments.createdAt));

	const latest = new Map<string, DeploymentRow>();
	for (const deployment of allDeployments) {
		if (!latest.has(deployment.projectId)) latest.set(deployment.projectId, deployment);
	}

	return Promise.all(rows.map((row) => toSummary(row, latest.get(row.id) ?? null)));
}

/** Look a project up by id, or by slug when the id is not a match. */
export async function findProject(idOrSlug: string): Promise<ProjectRow | null> {
	const byId = await db.select().from(projects).where(eq(projects.id, idOrSlug)).limit(1);
	if (byId.length > 0) return byId[0];

	const bySlug = await db.select().from(projects).where(eq(projects.slug, idOrSlug)).limit(1);
	return bySlug[0] ?? null;
}

async function requireProject(idOrSlug: string): Promise<ProjectRow> {
	const project = await findProject(idOrSlug);
	if (!project) throw new ServiceError('not_found', `No project with id "${idOrSlug}"`);
	return project;
}

/** Project detail: env var names, current deployment, and the last five. */
export async function getProjectDetail(projectId: string): Promise<ProjectDetail> {
	const project = await requireProject(projectId);

	const recent = await db
		.select()
		.from(deployments)
		.where(eq(deployments.projectId, project.id))
		.orderBy(desc(deployments.createdAt))
		.limit(5);

	const envRows = await db
		.select({ key: envVars.key })
		.from(envVars)
		.where(eq(envVars.projectId, project.id))
		.orderBy(asc(envVars.key));

	const current = recent.find((d) => d.status === 'live') ?? null;
	const summary = await toSummary(project, recent[0] ?? null);

	return {
		...summary,
		envVarNames: envRows.map((r) => r.key),
		buildCommand: project.buildCommand,
		startCommand: project.startCommand,
		releaseCommand: project.releaseCommand,
		currentDeployment: current ? toDeploymentSummary(current) : null,
		recentDeployments: recent.map(toDeploymentSummary),
		createdAt: project.createdAt
	};
}

export interface CreateProjectInput {
	/** `owner/name`, or a GitHub URL. */
	repo: string;
	branch?: string;
	name?: string;
	/** Subdirectory holding the app, for a monorepo. */
	rootDir?: string;
	/** Origin of the request, used to build the install and webhook URLs. */
	origin: string;
}

export interface CreateProjectResult {
	project: ProjectSummary;
	detectedFramework: FrameworkResult | null;
	buildHints: BuildHint[];
}

/**
 * Create a project from a GitHub repo.
 *
 * Nothing is written until the repo is confirmed reachable, so a failed check
 * never leaves a half-made project behind. The project is *not* deployed — the
 * returned hints exist so config can be fixed before the first build.
 */
export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
	const target = parseOwnerRepo(input.repo);
	if (!target) {
		throw new ServiceError(
			'validation',
			`"${input.repo}" is not a GitHub repository reference — use owner/name`
		);
	}

	const resolved = await resolveGitHubRepo(target);
	if (!resolved) {
		throw new ServiceError(
			'github_app_not_installed',
			`Risved cannot see ${target.owner}/${target.repo} — connect the GitHub account that owns it, or grant access to the repository`,
			{ installUrl: gitInstallUrl(input.origin) }
		);
	}

	const branch = input.branch?.trim() || resolved.repo.default_branch || 'main';
	const name = input.name?.trim() || resolved.repo.name;
	const slug = slugify(name);
	if (!slug) {
		throw new ServiceError('validation', 'name must contain at least one alphanumeric character');
	}

	const existing = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
	if (existing.length > 0) {
		throw new ServiceError('validation', `A project with slug "${slug}" already exists`);
	}

	/* Detect and validate against the repo tree over the API — no clone yet. */
	const ctx = createRemoteDetectionContext(resolved.client, target, branch, input.rootDir);
	const detection = await detectFramework(ctx);
	const buildHints = await inspectRepoConfig(ctx, detection.framework);

	const port = await allocatePort();
	const webhookSecret = generateWebhookSecret();
	const domain = await defaultProjectDomain(slug);

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
		.returning();

	/* Fire-and-forget, exactly as the import flow does it. */
	const hostname = await getSetting('hostname');
	registerWebhook({
		connectionId: resolved.connectionId,
		repoUrl: created.repoUrl,
		projectId: created.id,
		webhookSecret,
		origin: hostname ? `https://${hostname}` : input.origin
	});

	return {
		project: await toSummary(created, null),
		detectedFramework: detection.framework,
		buildHints
	};
}

/** The wildcard subdomain a new project gets, when one is configured. */
async function defaultProjectDomain(slug: string): Promise<string | undefined> {
	const raw = await getSetting('domain_config');
	if (!raw) return undefined;
	try {
		const { baseDomain } = JSON.parse(raw) as { baseDomain?: string };
		return baseDomain ? `${slug}.${baseDomain}` : undefined;
	} catch {
		return undefined;
	}
}

/** The framework ids the detectors know about, for input validation. */
export const KNOWN_FRAMEWORK_IDS: FrameworkId[] = detectors.map((d) => d.id);

export interface EnqueuedDeployment {
	deploymentId: string;
	status: string;
	terminal: boolean;
}

export interface DeployOptions {
	/** Commit SHA or branch to build. Defaults to the project's branch head. */
	ref?: string;
	/**
	 * Queue behind a build that is already running instead of refusing.
	 *
	 * The dashboard does this — a person pressing Deploy means "again, now",
	 * and the pipeline serialises per project anyway. Agents do not: a retry
	 * loop that queues a build per poll is how you get twelve of them.
	 */
	allowConcurrent?: boolean;
}

/**
 * Start a deployment for a project.
 *
 * Returns as soon as the deployment row exists; the build runs in the
 * background. Throws `deploy_in_progress`, carrying the running deployment's
 * id, unless the caller opted into queueing.
 */
export async function deployProject(
	projectId: string,
	options: DeployOptions = {}
): Promise<EnqueuedDeployment> {
	const project = await requireProject(projectId);

	if (!project.port) {
		throw new ServiceError('validation', 'Project has no port allocated');
	}

	if (!options.allowConcurrent) {
		const running = await findRunningDeployment(project.id);
		if (running) {
			throw new ServiceError(
				'deploy_in_progress',
				`A deployment is already running for "${project.slug}"`,
				{ deploymentId: running.id, status: running.status }
			);
		}
	}

	const deploymentId = crypto.randomUUID();
	await db.insert(deployments).values({
		id: deploymentId,
		projectId: project.id,
		status: 'running',
		startedAt: new Date().toISOString()
	});

	/* Background: the caller gets the id immediately and polls for the rest. */
	runPipeline(pipelineConfig(project, options.ref), createCommandRunner(), { deploymentId }).catch(
		(err) => {
			console.error(`[deploy] Pipeline error for ${project.slug}:`, err);
		}
	);

	return { deploymentId, status: 'running', terminal: false };
}

/** The in-flight deployment for a project, if there is one. */
export async function findRunningDeployment(projectId: string): Promise<DeploymentRow | null> {
	const rows = await db
		.select()
		.from(deployments)
		.where(
			and(eq(deployments.projectId, projectId), inArray(deployments.status, ['pending', 'running']))
		)
		.orderBy(desc(deployments.createdAt))
		.limit(1);
	return rows[0] ?? null;
}

/** Build the pipeline config for a project row, optionally pinned to a ref. */
export function pipelineConfig(project: ProjectRow, ref?: string) {
	return {
		projectId: project.id,
		projectSlug: project.slug,
		repoUrl: project.repoUrl,
		branch: project.branch,
		checkoutRef: ref?.trim() || null,
		gitConnectionId: project.gitConnectionId,
		port: project.port!,
		domain: project.domain ?? undefined,
		frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
		tier: (project.tier as Tier) ?? undefined,
		buildCommand: project.buildCommand,
		startCommand: project.startCommand,
		releaseCommand: project.releaseCommand,
		postgresEnabled: project.postgresEnabled,
		postgresPassword: project.postgresPassword
	};
}

const DEFAULT_LOG_LINES = 80;
const MAX_LOG_LINES = 400;

/**
 * A deployment with the tail of its build output and any hints derived from it.
 *
 * `logLines` is clamped to [1, 400]: the point is a tail an agent can read in
 * one go, not the whole build.
 */
export async function getDeploymentDetail(
	deploymentId: string,
	logLines = DEFAULT_LOG_LINES
): Promise<DeploymentDetail> {
	const rows = await db.select().from(deployments).where(eq(deployments.id, deploymentId)).limit(1);

	const deployment = rows[0];
	if (!deployment) {
		throw new ServiceError('not_found', `No deployment with id "${deploymentId}"`);
	}

	const project = (
		await db.select().from(projects).where(eq(projects.id, deployment.projectId)).limit(1)
	)[0];

	const limit = Math.min(Math.max(Math.trunc(logLines) || DEFAULT_LOG_LINES, 1), MAX_LOG_LINES);

	/* Newest `limit` rows, then flip back into reading order. */
	const tail = (
		await db
			.select()
			.from(buildLogs)
			.where(eq(buildLogs.deploymentId, deployment.id))
			.orderBy(desc(buildLogs.id))
			.limit(limit)
	).reverse();

	return {
		id: deployment.id,
		projectId: deployment.projectId,
		status: deployment.status,
		terminal: isTerminalStatus(deployment.status),
		ref: deployment.commitSha,
		commitMessage: null,
		startedAt: deployment.startedAt,
		finishedAt: deployment.finishedAt,
		url: project ? await projectUrl(project) : null,
		buildHints: hintsFromLogs(tail),
		logTail: tail.map((l) => `[${l.phase}] ${l.message}`).join('\n')
	};
}

/**
 * Redeploy a previous deployment's cached image.
 *
 * Runs synchronously in the pipeline's rollback path (no rebuild, so it is
 * quick) but returns the same shape as `deployProject`.
 */
export async function rollbackProject(
	projectId: string,
	toDeploymentId: string
): Promise<EnqueuedDeployment> {
	const project = await requireProject(projectId);

	if (!project.port) {
		throw new ServiceError('validation', 'Project has no port allocated');
	}

	const rows = await db
		.select()
		.from(deployments)
		.where(and(eq(deployments.id, toDeploymentId), eq(deployments.projectId, project.id)))
		.limit(1);

	const target = rows[0];
	if (!target) {
		throw new ServiceError(
			'not_found',
			`Deployment "${toDeploymentId}" does not belong to project "${project.slug}"`
		);
	}
	if (target.status !== 'live' && target.status !== 'stopped') {
		throw new ServiceError(
			'validation',
			'Can only roll back to a previously successful deployment'
		);
	}
	if (!target.imageTag) {
		throw new ServiceError('validation', 'That deployment has no cached image to roll back to');
	}

	/*
	 * Deliberately not guarded on a running deployment: a rollback is usually a
	 * response to the build that is running. The pipeline's per-project lock
	 * keeps the container work serialised.
	 */
	const result = await runRollback(
		{
			projectId: project.id,
			projectSlug: project.slug,
			imageTag: target.imageTag,
			commitSha: target.commitSha,
			port: project.port,
			domain: project.domain ?? undefined
		},
		createCommandRunner()
	);

	if (!result.success) {
		throw new ServiceError('internal', result.error ?? 'Rollback failed', {
			deploymentId: result.deploymentId
		});
	}

	return { deploymentId: result.deploymentId, status: 'live', terminal: true };
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SetEnvResult {
	names: string[];
	removed: string[];
	requiresRedeploy: boolean;
}

/**
 * Upsert and remove environment variables in one call.
 *
 * Does not redeploy: env vars are read at container start, so the caller
 * decides when the change lands. Returns names only.
 */
export async function setProjectEnv(
	projectId: string,
	vars: Record<string, string>,
	remove: string[] = []
): Promise<SetEnvResult> {
	const project = await requireProject(projectId);

	const entries = Object.entries(vars ?? {});
	const invalid = entries
		.map(([key]) => key)
		.concat(remove ?? [])
		.filter((key) => !ENV_KEY_PATTERN.test(key));

	if (invalid.length > 0) {
		throw new ServiceError(
			'validation',
			`Invalid environment variable name(s): ${invalid.join(', ')} — letters, digits and underscores only, not starting with a digit`
		);
	}

	const now = new Date().toISOString();

	for (const [key, value] of entries) {
		await db
			.insert(envVars)
			.values({
				projectId: project.id,
				key,
				value: encrypt(String(value)),
				/* Set over the API without a UI to reveal them — treat as secret. */
				isSecret: true
			})
			.onConflictDoUpdate({
				target: [envVars.projectId, envVars.key],
				set: { value: encrypt(String(value)), updatedAt: now }
			});
	}

	for (const key of remove ?? []) {
		await db.delete(envVars).where(and(eq(envVars.projectId, project.id), eq(envVars.key, key)));
	}

	const remaining = await db
		.select({ key: envVars.key })
		.from(envVars)
		.where(eq(envVars.projectId, project.id))
		.orderBy(asc(envVars.key));

	return {
		names: remaining.map((r) => r.key),
		removed: remove ?? [],
		requiresRedeploy: true
	};
}
