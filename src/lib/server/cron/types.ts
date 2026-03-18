export interface CronSchedulerConfig {
	/** Maximum cron jobs per project (default: 10) */
	maxJobsPerProject: number
	/** HTTP request timeout in ms (default: 30000) */
	timeoutMs: number
}

export interface CronRunResult {
	status: 'success' | 'failed' | 'timeout'
	statusCode: number | null
	responseBody: string | null
	durationMs: number
}
