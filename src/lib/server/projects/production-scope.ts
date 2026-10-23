import { sql } from 'drizzle-orm'

/** Exclude explicitly marked previews and legacy previews linked after pipeline completion. */
export function productionDeploymentScope() {
	return sql.raw(
		"deployments.trigger_type != 'preview' AND (deployments.container_name IS NULL OR deployments.container_name = (SELECT slug FROM projects WHERE projects.id = deployments.project_id)) AND NOT EXISTS (SELECT 1 FROM preview_deployments AS preview WHERE preview.deployment_id = deployments.id)"
	)
}
