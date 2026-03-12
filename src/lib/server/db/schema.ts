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
	imageTag: text('image_tag'),
	containerName: text('container_name'),
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

export * from './auth.schema';
