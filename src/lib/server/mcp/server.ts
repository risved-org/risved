/**
 * The Risved MCP server.
 *
 * Stateless: a fresh McpServer is built per request from the authenticated
 * user's context, so nothing leaks between requests and no session state has
 * to be reaped. Tools are thin — the rules live in `lib/server/projects.ts`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListProjects } from './tools/listProjects';
import { registerGetProject } from './tools/getProject';
import { registerCreateProject } from './tools/createProject';
import { registerSetEnv } from './tools/setEnv';
import { registerDeploy } from './tools/deploy';
import { registerGetDeployment } from './tools/getDeployment';
import { registerRollback } from './tools/rollback';
import type { McpToolContext } from './schemas';

export const MCP_SERVER_NAME = 'risved';

const instructions = `Risved deploys Git repositories to this server.

Typical flow: list_projects to find a projectId, create_project for a new repo,
fix any buildHints with severity "error", deploy, then poll get_deployment until
terminal is true. Environment variables set with set_env only reach the
container on the next deploy.`;

/**
 * Build a server instance for one request.
 *
 * `ctx` carries the resolved user and the request origin — tools that return
 * absolute URLs need the latter, since the agent is nowhere near this host.
 */
export function createMcpServer(ctx: McpToolContext, version: string): McpServer {
	const server = new McpServer(
		{ name: MCP_SERVER_NAME, version },
		{ capabilities: { tools: {} }, instructions }
	);

	registerListProjects(server);
	registerGetProject(server);
	registerCreateProject(server, ctx);
	registerSetEnv(server);
	registerDeploy(server);
	registerGetDeployment(server);
	registerRollback(server);

	return server;
}
