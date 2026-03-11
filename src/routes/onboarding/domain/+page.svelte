<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import StepIndicator from '../StepIndicator.svelte';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	type DomainMode = 'subdomain' | 'dedicated' | 'ip';

	let mode = $state<DomainMode>(
		form?.mode ?? (data.domainConfig?.mode as DomainMode) ?? 'subdomain'
	);
	let baseDomain = $state(form?.baseDomain ?? data.domainConfig?.baseDomain ?? '');
	let prefix = $state(form?.prefix ?? data.domainConfig?.prefix ?? 'risved');
	let submitting = $state(false);

	const prefixOptions = ['risved', 'deploy', 'apps'];

	const dashboardUrl = $derived.by(() => {
		if (mode === 'subdomain') {
			return baseDomain ? `https://${prefix}.${baseDomain}` : '';
		}
		if (mode === 'dedicated') {
			return baseDomain ? `https://${baseDomain}` : '';
		}
		return 'http://<server-ip>:3000';
	});

	const appUrlPattern = $derived.by(() => {
		if (mode === 'subdomain') {
			return baseDomain ? `https://<app>.${baseDomain}` : '';
		}
		if (mode === 'dedicated') {
			return baseDomain ? `https://<app>.${baseDomain}` : '';
		}
		return 'http://<server-ip>:<port>';
	});

	const canSubmit = $derived(
		mode === 'ip' ||
			(mode === 'subdomain' && baseDomain && prefix) ||
			(mode === 'dedicated' && baseDomain)
	);
</script>

<div class="onboarding">
	<div class="onboarding-card">
		<StepIndicator current={1} />

		<header>
			<h1>Configure your domain</h1>
			<p class="subtitle">Choose how you want to access your Risved dashboard and deployed apps.</p>
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
			<input type="hidden" name="mode" value={mode} />

			<div class="radio-cards">
				<button
					type="button"
					class="radio-card"
					class:selected={mode === 'subdomain'}
					onclick={() => (mode = 'subdomain')}
				>
					<div class="radio-dot"></div>
					<div class="radio-content">
						<span class="radio-title">Subdomain</span>
						<span class="radio-badge">Recommended</span>
						<span class="radio-desc">Dashboard on a subdomain, apps on separate subdomains.</span>
					</div>
				</button>

				<button
					type="button"
					class="radio-card"
					class:selected={mode === 'dedicated'}
					onclick={() => (mode = 'dedicated')}
				>
					<div class="radio-dot"></div>
					<div class="radio-content">
						<span class="radio-title">Dedicated domain</span>
						<span class="radio-desc">Entire domain pointed to Risved. Dashboard at root.</span>
					</div>
				</button>

				<button
					type="button"
					class="radio-card"
					class:selected={mode === 'ip'}
					onclick={() => (mode = 'ip')}
				>
					<div class="radio-dot"></div>
					<div class="radio-content">
						<span class="radio-title">IP-only mode</span>
						<span class="radio-desc">No domain required. HTTP only, for evaluation.</span>
					</div>
				</button>
			</div>

			{#if mode === 'subdomain'}
				<div class="config-section">
					<div class="field">
						<label for="baseDomain">Your domain</label>
						<input
							id="baseDomain"
							name="baseDomain"
							type="text"
							bind:value={baseDomain}
							placeholder="example.com"
						/>
					</div>

					<div class="field">
						<label for="prefix">Dashboard prefix</label>
						<div class="prefix-picker">
							{#each prefixOptions as opt (opt)}
								<button
									type="button"
									class="prefix-option"
									class:active={prefix === opt}
									onclick={() => (prefix = opt)}
								>
									{opt}
								</button>
							{/each}
							<input
								id="prefix"
								name="prefix"
								type="text"
								class="prefix-custom"
								bind:value={prefix}
								placeholder="custom"
							/>
						</div>
					</div>
				</div>
			{/if}

			{#if mode === 'dedicated'}
				<div class="config-section">
					<div class="field">
						<label for="baseDomain">Your domain</label>
						<input
							id="baseDomain"
							name="baseDomain"
							type="text"
							bind:value={baseDomain}
							placeholder="deploy.example.com"
						/>
					</div>
				</div>
			{/if}

			{#if dashboardUrl}
				<div class="url-preview" aria-label="URL preview">
					<div class="preview-row">
						<span class="preview-label">Dashboard</span>
						<code class="preview-url">{dashboardUrl}</code>
					</div>
					{#if appUrlPattern}
						<div class="preview-row">
							<span class="preview-label">Apps</span>
							<code class="preview-url">{appUrlPattern}</code>
						</div>
					{/if}
				</div>
			{/if}

			{#if form?.error}
				<p class="form-error" role="alert">{form.error}</p>
			{/if}

			<button type="submit" disabled={submitting || !canSubmit}>
				{submitting ? 'Saving…' : 'Continue'}
			</button>
		</form>
	</div>
</div>

<style>
	.onboarding {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--space-4);
	}

	.onboarding-card {
		width: 100%;
		max-width: 480px;
	}

	header {
		margin-bottom: var(--space-6);
	}

	h1 {
		font-size: 1.4rem;
		font-weight: 600;
		margin-bottom: var(--space-2);
	}

	.subtitle {
		color: var(--color-text-1);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Radio cards */
	.radio-cards {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.radio-card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
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

	.radio-card:hover {
		border-color: var(--color-text-2);
	}

	.radio-card.selected {
		border-color: var(--color-accent);
		background: rgba(59, 130, 246, 0.05);
	}

	.radio-dot {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid var(--color-text-2);
		flex-shrink: 0;
		margin-top: 2px;
		transition:
			border-color 0.15s,
			background 0.15s;
	}

	.radio-card.selected .radio-dot {
		border-color: var(--color-accent);
		background: var(--color-accent);
		box-shadow: inset 0 0 0 3px var(--color-bg-1);
	}

	.radio-content {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}

	.radio-title {
		font-weight: 500;
		font-size: 0.9rem;
	}

	.radio-badge {
		font-size: 0.7rem;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		background: rgba(34, 197, 94, 0.15);
		color: var(--color-live);
		font-weight: 500;
	}

	.radio-desc {
		width: 100%;
		font-size: 0.8rem;
		color: var(--color-text-1);
		line-height: 1.4;
	}

	/* Config section */
	.config-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	label {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-1);
	}

	input[type='text'] {
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

	input[type='text']::placeholder {
		color: var(--color-text-2);
	}

	input[type='text']:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
	}

	/* Prefix picker */
	.prefix-picker {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.prefix-option {
		padding: var(--space-1) var(--space-2);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: 0.8rem;
		font-family: var(--font-mono);
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.prefix-option:hover {
		border-color: var(--color-text-2);
	}

	.prefix-option.active {
		border-color: var(--color-accent);
		color: var(--color-accent);
		background: rgba(59, 130, 246, 0.08);
	}

	.prefix-custom {
		flex: 1;
		min-width: 80px;
		font-family: var(--font-mono);
		font-size: 0.8rem;
	}

	/* URL preview */
	.url-preview {
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.preview-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.preview-label {
		font-size: 0.78rem;
		color: var(--color-text-2);
		min-width: 70px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
	}

	.preview-url {
		font-size: 0.85rem;
		color: var(--color-live);
	}

	/* Form error */
	.form-error {
		padding: var(--space-2) var(--space-3);
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: 0.85rem;
	}

	/* Submit */
	button[type='submit'] {
		padding: var(--space-2) var(--space-4);
		background: var(--color-accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-weight: 500;
		font-size: 0.9rem;
		cursor: pointer;
		transition:
			background 0.15s,
			opacity 0.15s;
		margin-top: var(--space-2);
	}

	button[type='submit']:hover:not(:disabled) {
		background: var(--color-accent-dim);
	}

	button[type='submit']:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
