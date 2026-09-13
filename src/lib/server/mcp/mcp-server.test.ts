import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/* ── Mocks: the MCP layer is a wrapper, so the service is stubbed out ── */

const service = vi.hoisted(() => ({
	listProjects: vi.fn(),
	getProjectDetail: vi.fn(),
	createProject: vi.fn(),
	setProjectEnv: vi.fn(),
	deployProject: vi.fn(),
	getDeploymentDetail: vi.fn(),
	rollbackProject: vi.fn()
}));

vi.mock('$lib/server/projects', async () => {
	/* ServiceError is real — the error mapping under test depends on it. */
	class ServiceError extends Error {
		constructor(
			readonly code: string,
			message: string,
			readonly data: Record<string, unknown> = {}
		) {
			super(message);
			this.name = 'ServiceError';
		}
	}
	return { ...service, ServiceError };
});

import { createMcpServer } from './server';
import { ServiceError } from '$lib/server/projects';

const deployment = {
	id: 'd-1',
	status: 'live',
	terminal: true,
	createdAt: '2026-01-01T00:00:00.000Z'
};

const project = {
	id: 'p-1',
	name: 'My App',
	slug: 'my-app',
	repo: 'https://github.com/o/r.git',
	branch: 'main',
	framework: 'sveltekit',
	url: 'https://my-app.example.com',
	lastDeployment: deployment
};

/** Connect a client to a fresh server over an in-memory pair. */
async function connect() {
	const server = createMcpServer({ userId: 'u-1', origin: 'https://risved.test' }, '1.2.3');
	const client = new Client({ name: 'test', version: '0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

	return { client, close: () => Promise.all([client.close(), server.close()]) };
}

beforeEach(() => vi.clearAllMocks());

describe('tool registration', () => {
	it('exposes exactly the documented tools', async () => {
		const { client, close } = await connect();

		const { tools } = await client.listTools();

		expect(tools.map((t) => t.name).sort()).toEqual([
			'create_project',
			'deploy',
			'get_deployment',
			'get_project',
			'list_projects',
			'rollback',
			'set_env'
		]);
		await close();
	});

	it('gives every tool a description an agent can act on', async () => {
		const { client, close } = await connect();

		const { tools } = await client.listTools();

		for (const tool of tools) {
			expect(tool.description, tool.name).toBeTruthy();
			/* The spec caps descriptions at 60 words. */
			expect(tool.description!.split(/\s+/).length, tool.name).toBeLessThanOrEqual(60);
			expect(tool.outputSchema, tool.name).toBeDefined();
		}
		await close();
	});
});

describe('list_projects', () => {
	it('returns the projects as structured content', async () => {
		service.listProjects.mockResolvedValue([project]);
		const { client, close } = await connect();

		const result = await client.callTool({ name: 'list_projects', arguments: {} });

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({ projects: [project] });
		await close();
	});
});

describe('create_project', () => {
	it('passes the request origin through so installUrl is absolute', async () => {
		service.createProject.mockRejectedValue(
			new ServiceError('github_app_not_installed', 'cannot see it', {
				installUrl: 'https://risved.test/settings/git'
			})
		);
		const { client, close } = await connect();

		const result = await client.callTool({
			name: 'create_project',
			arguments: { repo: 'o/r' }
		});

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			code: 'github_app_not_installed',
			installUrl: 'https://risved.test/settings/git'
		});
		expect(service.createProject.mock.calls[0][0]).toMatchObject({
			origin: 'https://risved.test'
		});
		await close();
	});

	it('returns the framework and hints on success', async () => {
		service.createProject.mockResolvedValue({
			project,
			detectedFramework: {
				id: 'sveltekit',
				name: 'SvelteKit',
				tier: 'node',
				confidence: 'high'
			},
			buildHints: [
				{
					code: 'missing_adapter_node',
					severity: 'error',
					message: 'needs adapter-node',
					fix: 'npm i -D @sveltejs/adapter-node'
				}
			]
		});
		const { client, close } = await connect();

		const result = await client.callTool({
			name: 'create_project',
			arguments: { repo: 'o/r' }
		});

		expect(result.isError).toBeFalsy();
		const data = result.structuredContent as Record<string, unknown>;
		expect(data.detectedFramework).toMatchObject({ id: 'sveltekit' });
		expect(data.buildHints).toHaveLength(1);
		await close();
	});
});

describe('deploy', () => {
	it('reports deploy_in_progress with the running deployment id', async () => {
		service.deployProject.mockRejectedValue(
			new ServiceError('deploy_in_progress', 'already running', { deploymentId: 'd-running' })
		);
		const { client, close } = await connect();

		const result = await client.callTool({ name: 'deploy', arguments: { projectId: 'p-1' } });

		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			code: 'deploy_in_progress',
			deploymentId: 'd-running'
		});
		await close();
	});

	it('does not allow concurrent builds for agents', async () => {
		service.deployProject.mockResolvedValue({
			deploymentId: 'd-2',
			status: 'running',
			terminal: false
		});
		const { client, close } = await connect();

		await client.callTool({ name: 'deploy', arguments: { projectId: 'p-1', ref: 'abc' } });

		expect(service.deployProject).toHaveBeenCalledWith('p-1', { ref: 'abc' });
		await close();
	});
});

describe('get_deployment', () => {
	it('rejects a logLines value above the documented maximum', async () => {
		const { client, close } = await connect();

		const result = await client.callTool({
			name: 'get_deployment',
			arguments: { deploymentId: 'd-1', logLines: 5000 }
		});

		expect(result.isError).toBe(true);
		expect(service.getDeploymentDetail).not.toHaveBeenCalled();
		await close();
	});

	it('returns the tail and terminal flag', async () => {
		service.getDeploymentDetail.mockResolvedValue({
			id: 'd-1',
			projectId: 'p-1',
			status: 'failed',
			terminal: true,
			ref: 'abc1234',
			commitMessage: null,
			startedAt: null,
			finishedAt: null,
			url: null,
			buildHints: [{ code: 'typescript_error', severity: 'error', message: 'type error' }],
			logTail: '[build] error TS2304'
		});
		const { client, close } = await connect();

		const result = await client.callTool({
			name: 'get_deployment',
			arguments: { deploymentId: 'd-1' }
		});

		expect(result.structuredContent).toMatchObject({ terminal: true, status: 'failed' });
		await close();
	});
});

describe('set_env', () => {
	it('never echoes a value back', async () => {
		service.setProjectEnv.mockResolvedValue({
			names: ['TOKEN'],
			removed: [],
			requiresRedeploy: true
		});
		const { client, close } = await connect();

		const result = await client.callTool({
			name: 'set_env',
			arguments: { projectId: 'p-1', vars: { TOKEN: 'sekrit' } }
		});

		expect(JSON.stringify(result)).not.toContain('sekrit');
		expect(result.structuredContent).toMatchObject({ requiresRedeploy: true });
		await close();
	});
});

describe('unexpected failures', () => {
	it('come back as internal, not as a stack trace', async () => {
		service.getProjectDetail.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'));
		const { client, close } = await connect();

		const result = await client.callTool({
			name: 'get_project',
			arguments: { projectId: 'p-1' }
		});

		expect(result.structuredContent).toMatchObject({ code: 'internal' });
		expect(JSON.stringify(result)).not.toContain('at Module');
		await close();
	});
});
