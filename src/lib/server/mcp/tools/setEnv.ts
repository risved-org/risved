import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setProjectEnv } from '$lib/server/projects';
import { handle, ok } from '../schemas';

const description =
	'Set and remove a project’s environment variables in one call. Values are write-only — nothing here or in get_project ever reads them back. Does not redeploy: call deploy afterwards for the new values to reach the container.';

export function registerSetEnv(server: McpServer): void {
	server.registerTool(
		'set_env',
		{
			title: 'Set environment variables',
			description,
			inputSchema: {
				projectId: z.string().describe('Project id, or its slug'),
				vars: z.record(z.string(), z.string()).describe('Variables to set or overwrite'),
				remove: z.array(z.string()).optional().describe('Variable names to delete')
			},
			outputSchema: {
				names: z.array(z.string()).describe('All variable names on the project after the change'),
				removed: z.array(z.string()),
				requiresRedeploy: z.boolean()
			}
		},
		async ({ projectId, vars, remove }) =>
			handle(async () => {
				const result = await setProjectEnv(projectId, vars, remove);
				return ok(
					`${Object.keys(vars ?? {}).length} set, ${result.removed.length} removed. Deploy for the change to take effect.`,
					result as unknown as Record<string, unknown>
				);
			})
	);
}
