import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDeploymentDetail } from '$lib/server/projects';
import { deploymentDetailSchema, handle, ok } from '../schemas';

const description =
	'Read a deployment: status, timings, the live URL, the tail of its build output and structured buildHints. Poll it until terminal is true. If it ends failed, fix the buildHints marked "error" and call deploy again.';

export function registerGetDeployment(server: McpServer): void {
	server.registerTool(
		'get_deployment',
		{
			title: 'Get deployment',
			description,
			inputSchema: {
				deploymentId: z.string(),
				logLines: z
					.number()
					.int()
					.min(1)
					.max(400)
					.optional()
					.describe('Lines of build output to return, newest last. Default 80, max 400')
			},
			outputSchema: deploymentDetailSchema.shape
		},
		async ({ deploymentId, logLines }) =>
			handle(async () => {
				const deployment = await getDeploymentDetail(deploymentId, logLines);
				const errors = deployment.buildHints.filter((h) => h.severity === 'error');
				const summary =
					`${deployment.status}${deployment.terminal ? ' (terminal)' : ' — still running, poll again'}` +
					(errors.length > 0 ? `; ${errors.length} error hint(s)` : '');
				return ok(summary, deployment as unknown as Record<string, unknown>);
			})
	);
}
