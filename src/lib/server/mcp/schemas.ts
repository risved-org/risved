/**
 * Shared shapes for the MCP surface.
 *
 * These describe what tools return, so an agent can rely on the JSON rather
 * than parsing prose. They mirror the service layer's types — when those
 * change, these must follow.
 */

import { z } from 'zod';
import { ServiceError, type ServiceErrorCode } from '$lib/server/projects';

export const buildHintSchema = z.object({
	code: z.string().describe('Stable machine id, e.g. missing_adapter_node'),
	severity: z.enum(['error', 'warning']),
	message: z.string(),
	fix: z.string().optional().describe('Concrete action that resolves the hint'),
	file: z.string().optional().describe('Path in the repo the hint is about'),
	docsUrl: z.string().optional()
});

export const deploymentSummarySchema = z.object({
	id: z.string(),
	status: z.string().describe('One of: pending, running, live, failed, stopped'),
	terminal: z.boolean().describe('True once the status can no longer change'),
	createdAt: z.string()
});

export const projectSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	repo: z.string(),
	branch: z.string(),
	framework: z.string().nullable(),
	url: z.string().nullable(),
	lastDeployment: deploymentSummarySchema.nullable()
});

export const projectDetailSchema = projectSchema.extend({
	envVarNames: z.array(z.string()).describe('Names only — values are never returned'),
	buildCommand: z.string().nullable(),
	startCommand: z.string().nullable(),
	releaseCommand: z.string().nullable(),
	currentDeployment: deploymentSummarySchema.nullable(),
	recentDeployments: z.array(deploymentSummarySchema),
	createdAt: z.string()
});

export const deploymentDetailSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	status: z.string(),
	terminal: z.boolean(),
	ref: z.string().nullable(),
	commitMessage: z.string().nullable(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
	url: z.string().nullable(),
	buildHints: z.array(buildHintSchema),
	logTail: z.string()
});

export const enqueuedDeploymentSchema = z.object({
	deploymentId: z.string(),
	status: z.string(),
	terminal: z.boolean()
});

/** The MCP result shape both success and failure paths produce. */
export interface ToolResult {
	content: Array<{ type: 'text'; text: string }>;
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
	/* The SDK's CallToolResult allows arbitrary extra keys; match it. */
	[key: string]: unknown;
}

/** A successful result: the JSON agents act on, plus a one-line summary. */
export function ok(summary: string, data: Record<string, unknown>): ToolResult {
	return {
		content: [{ type: 'text', text: summary }],
		structuredContent: data
	};
}

/**
 * A failed result. `code` is the contract; `message` is for the human reading
 * the agent's transcript. Extra fields (installUrl, deploymentId) ride along.
 */
export function fail(
	code: ServiceErrorCode,
	message: string,
	data: Record<string, unknown> = {}
): ToolResult {
	const payload = { code, message, ...data };
	return {
		content: [{ type: 'text', text: JSON.stringify(payload) }],
		structuredContent: payload,
		isError: true
	};
}

/** Who the request is for, and where it arrived. */
export interface McpToolContext {
	/** Resolved from the OAuth token or API key. Tools act as this user. */
	userId: string;
	/** Origin of the MCP request, used to build absolute URLs. */
	origin: string;
}

/**
 * Run a tool body, turning a ServiceError into the tool-error shape and
 * anything unexpected into `internal` — never a raw stack trace over the wire.
 */
export async function handle(run: () => Promise<ToolResult>): Promise<ToolResult> {
	try {
		return await run();
	} catch (err) {
		if (err instanceof ServiceError) {
			return fail(err.code, err.message, err.data);
		}
		console.error('[mcp] tool failed:', err);
		return fail('internal', err instanceof Error ? err.message : 'Unexpected error');
	}
}
