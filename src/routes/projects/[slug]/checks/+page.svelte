<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let saved = $state(false);
</script>

<svelte:head>
	<title>Status Checks — {data.project.name} — Risved</title>
</svelte:head>

<div class="checks-config">
	<header class="page-header">
		<a href={resolve(`/projects/${data.project.slug}`)} class="back-link">← {data.project.name}</a>
		<h1>PR Status Checks</h1>
		<p class="page-desc">Configure how Risved interacts with pull requests on your git provider.</p>
	</header>

	<!-- GitHub PR Mock -->
	<section class="section" data-testid="status-check-mock">
		<h2 class="section-title">Commit Status Preview</h2>
		<div class="pr-mock">
			<div class="pr-mock-header">
				<span class="pr-mock-icon">&#9679;</span>
				<span class="pr-mock-title">All checks have passed</span>
			</div>
			<div class="pr-mock-check">
				<span class="check-icon check-pass">&#10003;</span>
				<span class="check-name">risved/deploy-preview</span>
				<span class="check-sep">—</span>
				<span class="check-desc">Deploy preview ready</span>
				<a href="https://{data.previewUrlFormat}" class="check-link" data-testid="mock-preview-link"
					>Details</a
				>
			</div>
			<div class="pr-mock-check">
				<span class="check-icon check-pass">&#10003;</span>
				<span class="check-name">risved/build</span>
				<span class="check-sep">—</span>
				<span class="check-desc">Build succeeded</span>
			</div>
			<div class="pr-mock-footer">
				<span class="pr-mock-hint"
					>This is a preview of how Risved status checks appear on your pull requests.</span
				>
			</div>
		</div>
	</section>

	<!-- Deploy Preview URL Format -->
	<section class="section" data-testid="url-format-section">
		<h2 class="section-title">Deploy Preview URL</h2>
		<div class="info-card">
			<code class="url-format mono" data-testid="preview-url-format">{data.previewUrlFormat}</code>
			<p class="info-desc">
				Each pull request gets a unique preview deployment. The <code>{'{number}'}</code> is replaced
				with the PR number.
			</p>
		</div>
	</section>

	<!-- Toggles -->
	<section class="section" data-testid="checks-settings">
		<h2 class="section-title">Settings</h2>
		<form
			method="post"
			action="?/save"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					saved = true;
					setTimeout(() => (saved = false), 2000);
				};
			}}
			class="config-form"
		>
			<div class="toggle-list">
				<label class="toggle-row" data-testid="toggle-commit-status">
					<input
						type="checkbox"
						name="commitStatusEnabled"
						checked={data.project.commitStatusEnabled}
					/>
					<div class="toggle-content">
						<span class="toggle-label">Post commit status</span>
						<span class="toggle-hint"
							>Report build status back to your git provider as a commit status check.</span
						>
					</div>
				</label>

				<label class="toggle-row" data-testid="toggle-previews">
					<input type="checkbox" name="previewsEnabled" checked={data.project.previewsEnabled} />
					<div class="toggle-content">
						<span class="toggle-label">Deploy previews</span>
						<span class="toggle-hint"
							>Automatically build and deploy a preview for each pull request.</span
						>
					</div>
				</label>

				<label class="toggle-row" data-testid="toggle-auto-delete">
					<input
						type="checkbox"
						name="previewAutoDelete"
						checked={data.project.previewAutoDelete}
					/>
					<div class="toggle-content">
						<span class="toggle-label">Auto-delete previews</span>
						<span class="toggle-hint"
							>Automatically clean up preview deployments when the PR is closed or merged.</span
						>
					</div>
				</label>

				<label class="toggle-row" data-testid="toggle-required-check">
					<input type="checkbox" name="requiredCheck" checked={data.project.requiredCheck} />
					<div class="toggle-content">
						<span class="toggle-label">Required check (block merge)</span>
						<span class="toggle-hint"
							>Mark the Risved status check as required, preventing merge until the build succeeds.
							Must also be configured in your git provider's branch protection rules.</span
						>
					</div>
				</label>
			</div>

			<div class="form-group">
				<label for="previewLimit" class="form-label">Max concurrent previews</label>
				<input
					type="number"
					id="previewLimit"
					name="previewLimit"
					value={data.project.previewLimit}
					min="1"
					max="20"
					class="form-input num-input"
					data-testid="preview-limit-input"
				/>
				<span class="form-hint">Oldest previews are cleaned up when this limit is exceeded.</span>
			</div>

			<div class="form-actions">
				<button type="submit" class="btn-save" data-testid="save-btn">Save settings</button>
				{#if saved}
					<span class="saved-msg" data-testid="saved-msg">Saved!</span>
				{/if}
			</div>
		</form>
	</section>
</div>

<style>
	.checks-config {
		display: flex;
		flex-direction: column;
		padding: var(--space-4) var(--space-4) var(--space-8);
		max-width: 800px;
		margin: 0 auto;
		width: 100%;
		gap: var(--space-6);
	}

	.back-link {
		font-size: 0.8125rem;
		color: var(--color-text-2);
		display: inline-block;
		margin-bottom: var(--space-2);
	}
	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	h1 {
		font-size: 1.4rem;
		font-weight: 600;
	}

	.page-desc {
		font-size: 0.85rem;
		color: var(--color-text-2);
		margin-top: var(--space-1);
	}

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

	.mono {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}

	/* PR Mock */
	.pr-mock {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.pr-mock-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.pr-mock-icon {
		color: #3fb950;
		font-size: 0.75rem;
	}
	.pr-mock-check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		font-size: 0.8125rem;
	}
	.check-icon {
		font-size: 0.8125rem;
		flex-shrink: 0;
	}
	.check-pass {
		color: #3fb950;
	}
	.check-name {
		font-weight: 500;
		color: var(--color-text-0);
	}
	.check-sep {
		color: var(--color-text-2);
	}
	.check-desc {
		color: var(--color-text-2);
	}
	.check-link {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-accent);
	}
	.pr-mock-footer {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
	}
	.pr-mock-hint {
		font-size: 0.75rem;
		color: var(--color-text-2);
	}

	/* Info card */
	.info-card {
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.url-format {
		color: var(--color-text-0);
	}
	.info-desc {
		font-size: 0.8125rem;
		color: var(--color-text-2);
		line-height: 1.5;
	}
	.info-desc code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--color-text-1);
		background: var(--color-bg-2);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}

	/* Config form */
	.config-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Toggles */
	.toggle-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.toggle-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		cursor: pointer;
	}
	.toggle-row input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--color-accent);
		cursor: pointer;
		margin-top: 2px;
		flex-shrink: 0;
	}
	.toggle-content {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.toggle-label {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-0);
	}
	.toggle-hint {
		font-size: 0.75rem;
		color: var(--color-text-2);
		line-height: 1.4;
	}

	/* Form inputs */
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.form-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-1);
	}
	.form-input {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 0.8125rem;
	}
	.form-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.num-input {
		width: 80px;
	}
	.form-hint {
		font-size: 0.75rem;
		color: var(--color-text-2);
	}

	/* Actions */
	.form-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.btn-save {
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		border: none;
		border-radius: var(--radius-md);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}
	.btn-save:hover {
		background: var(--color-accent-dim);
	}
	.saved-msg {
		font-size: 0.8125rem;
		color: #3fb950;
	}
</style>
