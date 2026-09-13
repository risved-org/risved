import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listProjects } from '$lib/server/projects';
import { handle, ok, projectSchema } from '../schemas';

const description =
	'List every project on this Risved instance with its repo, branch, framework, live URL and latest deployment. Call this first to turn a project name into the projectId every other tool needs.';

export function registerListProjects(server: McpServer): void {
	server.registerTool(
		'list_projects',
		{
			title: 'List projects',
			description,
			inputSchema: {},
			outputSchema: { projects: z.array(projectSchema) }
		},
		async () =>
			handle(async () => {
				const projects = await listProjects();
				const summary =
					projects.length === 0
						? 'No projects yet.'
						: `${projects.length} project(s): ${projects.map((p) => p.slug).join(', ')}`;
				return ok(summary, { projects });
			})
	);
}
