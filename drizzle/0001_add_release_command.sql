ALTER TABLE `projects` ADD `release_command` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `release_command` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD `release_exit_code` integer;
