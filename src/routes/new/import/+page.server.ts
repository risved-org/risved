import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { gitConnections, projects, envVars } from '$lib/server/db/schema';
import { slugify, generateWebhookSecret } from '$lib/server/api-utils';
import { encrypt } from '$lib/server/crypto';
import { allocatePort } from '$lib/server/pipeline/port';
import { runPipeline } from '$lib/server/pipeline';
import { createCommandRunner } from '$lib/server/pipeline/docker';
import { detectors } from '$lib/server/detection/detectors';
import { registerWebhook } from '$lib/server/auto-webhook';
import { eq } from 'drizzle-orm';
import type { FrameworkId, Tier } from '$lib/server/detection/types';
import type { PageServerLoad, Actions } from './$types';

const FRAMEWORK_OPTIONS = detectors.map((d) => ({
	id: d.id,
	name: d.name,
	tier: d.tier
}));

export const load: PageServerLoad = async () => {
	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl
		})
		.from(gitConnections);

	return { connections, frameworks: FRAMEWORK_OPTIONS };
};

export const actions: Actions = {
	/** Import a repo from a connected provider and deploy. */
	default: async ({ request, url }) => {
		const formData = await request.formData();
		const repoUrl = (formData.get('repoUrl') as string)?.trim();
		const cloneUrl = (formData.get('cloneUrl') as string)?.trim();
		const connectionId = (formData.get('connectionId') as string)?.trim() || null;
		const branch = (formData.get('branch') as string)?.trim() || 'main';
		const projectName = (formData.get('projectName') as string)?.trim();
		const frameworkId = (formData.get('frameworkId') as string)?.trim() || '';
		const releaseCommand = (formData.get('releaseCommand') as string | null)?.trim() || '';

		if (!cloneUrl) {
			return fail(400, { error: 'No repository selected' });
		}

		const name = projectName || deriveNameFromUrl(cloneUrl);
		if (!name) {
			return fail(400, { error: 'Could not determine project name' });
		}

		const slug = slugify(name);
		if (!slug) {
			return fail(400, { error: 'Invalid project name' });
		}

		const existing = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (existing.length > 0) {
			return fail(409, { error: `Project "${slug}" already exists` });
		}

		const port = await allocatePort();
		const webhookSecret = generateWebhookSecret();

		const matchedFramework = frameworkId
			? FRAMEWORK_OPTIONS.find((f) => f.id === frameworkId)
			: null;

		const [project] = await db
			.insert(projects)
			.values({
				name: name.trim(),
				slug,
				repoUrl: repoUrl || cloneUrl,
				branch,
				gitConnectionId: connectionId,
				frameworkId: frameworkId || undefined,
				tier: matchedFramework?.tier ?? undefined,
				port,
				webhookSecret,
				releaseCommand: releaseCommand || null
			})
			.returning();

		/* Save env vars if provided */
		const envKeysRaw = formData.get('envKeys') as string | null;
		const envValsRaw = formData.get('envValues') as string | null;
		const envSecretsRaw = formData.get('envSecrets') as string | null;

		const envKeys = envKeysRaw ? envKeysRaw.split('\x1F') : [];
		const envValues = envValsRaw ? envValsRaw.split('\x1F') : [];
		const envSecrets = envSecretsRaw ? envSecretsRaw.split('\x1F') : [];

		for (let i = 0; i < envKeys.length; i++) {
			const key = envKeys[i]?.trim();
			const value = envValues[i] ?? '';
			const isSecret = envSecrets[i] === '1';
			if (key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				await db
					.insert(envVars)
					.values({ projectId: project.id, key, value: encrypt(value), isSecret });
			}
		}

		/* Register webhook on provider (fire-and-forget) */
		if (connectionId) {
			registerWebhook({
				connectionId,
				repoUrl: project.repoUrl,
				projectId: project.id,
				webhookSecret,
				origin: url.origin
			})
		}

		runPipeline(
			{
				projectId: project.id,
				projectSlug: project.slug,
				repoUrl: project.repoUrl,
				branch: project.branch,
				gitConnectionId: project.gitConnectionId,
				port: project.port!,
				domain: project.domain ?? undefined,
				frameworkId: (project.frameworkId as FrameworkId) ?? undefined,
				tier: (project.tier as Tier) ?? undefined,
				buildCommand: project.buildCommand,
				startCommand: project.startCommand,
				releaseCommand: project.releaseCommand
			},
			createCommandRunner()
		);

		redirect(303, '/');
	}
};

function deriveNameFromUrl(url: string): string {
	const cleaned = url.replace(/\/$/, '').replace(/\.git$/, '');
	const parts = cleaned.split('/');
	return parts[parts.length - 1] || '';
}
