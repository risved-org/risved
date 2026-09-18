CREATE TABLE `bandwidth_daily` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`day` text NOT NULL,
	`rx_bytes` integer DEFAULT 0 NOT NULL,
	`tx_bytes` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bandwidth_daily_project_day_idx` ON `bandwidth_daily` (`project_id`,`day`);
