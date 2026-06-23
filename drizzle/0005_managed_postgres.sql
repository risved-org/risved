ALTER TABLE `projects` ADD `postgres_enabled` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD `postgres_password` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD `postgres_created_at` text;
