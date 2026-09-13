import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createProject } from '$lib/server/projects';
import { buildHintSchema, handle, ok, projectSchema, type McpToolContext } from '../schemas';

const description =
	'Create a project from a GitHub repo. Does not deploy. Returns the detected framework and buildHints — fix every hint with severity "error" first, then call deploy. If it errors with github_app_not_installed, send the user to the returned installUrl.';

export function registerCreateProject(server: McpServer, ctx: McpToolContext): void {
	server.registerTool(
		'create_project',
		{
			title: 'Create project',
			description,
			inputSchema: {
				repo: z.string().describe('GitHub repository as owner/name'),
				branch: z
					.string()
					.optional()
					.describe("Branch to deploy. Defaults to the repo's default branch"),
				name: z.string().optional().describe('Project name. Defaults to the repo name'),
				rootDir: z.string().optional().describe('Subdirectory holding the app, for a monorepo')
			},
			outputSchema: {
				project: projectSchema,
				detectedFramework: z
					.object({
						id: z.string(),
						name: z.string(),
						tier: z.string(),
						confidence: z.string()
					})
					.nullable(),
				buildHints: z.array(buildHintSchema)
			}
		},
		async ({ repo, branch, name, rootDir }) =>
			handle(async () => {
				const result = await createProject({ repo, branch, name, rootDir, origin: ctx.origin });
				const errors = result.buildHints.filter((h) => h.severity === 'error');
				const summary =
					`Created ${result.project.slug} from ${repo} (${result.detectedFramework?.name ?? 'no framework detected'}). ` +
					(errors.length > 0
						? `${errors.length} blocking hint(s) — fix them before deploying.`
						: 'No blocking hints; ready to deploy.');

				return ok(summary, {
					project: result.project,
					detectedFramework: result.detectedFramework
						? {
								id: result.detectedFramework.id,
								name: result.detectedFramework.name,
								tier: result.detectedFramework.tier,
								confidence: result.detectedFramework.confidence
							}
						: null,
					buildHints: result.buildHints
				});
			})
	);
}
