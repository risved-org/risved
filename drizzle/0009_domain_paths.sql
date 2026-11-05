CREATE TABLE `domains_paths` (
 `id` text PRIMARY KEY NOT NULL,
 `project_id` text NOT NULL,
 `hostname` text NOT NULL,
 `path_prefix` text DEFAULT '/' NOT NULL,
 `forwarding_mode` text DEFAULT 'preserve' NOT NULL CHECK (`forwarding_mode` IN ('preserve', 'strip')),
 `is_primary` integer DEFAULT false NOT NULL,
 `ssl_status` text DEFAULT 'pending' NOT NULL,
 `verified_at` text,
 `created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `domains_paths` (`id`, `project_id`, `hostname`, `is_primary`, `ssl_status`, `verified_at`, `created_at`)
 SELECT `id`, `project_id`, `hostname`, `is_primary`, `ssl_status`, `verified_at`, `created_at` FROM `domains`;
--> statement-breakpoint
DROP TABLE `domains`;
--> statement-breakpoint
ALTER TABLE `domains_paths` RENAME TO `domains`;
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_prefix_idx` ON `domains` (`hostname`, `path_prefix`);
