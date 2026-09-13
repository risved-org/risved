import type { BuildHint } from '$lib/server/hints'

/** Error codes shared by every caller of this module. */
export type ServiceErrorCode =
	| 'not_found'
	| 'forbidden'
	| 'validation'
	| 'github_app_not_installed'
	| 'deploy_in_progress'
	| 'internal'

/** A failure a caller is expected to render, not a crash. */
export class ServiceError extends Error {
	constructor(
		readonly code: ServiceErrorCode,
		message: string,
		/** Extra fields the caller should pass through, e.g. `installUrl`. */
		readonly data: Record<string, unknown> = {}
	) {
		super(message)
		this.name = 'ServiceError'
	}
}

/**
 * Deployment statuses, as written by the pipeline. `pending` only exists as the
 * column default; the pipeline moves straight to `running`.
 */
export const DEPLOYMENT_STATUSES = [
	'pending',
	'running',
	'live',
	'failed',
	'stopped',
	'superseded'
] as const
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number]

/** Statuses that will never change again — an agent can stop polling. */
export const TERMINAL_STATUSES: readonly string[] = ['live', 'failed', 'stopped', 'superseded']

export function isTerminalStatus(status: string): boolean {
	return TERMINAL_STATUSES.includes(status)
}

export interface DeploymentSummary {
	id: string
	status: string
	terminal: boolean
	createdAt: string
}

export interface ProjectSummary {
	id: string
	name: string
	slug: string
	repo: string
	branch: string
	framework: string | null
	url: string | null
	lastDeployment: DeploymentSummary | null
}

export interface ProjectDetail extends ProjectSummary {
	/** Names only. Values are never returned — some are secrets, all are noise. */
	envVarNames: string[]
	buildCommand: string | null
	startCommand: string | null
	releaseCommand: string | null
	currentDeployment: DeploymentSummary | null
	recentDeployments: DeploymentSummary[]
	createdAt: string
}

export interface DeploymentDetail {
	id: string
	projectId: string
	status: string
	terminal: boolean
	ref: string | null
	commitMessage: string | null
	startedAt: string | null
	finishedAt: string | null
	url: string | null
	buildHints: BuildHint[]
	logTail: string
}
