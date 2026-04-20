import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export const projects = sqliteTable('projects', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	repoUrl: text('repo_url').notNull(),
	branch: text('branch').notNull().default('main'),
	frameworkId: text('framework_id'),
	tier: text('tier'),
	port: integer('port'),
	domain: text('domain'),
	webhookSecret: text('webhook_secret'),
	webhookPushEnabled: integer('webhook_push_enabled', { mode: 'boolean' }).notNull().default(true),
	webhookPrMergedEnabled: integer('webhook_pr_merged_enabled', { mode: 'boolean' })
		.notNull()
		.default(true),
	previewsEnabled: integer('previews_enabled', { mode: 'boolean' }).notNull().default(false),
	previewLimit: integer('preview_limit').notNull().default(3),
	previewAutoDelete: integer('preview_auto_delete', { mode: 'boolean' }).notNull().default(true),
	commitStatusEnabled: integer('commit_status_enabled', { mode: 'boolean' })
		.notNull()
		.default(false),
	requiredCheck: integer('required_check', { mode: 'boolean' }).notNull().default(false),
	buildCommand: text('build_command'),
	startCommand: text('start_command'),
	releaseCommand: text('release_command'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text('updated_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const deployments = sqliteTable('deployments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	projectId: text('project_id').notNull(),
	commitSha: text('commit_sha'),
	status: text('status').notNull().default('pending'),
	triggerType: text('trigger_type').notNull().default('manual'), // 'manual' | 'webhook' | 'rollback'
	imageTag: text('image_tag'),
	containerName: text('container_name'),
	/** The release command that ran (or null if no release phase) */
	releaseCommand: text('release_command'),
	/** Exit code of the release container; null if skipped */
	releaseExitCode: integer('release_exit_code'),
	startedAt: text('started_at'),
	finishedAt: text('finished_at'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const buildLogs = sqliteTable('build_logs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	deploymentId: text('deployment_id').notNull(),
	timestamp: text('timestamp').notNull(),
	phase: text('phase').notNull(),
	level: text('level').notNull().default('info'),
	message: text('message').notNull()
});

export const envVars = sqliteTable(
	'env_vars',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		projectId: text('project_id').notNull(),
		key: text('key').notNull(),
		value: text('value').notNull(),
		isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),
		createdAt: text('created_at')
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		updatedAt: text('updated_at')
			.notNull()
			.$defaultFn(() => new Date().toISOString())
	},
	(table) => [uniqueIndex('env_vars_project_key_idx').on(table.projectId, table.key)]
);

export const domains = sqliteTable('domains', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	projectId: text('project_id').notNull(),
	hostname: text('hostname').notNull().unique(),
	isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
	sslStatus: text('ssl_status').notNull().default('pending'),
	verifiedAt: text('verified_at'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	projectId: text('project_id').notNull(),
	event: text('event').notNull(),
	headers: text('headers').notNull(),
	payload: text('payload').notNull(),
	signatureValid: integer('signature_valid', { mode: 'boolean' }).notNull(),
	actionTaken: text('action_taken'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const gitConnections = sqliteTable('git_connections', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	provider: text('provider').notNull(), // 'github' | 'gitlab' | 'forgejo' | 'gitea'
	accountName: text('account_name').notNull(),
	instanceUrl: text('instance_url'),
	accessToken: text('access_token').notNull(),
	refreshToken: text('refresh_token'),
	tokenExpiresAt: text('token_expires_at'),
	avatarUrl: text('avatar_url'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text('updated_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const previewDeployments = sqliteTable('preview_deployments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	projectId: text('project_id').notNull(),
	prNumber: integer('pr_number').notNull(),
	prTitle: text('pr_title'),
	branch: text('branch').notNull(),
	commitSha: text('commit_sha'),
	deploymentId: text('deployment_id'),
	containerName: text('container_name'),
	port: integer('port'),
	domain: text('domain'),
	status: text('status').notNull().default('building'), // building | active | failed | cleaned
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text('updated_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const resourceMetrics = sqliteTable('resource_metrics', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	projectId: text('project_id').notNull(),
	cpuPercent: integer('cpu_percent').notNull().default(0),
	memoryMb: integer('memory_mb').notNull().default(0),
	memoryLimitMb: integer('memory_limit_mb').notNull().default(0),
	bucket: text('bucket').notNull(), // ISO timestamp truncated to hour
	sampleCount: integer('sample_count').notNull().default(1),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const healthEvents = sqliteTable('health_events', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	projectId: text('project_id').notNull(),
	event: text('event').notNull(), // 'check_failed' | 'restarted' | 'recovered'
	message: text('message').notNull(),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const cronJobs = sqliteTable('cron_jobs', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	projectId: text('project_id').notNull(),
	name: text('name').notNull(),
	route: text('route').notNull(),
	method: text('method').notNull().default('GET'),
	schedule: text('schedule').notNull(),
	timezone: text('timezone').notNull().default('UTC'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text('updated_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const cronRuns = sqliteTable('cron_runs', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	cronJobId: text('cron_job_id').notNull(),
	status: text('status').notNull(), // 'success' | 'failed' | 'timeout'
	statusCode: integer('status_code'),
	responseBody: text('response_body'),
	durationMs: integer('duration_ms'),
	startedAt: text('started_at').notNull(),
	completedAt: text('completed_at')
});

export * from './auth.schema';
