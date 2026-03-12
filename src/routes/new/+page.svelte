<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	let repoUrl = $state(form?.repoUrl ?? '');
	let branch = $state(form?.branch ?? 'main');
	let rootDir = $state(form?.rootDir ?? '/');
	let projectName = $state(form?.projectName ?? '');
	let frameworkId = $state(form?.frameworkId ?? '');
	let submitting = $state(false);

	/* Env vars: array of { key, value, isSecret } */
	let envRows = $state<{ key: string; value: string; isSecret: boolean }[]>([]);

	/* Auto-derive project name from repo URL */
	const derivedName = $derived.by(() => {
		if (projectName) return projectName;
		if (!repoUrl) return '';
		const cleaned = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');
		const parts = cleaned.split('/');
		return parts[parts.length - 1] || '';
	});

	/* Auto-derive subdomain from project name */
	const derivedDomain = $derived.by(() => {
		const name = derivedName;
		if (!name) return '';
		const slug = name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 63);
		if (!data.domain) return slug;
		return `${slug}.${data.domain}`;
	});

	/* Detected framework display (client-side from dropdown selection) */
	const selectedFramework = $derived(
		frameworkId ? data.frameworks.find((f) => f.id === frameworkId) : null
	);

	function addEnvRow() {
		envRows = [...envRows, { key: '', value: '', isSecret: false }];
	}

	function removeEnvRow(index: number) {
		envRows = envRows.filter((_, i) => i !== index);
	}

	/* Serialize env vars into hidden fields using unit separator */
	const envKeysValue = $derived(envRows.map((r) => r.key).join('\x1F'));
	const envValuesValue = $derived(envRows.map((r) => r.value).join('\x1F'));
	const envSecretsValue = $derived(envRows.map((r) => (r.isSecret ? '1' : '0')).join('\x1F'));

	const canSubmit = $derived(!!repoUrl.trim());
</script>

<svelte:head>
	<title>New Project — Risved</title>
</svelte:head>

<div class="new-project">
	<header>
		<a href={resolve('/')} class="back-link" data-testid="back-link">← Back</a>
		<h1>New Project</h1>
		<p class="subtitle">Configure and deploy a new project from a Git repository.</p>
	</header>

	<form
		method="post"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				submitting = false;
				await update();
			};
		}}
	>
		<!-- Git source section -->
		<section class="section" data-testid="git-section">
			<h2 class="section-title">Git Source</h2>
			<div class="section-body">
				<div class="field">
					<label for="repoUrl">Repository URL</label>
					<input
						id="repoUrl"
						name="repoUrl"
						type="text"
						bind:value={repoUrl}
						placeholder="https://github.com/user/repo.git"
						required
						data-testid="repo-url-input"
					/>
				</div>
				<div class="field-row">
					<div class="field">
						<label for="branch">Branch</label>
						<input
							id="branch"
							name="branch"
							type="text"
							bind:value={branch}
							placeholder="main"
							data-testid="branch-input"
						/>
					</div>
					<div class="field">
						<label for="rootDir">Root directory</label>
						<input
							id="rootDir"
							name="rootDir"
							type="text"
							bind:value={rootDir}
							placeholder="/"
							data-testid="root-dir-input"
						/>
					</div>
				</div>
			</div>
		</section>

		<!-- Detection result -->
		<section class="section" data-testid="detection-section">
			<h2 class="section-title">Framework</h2>
			<div class="section-body">
				{#if selectedFramework}
					<div class="detection-result" data-testid="detection-result">
						<span class="framework-name">{selectedFramework.name}</span>
						<span class="framework-tier">{selectedFramework.tier}</span>
					</div>
				{/if}
				<div class="field">
					<label for="frameworkId">Framework override</label>
					<select
						id="frameworkId"
						name="frameworkId"
						bind:value={frameworkId}
						data-testid="framework-select"
					>
						<option value="">Auto-detect</option>
						{#each data.frameworks as fw (fw.id)}
							<option value={fw.id}>{fw.name}</option>
						{/each}
					</select>
				</div>
			</div>
		</section>

		<!-- Configuration -->
		<section class="section" data-testid="config-section">
			<h2 class="section-title">Configuration</h2>
			<div class="section-body">
				<div class="field">
					<label for="projectName">Project name</label>
					<input
						id="projectName"
						name="projectName"
						type="text"
						bind:value={projectName}
						placeholder={derivedName || 'my-project'}
						data-testid="project-name-input"
					/>
					<span class="field-hint">Auto-generated from repository name if left blank</span>
				</div>
				<div class="field">
					<label>Domain</label>
					<div class="domain-preview mono" data-testid="domain-preview">
						{derivedDomain || '—'}
					</div>
				</div>
			</div>
		</section>

		<!-- Environment variables -->
		<section class="section" data-testid="env-section">
			<h2 class="section-title">Environment Variables</h2>
			<div class="env-editor">
				{#each envRows as row, i (i)}
					<div class="env-row" data-testid="env-row">
						<input
							class="env-key"
							type="text"
							bind:value={row.key}
							placeholder="KEY"
							data-testid="env-key-input"
						/>
						<span class="env-eq">=</span>
						{#if row.isSecret}
							<input
								class="env-value secret"
								type="password"
								bind:value={row.value}
								placeholder="value"
								data-testid="env-value-input"
							/>
						{:else}
							<input
								class="env-value"
								type="text"
								bind:value={row.value}
								placeholder="value"
								data-testid="env-value-input"
							/>
						{/if}
						<button
							type="button"
							class="env-secret-toggle"
							class:active={row.isSecret}
							title={row.isSecret ? 'Unmark as secret' : 'Mark as secret'}
							onclick={() => (row.isSecret = !row.isSecret)}
							data-testid="env-secret-toggle"
						>
							{row.isSecret ? '🔒' : '🔓'}
						</button>
						<button
							type="button"
							class="env-remove"
							title="Remove variable"
							onclick={() => removeEnvRow(i)}
							data-testid="env-remove-btn"
						>
							×
						</button>
					</div>
				{/each}
				{#if envRows.length === 0}
					<div class="env-empty">No environment variables configured.</div>
				{/if}
				<button type="button" class="env-add" onclick={addEnvRow} data-testid="env-add-btn">
					+ Add variable
				</button>
			</div>

			<!-- Hidden fields for env var serialization -->
			<input type="hidden" name="envKeys" value={envKeysValue} />
			<input type="hidden" name="envValues" value={envValuesValue} />
			<input type="hidden" name="envSecrets" value={envSecretsValue} />
		</section>

		{#if form?.error}
			<p class="form-error" role="alert" data-testid="form-error">{form.error}</p>
		{/if}

		<button
			type="submit"
			class="btn-deploy"
			disabled={submitting || !canSubmit}
			data-testid="deploy-btn"
		>
			{submitting ? 'Deploying…' : 'Deploy project'}
		</button>
	</form>
</div>

<style>
	.new-project {
		display: flex;
		flex-direction: column;
		padding: var(--space-4) var(--space-4) var(--space-8);
		max-width: 680px;
		margin: 0 auto;
		width: 100%;
		gap: var(--space-4);
	}

	header {
		margin-bottom: var(--space-2);
	}

	.back-link {
		display: inline-block;
		font-size: 0.8125rem;
		color: var(--color-text-2);
		margin-bottom: var(--space-3);
	}

	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	h1 {
		font-size: 1.4rem;
		font-weight: 600;
		margin-bottom: var(--space-1);
	}

	.subtitle {
		color: var(--color-text-1);
		font-size: 0.9rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Section blocks */
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.section-title {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.section-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	/* Fields */
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	label {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-1);
	}

	input[type='text'],
	input[type='password'],
	select {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 0.9rem;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	input::placeholder {
		color: var(--color-text-2);
	}

	input:focus,
	select:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
	}

	select {
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 5L6 8L9 5' stroke='%236f6e6b' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		padding-right: 32px;
	}

	.field-hint {
		font-size: 0.75rem;
		color: var(--color-text-2);
	}

	/* Detection result */
	.detection-result {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border-radius: var(--radius-md);
	}

	.framework-name {
		font-weight: 600;
		font-size: 0.9rem;
	}

	.framework-tier {
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-text-2);
		padding: 1px 6px;
		background: var(--color-bg-3);
		border-radius: var(--radius-sm);
	}

	/* Domain preview */
	.domain-preview {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: 0.85rem;
	}

	.mono {
		font-family: var(--font-mono);
	}

	/* Env editor */
	.env-editor {
		display: flex;
		flex-direction: column;
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.env-row {
		display: flex;
		align-items: center;
		gap: 0;
		border-bottom: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}

	.env-key {
		flex: 0 0 35%;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-right: 1px solid var(--color-border);
		color: var(--color-term-cmd);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		outline: none;
	}

	.env-key::placeholder {
		color: var(--color-text-2);
	}

	.env-eq {
		padding: 0 var(--space-1);
		color: var(--color-text-2);
		flex-shrink: 0;
	}

	.env-value {
		flex: 1;
		padding: var(--space-2) var(--space-2);
		background: transparent;
		border: none;
		color: var(--color-term-success);
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		outline: none;
	}

	.env-value.secret {
		color: var(--color-text-2);
	}

	.env-value::placeholder {
		color: var(--color-text-2);
	}

	.env-secret-toggle,
	.env-remove {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--color-text-2);
		cursor: pointer;
		font-size: 0.875rem;
		transition: color 0.1s;
	}

	.env-secret-toggle:hover,
	.env-remove:hover {
		color: var(--color-text-0);
	}

	.env-secret-toggle.active {
		color: var(--color-building);
	}

	.env-empty {
		padding: var(--space-3);
		color: var(--color-text-2);
		font-size: 0.8125rem;
		text-align: center;
	}

	.env-add {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-top: 1px solid var(--color-border);
		color: var(--color-accent);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}

	.env-add:hover {
		background: var(--color-bg-2);
	}

	/* Error */
	.form-error {
		padding: var(--space-2) var(--space-3);
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: 0.85rem;
	}

	/* Deploy button */
	.btn-deploy {
		padding: var(--space-3) var(--space-4);
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		transition:
			background 0.15s,
			opacity 0.15s;
	}

	.btn-deploy:hover:not(:disabled) {
		background: var(--color-accent-dim);
	}

	.btn-deploy:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
