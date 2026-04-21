<script lang="ts">
	import { enhance } from '$app/forms'
	import { resolve } from '$app/paths'
	import { goto } from '$app/navigation'
	import type { ActionData, PageData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let envRows = $state(
		data.envVars.map((e) => ({ key: e.key, value: e.value, isSecret: e.isSecret }))
	)
	let saving = $state(false)
	let deploying = $state(false)

	/* Re-sync envRows when data updates after save */
	$effect(() => {
		envRows = data.envVars.map((e) => ({ key: e.key, value: e.value, isSecret: e.isSecret }))
	})

	async function triggerDeploy() {
		deploying = true
		const res = await fetch(`/api/projects/${data.project.id}/deploy`, { method: 'POST' })
		if (res.ok) {
			const { deploymentId } = await res.json()
			if (deploymentId) {
				await goto(resolve(`/projects/${data.project.slug}/deployments/${deploymentId}`))
				return
			}
		}
		deploying = false
	}

	function addEnvRow() {
		envRows = [...envRows, { key: '', value: '', isSecret: false }]
	}

	function removeEnvRow(index: number) {
		envRows = envRows.filter((_, i) => i !== index)
	}

	/** Parse pasted .env content: split KEY=value on the first = sign */
	function handleEnvPaste(event: ClipboardEvent, index: number) {
		const text = event.clipboardData?.getData('text') ?? ''
		if (!text.includes('=')) return

		event.preventDefault()
		const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
		const parsed = lines.map((line) => {
			const eqIndex = line.indexOf('=')
			if (eqIndex === -1) return { key: line.trim(), value: '', isSecret: false }
			return {
				key: line.slice(0, eqIndex).trim(),
				value: line.slice(eqIndex + 1).trim(),
				isSecret: false
			}
		})

		if (parsed.length === 0) return

		const updated = [...envRows]
		updated[index] = { ...updated[index], ...parsed[0] }
		for (let j = 1; j < parsed.length; j++) {
			updated.splice(index + j, 0, parsed[j])
		}
		envRows = updated
	}

	const envKeysValue = $derived(envRows.map((r) => r.key).join('\x1F'))
	const envValuesValue = $derived(envRows.map((r) => r.value).join('\x1F'))
	const envSecretsValue = $derived(envRows.map((r) => (r.isSecret ? '1' : '0')).join('\x1F'))
</script>

<svelte:head>
	<title>Settings – {data.project.name} – Risved</title>
</svelte:head>

<div class="settings-page">
	<header class="page-header">
		<a href={resolve(`/projects/${data.project.slug}`)} class="back-link">← {data.project.name}</a>
		<h1>Settings</h1>
	</header>

	<!-- Environment Variables + Scripts -->
	<section class="section" data-testid="env-section">
		<h2 class="section-title">Environment Variables</h2>
		<form
			method="post"
			action="?/save"
			use:enhance={() => {
				saving = true
				return async ({ update }) => {
					saving = false
					await update()
				}
			}}
		>
			<div class="env-editor">
				{#each envRows as row, i (i)}
					<div class="env-row" data-testid="env-row">
						<input
							class="env-key"
							type="text"
							bind:value={row.key}
							placeholder="KEY"
							onpaste={(e) => handleEnvPaste(e, i)}
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
							{row.isSecret ? 'Secret' : 'Visible'}
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

			<input type="hidden" name="envKeys" value={envKeysValue} />
			<input type="hidden" name="envValues" value={envValuesValue} />
			<input type="hidden" name="envSecrets" value={envSecretsValue} />

			<div class="save-bar">
				<button type="submit" class="btn-primary" disabled={saving} data-testid="save-env-btn">
					{saving ? 'Saving…' : 'Save'}
				</button>
				{#if form?.error}
					<span class="save-error" data-testid="save-error">{form.error}</span>
				{/if}
			</div>
		</form>

		{#if form?.success}
			<div class="redeploy-banner" data-testid="redeploy-banner">
				<span>Saved. Redeploy to apply the new values.</span>
				<button
					class="btn-redeploy"
					disabled={deploying}
					onclick={triggerDeploy}
					data-testid="redeploy-btn"
				>
					{deploying ? 'Deploying…' : 'Redeploy now'}
				</button>
			</div>
		{/if}
	</section>
</div>

<style>
	.settings-page {
		display: flex;
		flex-direction: column;
		padding: var(--space-4) var(--space-4) var(--space-6);
		max-width: 800px;
		margin: 0 auto;
		width: 100%;
		gap: var(--space-5);
	}

	.back-link {
		font-size: .875rem;
		color: var(--color-text-2);
		display: inline-block;
		margin-bottom: var(--space-2);
	}
	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 600;
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
		font-size: .875rem;
	}

	.env-key {
		flex: 0 0 35%;
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-right: 1px solid var(--color-border);
		color: var(--color-term-cmd);
		font-family: var(--font-mono);
		font-size: .875rem;
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
		font-size: .875rem;
		outline: none;
	}
	.env-value.secret {
		color: var(--color-text-2);
	}
	.env-value::placeholder {
		color: var(--color-text-2);
	}

	.env-secret-toggle {
		flex-shrink: 0;
		padding: 0 var(--space-2);
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-left: 1px solid var(--color-border);
		color: var(--color-text-2);
		cursor: pointer;
		font-size: .75rem;
		transition: color 0.1s;
	}
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
		font-size: .875rem;
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
		font-size: .875rem;
		text-align: center;
	}

	.env-add {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: none;
		border-top: 1px solid var(--color-border);
		color: var(--color-accent);
		font-size: .875rem;
		font-weight: 500;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
	}
	.env-add:hover {
		background: var(--color-bg-2);
	}

	/* Save bar */
	.save-bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	.btn-primary {
		border: 1px solid var(--color-accent);
		color: var(--color-bg-0);
		font-weight: 500;
	}
	.btn-primary:hover:not(:disabled) {
		opacity: 0.9;
		background: var(--color-accent);
	}

	.redeploy-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-top: var(--space-3);
		background: color-mix(in srgb, var(--color-building) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-building) 25%, transparent);
		border-radius: var(--radius-md);
		font-size: .875rem;
		color: var(--color-text-0);
	}
	.btn-redeploy {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-building);
		border-radius: var(--radius-md);
		color: var(--color-building);
		font-size: .875rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-redeploy:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-building) 10%, transparent);
	}
	.btn-redeploy:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.save-error {
		font-size: .875rem;
		color: var(--color-failed);
	}

	form {
		display: contents;
	}
</style>
