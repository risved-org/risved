<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import StepIndicator from '../StepIndicator.svelte';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	type DeployPath = 'starter' | 'repo';

	let path = $state<DeployPath>('starter');
	let selectedTemplate = $state<string | null>(null);
	let repoUrl = $state(form?.repoUrl ?? '');
	let branch = $state(form?.branch ?? 'main');
	let submitting = $state(false);

	const canSubmitStarter = $derived(path === 'starter' && !!selectedTemplate);
	const canSubmitRepo = $derived(path === 'repo' && !!repoUrl.trim());
</script>

<div class="onboarding">
	<div class="onboarding-card">
		<StepIndicator current={4} />

		<header>
			<h1>Deploy your first app</h1>
			<p class="subtitle">
				Choose a starter template to verify your setup, or deploy from your own repository.
			</p>
		</header>

		<div class="path-tabs">
			<button
				type="button"
				class="path-tab"
				class:active={path === 'starter'}
				onclick={() => (path = 'starter')}
			>
				Starter template
				<span class="tab-badge">Recommended</span>
			</button>
			<button
				type="button"
				class="path-tab"
				class:active={path === 'repo'}
				onclick={() => (path = 'repo')}
			>
				Own repository
			</button>
		</div>

		{#if path === 'starter'}
			<form
				method="post"
				action="?/starter"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update();
					};
				}}
			>
				<input type="hidden" name="templateId" value={selectedTemplate ?? ''} />

				<div class="template-grid">
					{#each data.templates as template (template.id)}
						<button
							type="button"
							class="template-card"
							class:selected={selectedTemplate === template.id}
							onclick={() => (selectedTemplate = template.id)}
						>
							<div class="template-header">
								<span class="template-name">{template.name}</span>
								<span class="template-time">{template.estimatedTime}</span>
							</div>
							<p class="template-desc">{template.description}</p>
						</button>
					{/each}
				</div>

				{#if form?.error && path === 'starter'}
					<p class="form-error" role="alert">{form.error}</p>
				{/if}

				<button type="submit" class="btn-primary" disabled={submitting || !canSubmitStarter}>
					{submitting ? 'Deploying…' : 'Deploy starter'}
				</button>
			</form>
		{:else}
			<form
				method="post"
				action="?/repo"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update();
					};
				}}
			>
				<div class="repo-fields">
					<div class="field">
						<label for="repoUrl">Git repository URL</label>
						<input
							id="repoUrl"
							name="repoUrl"
							type="text"
							bind:value={repoUrl}
							placeholder="https://github.com/user/repo.git"
						/>
					</div>
					<div class="field">
						<label for="branch">Branch</label>
						<input id="branch" name="branch" type="text" bind:value={branch} placeholder="main" />
					</div>
				</div>

				{#if form?.error && path === 'repo'}
					<p class="form-error" role="alert">{form.error}</p>
				{/if}

				<button type="submit" class="btn-primary" disabled={submitting || !canSubmitRepo}>
					{submitting ? 'Deploying…' : 'Deploy from repo'}
				</button>
			</form>
		{/if}

		<div class="skip-section">
			<form method="post" action="?/skip">
				<button type="submit" class="btn-secondary">Skip – go to dashboard</button>
			</form>
		</div>
	</div>
</div>

<style>
	.onboarding-card {
		width: 100%;
		max-width: 540px;
	}

	header {
		margin-bottom: var(--space-5);
	}

	h1 {
		font-size: 2rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Path tabs */
	.path-tabs {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.path-tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s,
			background 0.15s;
	}

	.path-tab:hover {
		border-color: var(--color-text-2);
	}

	.path-tab.active {
		border-color: var(--color-accent);
		color: var(--color-text-0);
		background: color-mix(in srgb, var(--color-accent) 5%, transparent);
	}

	.tab-badge {
		font-size: .875rem;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
		font-weight: 500;
	}

	/* Template grid */
	.template-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	.template-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-lg);
		cursor: pointer;
		text-align: left;
		color: var(--color-text-0);
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.template-card:hover {
		border-color: var(--color-text-2);
	}

	.template-card.selected {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 5%, transparent);
	}

	.template-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.template-name {
		font-weight: 600;
		font-size: 1rem;
	}

	.template-time {
		font-family: var(--font-mono);
		font-size: .875rem;
		color: var(--color-text-2);
	}

	.template-desc {
		font-size: .875rem;
		color: var(--color-text-1);
		line-height: 1.4;
	}

	/* Repo fields */
	.repo-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	label {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-1);
	}

	input[type='text'] {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 1rem;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	input[type='text']::placeholder {
		color: var(--color-text-2);
	}

	input[type='text']:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.skip-section {
		margin-top: var(--space-4);
		text-align: center;
	}

</style>
