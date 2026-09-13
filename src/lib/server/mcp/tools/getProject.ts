import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getProjectDetail } from '$lib/server/projects';
import { handle, ok, projectDetailSchema } from '../schemas';

const description =
	'Read one project: repo, branch, framework, URL, environment variable names (never values), the deployment currently live and the last five. Use it before deploying to confirm you have the right project and what config it already has.';

export function registerGetProject(server: McpServer): void {
	server.registerTool(
		'get_project',
		{
			title: 'Get project',
			description,
			inputSchema: {
				projectId: z.string().describe('Project id, or its slug')
			},
			outputSchema: projectDetailSchema.shape
		},
		async ({ projectId }) =>
			handle(async () => {
				const project = await getProjectDetail(projectId);
				return ok(
					`${project.name} (${project.slug}) — ${project.framework ?? 'no framework detected'}, branch ${project.branch}`,
					project as unknown as Record<string, unknown>
				);
			})
	);
}
