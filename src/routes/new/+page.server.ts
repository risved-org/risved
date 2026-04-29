import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { projects, envVars } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { slugify, generateWebhookSecret } from '$lib/server/api-utils';
import { encrypt } from '$lib/server/crypto';
import { allocatePort } from '$lib/server/pipeline/port';
import { runPipeline } from '$lib/server/pipeline';
import { createCommandRunner } from '$lib/server/pipeline/docker';
import { detectors } from '$lib/server/detection/detectors';
import { gitConnections } from '$lib/server/db/schema';
import { getSetting } from '$lib/server/settings';
import type { FrameworkId, Tier } from '$lib/server/detection/types';
import type { PageServerLoad, Actions } from './$types';

/** Framework options for the manual override dropdown */
const FRAMEWORK_OPTIONS = detectors.map((d) => ({
	id: d.id,
	name: d.name,
	tier: d.tier
}));

export const load: PageServerLoad = async () => {
	const domain = await getSetting('risved_domain');
	const connections = await db
		.select({
			id: gitConnections.id,
			provider: gitConnections.provider,
			accountName: gitConnections.accountName,
			avatarUrl: gitConnections.avatarUrl
		})
		.from(gitConnections);
	return { frameworks: FRAMEWORK_OPTIONS, domain, connections };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const repoUrl = formData.get('repoUrl') as string | null;
		const branch = (formData.get('branch') as string | null)?.trim() || 'main';
		const rootDir = (formData.get('rootDir') as string | null)?.trim() || '/';
		const projectName = (formData.get('projectName') as string | null)?.trim() || '';
		const frameworkId = (formData.get('frameworkId') as string | null)?.trim() || '';
		const buildCommand = (formData.get('buildCommand') as string | null)?.trim() || ''
		const startCommand = (formData.get('startCommand') as string | null)?.trim() || ''
		const releaseCommand = (formData.get('releaseCommand') as string | null)?.trim() || ''
		const connectionId = (formData.get('connectionId') as string | null)?.trim() || null
		const envKeysRaw = formData.get('envKeys') as string | null;
		const envValsRaw = formData.get('envValues') as string | null;
		const envSecretsRaw = formData.get('envSecrets') as string | null;

		if (!repoUrl || !repoUrl.trim()) {
			return fail(400, {
				error: 'Repository URL is required',
				repoUrl,
				branch,
				rootDir,
				projectName,
				frameworkId
			});
		}

		const name = projectName || deriveNameFromUrl(repoUrl);
		if (!name) {
			return fail(400, {
				error: 'Could not determine project name. Please provide one.',
				repoUrl,
				branch,
				rootDir,
				projectName,
				frameworkId
			});
		}

		const slug = slugify(name);
		if (!slug) {
			return fail(400, {
				error: 'Project name must contain at least one alphanumeric character',
				repoUrl,
				branch,
				rootDir,
				projectName,
				frameworkId
			});
		}

		/* Check for duplicate slug */
		const existing = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
		if (existing.length > 0) {
			return fail(409, {
				error: `A project with slug "${slug}" already exists`,
				repoUrl,
				branch,
				rootDir,
				projectName,
				frameworkId
			});
		}

		const port = await allocatePort();
		const webhookSecret = generateWebhookSecret();

		/* Look up tier from framework list */
		const matchedFramework = frameworkId
			? FRAMEWORK_OPTIONS.find((f) => f.id === frameworkId)
			: null;

		const [project] = await db
			.insert(projects)
			.values({
				name: name.trim(),
				slug,
				repoUrl: repoUrl.trim(),
				branch,
				gitConnectionId: connectionId,
				frameworkId: frameworkId || undefined,
				tier: matchedFramework?.tier ?? undefined,
				port,
				webhookSecret,
				buildCommand: buildCommand || null,
				startCommand: startCommand || null,
				releaseCommand: releaseCommand || null
			})
			.returning();

		/* Save environment variables */
		const envKeys = envKeysRaw ? envKeysRaw.split('\x1F') : [];
		const envValues = envValsRaw ? envValsRaw.split('\x1F') : [];
		const envSecrets = envSecretsRaw ? envSecretsRaw.split('\x1F') : [];

		for (let i = 0; i < envKeys.length; i++) {
			const key = envKeys[i]?.trim();
			const value = envValues[i] ?? '';
			const isSecret = envSecrets[i] === '1';
			if (key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
				await db.insert(envVars).values({
					projectId: project.id,
					key,
					value: encrypt(value),
					isSecret
				});
			}
		}

		/* Trigger deployment */
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

		redirect(303, `/`);
	}
};

/** Extract a project name from a git URL */
function deriveNameFromUrl(url: string): string {
	const cleaned = url.replace(/\.git$/, '').replace(/\/$/, '');
	const parts = cleaned.split('/');
	return parts[parts.length - 1] || '';
}
