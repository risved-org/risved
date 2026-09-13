import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deployProject } from '$lib/server/projects';
import { enqueuedDeploymentSchema, handle, ok } from '../schemas';

const description =
	'Start a deployment and return its id immediately — the build runs in the background. Then poll get_deployment until terminal is true. Errors with deploy_in_progress (carrying the running deploymentId) instead of queueing a second build.';

export function registerDeploy(server: McpServer): void {
	server.registerTool(
		'deploy',
		{
			title: 'Deploy project',
			description,
			inputSchema: {
				projectId: z.string().describe('Project id, or its slug'),
				ref: z
					.string()
					.optional()
					.describe("Commit SHA or branch to build. Defaults to the project's branch head")
			},
			outputSchema: enqueuedDeploymentSchema.shape
		},
		async ({ projectId, ref }) =>
			handle(async () => {
				const result = await deployProject(projectId, { ref });
				return ok(
					`Deployment ${result.deploymentId} started. Poll get_deployment until terminal is true.`,
					result as unknown as Record<string, unknown>
				);
			})
	);
}
