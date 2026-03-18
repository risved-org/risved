import { Cron } from 'croner'
import { db } from '$lib/server/db'
import { cronJobs, cronRuns, projects, deployments } from '$lib/server/db/schema'
import { eq, and, lt } from 'drizzle-orm'
import { getSetting } from '$lib/server/settings'
import type { CronSchedulerConfig, CronRunResult } from './types'

export type { CronSchedulerConfig, CronRunResult } from './types'

const DEFAULT_CONFIG: CronSchedulerConfig = {
	maxJobsPerProject: 10,
	timeoutMs: 30_000
}

/**
 * CronScheduler loads enabled cron jobs from the database
 * and executes HTTP requests against deployed containers on schedule.
 */
export class CronScheduler {
	private config: CronSchedulerConfig
	private activeCrons = new Map<string, Cron>()
	private started = false
	/** Swappable fetch for testing */
	fetchFn: typeof fetch = globalThis.fetch

	constructor(config: Partial<CronSchedulerConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/** Load all enabled cron jobs and register them. */
	async start(): Promise<void> {
		if (this.started) return
		this.started = true

		const jobs = await db
			.select()
			.from(cronJobs)
			.where(eq(cronJobs.enabled, true))

		for (const job of jobs) {
			this.register(job)
		}
	}

	/** Stop all active cron jobs. */
	stop(): void {
		for (const cron of this.activeCrons.values()) {
			cron.stop()
		}
		this.activeCrons.clear()
		this.started = false
	}

	/** Register (or re-register) a single cron job. */
	register(job: typeof cronJobs.$inferSelect): void {
		this.unregister(job.id)

		try {
			const cron = new Cron(job.schedule, { timezone: job.timezone }, async () => {
				await this.execute(job.id)
			})
			this.activeCrons.set(job.id, cron)
		} catch {
			/* Invalid cron expression — skip silently */
		}
	}

	/** Unregister and stop a cron job. */
	unregister(jobId: string): void {
		const existing = this.activeCrons.get(jobId)
		if (existing) {
			existing.stop()
			this.activeCrons.delete(jobId)
		}
	}

	/** Check if a job is currently registered. */
	isRegistered(jobId: string): boolean {
		return this.activeCrons.has(jobId)
	}

	/** Get count of active cron jobs. */
	get activeCount(): number {
		return this.activeCrons.size
	}

	/**
	 * Execute a cron job by ID.
	 * Looks up the job, its project, and the live deployment,
	 * then sends an HTTP request to the container.
	 */
	async execute(jobId: string): Promise<CronRunResult | null> {
		const job = await db
			.select()
			.from(cronJobs)
			.where(eq(cronJobs.id, jobId))
			.limit(1)

		if (job.length === 0) return null

		const j = job[0]

		const project = await db
			.select()
			.from(projects)
			.where(eq(projects.id, j.projectId))
			.limit(1)

		if (project.length === 0) return null

		const liveDeployment = await db
			.select()
			.from(deployments)
			.where(and(eq(deployments.projectId, project[0].id), eq(deployments.status, 'live')))
			.limit(1)

		if (liveDeployment.length === 0) return null

		const port = project[0].port
		if (!port) return null

		const url = `http://${project[0].slug}:${port}${j.route}`
		const startedAt = new Date().toISOString()

		const runId = crypto.randomUUID()
		await db.insert(cronRuns).values({
			id: runId,
			cronJobId: j.id,
			status: 'running',
			startedAt
		})

		const startMs = Date.now()

		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

			const response = await this.fetchFn(url, {
				method: j.method,
				signal: controller.signal,
				headers: {
					'X-Risved-Cron': 'true',
					'X-Risved-Cron-Job': j.id
				}
			})

			clearTimeout(timeout)

			const body = await response.text()
			const durationMs = Date.now() - startMs
			const status = response.ok ? 'success' : 'failed'

			const result: CronRunResult = {
				status,
				statusCode: response.status,
				responseBody: body.slice(0, 10240),
				durationMs
			}

			await db
				.update(cronRuns)
				.set({
					status: result.status,
					statusCode: result.statusCode,
					responseBody: result.responseBody,
					durationMs: result.durationMs,
					completedAt: new Date().toISOString()
				})
				.where(eq(cronRuns.id, runId))

			return result
		} catch (err) {
			const durationMs = Date.now() - startMs
			const isTimeout = err instanceof DOMException && err.name === 'AbortError'

			const result: CronRunResult = {
				status: isTimeout ? 'timeout' : 'failed',
				statusCode: null,
				responseBody: isTimeout
					? `Request timed out after ${this.config.timeoutMs / 1000}s`
					: String(err),
				durationMs
			}

			await db
				.update(cronRuns)
				.set({
					status: result.status,
					statusCode: null,
					responseBody: result.responseBody,
					durationMs: result.durationMs,
					completedAt: new Date().toISOString()
				})
				.where(eq(cronRuns.id, runId))

			return result
		}
	}

	/**
	 * Delete cron runs older than the configured retention period.
	 * Called by the cleanup manager.
	 */
	async cleanupOldRuns(retentionDays?: number): Promise<number> {
		const retentionSetting = await getSetting('log_retention_days')
		const days = retentionDays
			?? (retentionSetting ? parseInt(retentionSetting, 10) : 30)
		const validDays = isNaN(days) || days < 1 ? 30 : days

		const cutoff = new Date()
		cutoff.setDate(cutoff.getDate() - validDays)

		const result = await db
			.delete(cronRuns)
			.where(lt(cronRuns.startedAt, cutoff.toISOString()))

		return result.rowsAffected ?? 0
	}

	/**
	 * Remove all cron jobs and runs for a project.
	 * Called when a project is deleted.
	 */
	async deleteProjectJobs(projectId: string): Promise<void> {
		const jobs = await db
			.select({ id: cronJobs.id })
			.from(cronJobs)
			.where(eq(cronJobs.projectId, projectId))

		for (const job of jobs) {
			this.unregister(job.id)
			await db.delete(cronRuns).where(eq(cronRuns.cronJobId, job.id))
		}

		await db.delete(cronJobs).where(eq(cronJobs.projectId, projectId))
	}
}

/* Singleton */
let instance: CronScheduler | null = null

export function getCronScheduler(config?: Partial<CronSchedulerConfig>): CronScheduler {
	if (!instance) {
		instance = new CronScheduler(config)
	}
	return instance
}
