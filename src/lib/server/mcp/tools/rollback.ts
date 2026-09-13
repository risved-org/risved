import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rollbackProject } from '$lib/server/projects';
import { enqueuedDeploymentSchema, handle, ok } from '../schemas';

const description =
	'Redeploy a previous deployment’s cached image, without rebuilding. Take toDeploymentId from get_project’s recentDeployments — it must be one that reached live. Confirm with get_deployment, then check the project URL.';

export function registerRollback(server: McpServer): void {
	server.registerTool(
		'rollback',
		{
			title: 'Roll back',
			description,
			inputSchema: {
				projectId: z.string().describe('Project id, or its slug'),
				toDeploymentId: z
					.string()
					.describe('A previous deployment of this project that reached live')
			},
			outputSchema: enqueuedDeploymentSchema.shape
		},
		async ({ projectId, toDeploymentId }) =>
			handle(async () => {
				const result = await rollbackProject(projectId, toDeploymentId);
				return ok(
					`Rolled back to the image from ${toDeploymentId}; new deployment ${result.deploymentId} is live.`,
					result as unknown as Record<string, unknown>
				);
			})
	);
}
