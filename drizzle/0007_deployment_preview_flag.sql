ALTER TABLE `deployments` ADD `is_preview` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `deployments` SET `is_preview` = true
WHERE `id` IN (
	SELECT `deployment_id` FROM `preview_deployments` WHERE `deployment_id` IS NOT NULL
)
OR `container_name` GLOB '*-pr-[0-9]*';
