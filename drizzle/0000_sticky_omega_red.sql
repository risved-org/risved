CREATE TABLE `build_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deployment_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`phase` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`route` text NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`schedule` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cron_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`cron_job_id` text NOT NULL,
	`status` text NOT NULL,
	`status_code` integer,
	`response_body` text,
	`duration_ms` integer,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`commit_sha` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`trigger_type` text DEFAULT 'manual' NOT NULL,
	`image_tag` text,
	`container_name` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`hostname` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`ssl_status` text DEFAULT 'pending' NOT NULL,
	`verified_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_unique` ON `domains` (`hostname`);--> statement-breakpoint
CREATE TABLE `env_vars` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`is_secret` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `env_vars_project_key_idx` ON `env_vars` (`project_id`,`key`);--> statement-breakpoint
CREATE TABLE `git_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`account_name` text NOT NULL,
	`instance_url` text,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`token_expires_at` text,
	`avatar_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`event` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preview_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`pr_number` integer NOT NULL,
	`pr_title` text,
	`branch` text NOT NULL,
	`commit_sha` text,
	`deployment_id` text,
	`container_name` text,
	`port` integer,
	`domain` text,
	`status` text DEFAULT 'building' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`repo_url` text NOT NULL,
	`branch` text DEFAULT 'main' NOT NULL,
	`framework_id` text,
	`tier` text,
	`port` integer,
	`domain` text,
	`webhook_secret` text,
	`webhook_push_enabled` integer DEFAULT true NOT NULL,
	`webhook_pr_merged_enabled` integer DEFAULT true NOT NULL,
	`previews_enabled` integer DEFAULT false NOT NULL,
	`preview_limit` integer DEFAULT 3 NOT NULL,
	`preview_auto_delete` integer DEFAULT true NOT NULL,
	`commit_status_enabled` integer DEFAULT false NOT NULL,
	`required_check` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `resource_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`cpu_percent` integer DEFAULT 0 NOT NULL,
	`memory_mb` integer DEFAULT 0 NOT NULL,
	`memory_limit_mb` integer DEFAULT 0 NOT NULL,
	`bucket` text NOT NULL,
	`sample_count` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`event` text NOT NULL,
	`headers` text NOT NULL,
	`payload` text NOT NULL,
	`signature_valid` integer NOT NULL,
	`action_taken` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_userId_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_credentialID_idx` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);