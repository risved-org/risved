<script lang="ts">
	import { enhance } from '$app/forms'
	import { goto } from '$app/navigation'
	import { resolve } from '$app/paths'
	import type { ActionData, PageData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	/* --- Build & Runtime --- */
	// svelte-ignore state_referenced_locally
	let buildCommand = $state(data.settings.buildCommand)
	// svelte-ignore state_referenced_locally
	let startCommand = $state(data.settings.startCommand)
	// svelte-ignore state_referenced_locally
	let releaseCommand = $state(data.settings.releaseCommand)
	let savingScripts = $state(false)

	/* --- Environment Variables --- */
	// svelte-ignore state_referenced_locally
	let envRows = $state(
		data.envVars.map((e) => ({ key: e.key, value: e.value, isSecret: e.isSecret }))
	)
	// svelte-ignore state_referenced_locally
	let revealed = $state<boolean[]>(envRows.map(() => false))
	let savingEnv = $state(false)
	let deploying = $state(false)
	let addingPostgres = $state(false)
	let confirmRemovePostgres = $state(false)
	let removingPostgres = $state(false)

	const envKeysValue = $derived(envRows.map((r) => r.key).join('\x1F'))
	const envValuesValue = $derived(envRows.map((r) => r.value).join('\x1F'))
	const envSecretsValue = $derived(envRows.map((r) => (r.isSecret ? '1' : '0')).join('\x1F'))

	const revealedStorageKey = $derived(`env-revealed-${data.project.id}`)

	$effect(() => {
		if (typeof sessionStorage === 'undefined') return
		const raw = sessionStorage.getItem(revealedStorageKey)
		if (!raw) return
		try {
			const parsed = JSON.parse(raw) as boolean[]
			const next = envRows.map((_, i) => parsed[i] ?? false)
			revealed = next
		} catch {
			/* ignore corrupt state */
		}
	})

	$effect(() => {
		if (typeof sessionStorage === 'undefined') return
		sessionStorage.setItem(revealedStorageKey, JSON.stringify(revealed))
	})

	function addEnvRow() {
		envRows = [...envRows, { key: '', value: '', isSecret: true }]
		revealed = [...revealed, false]
	}

	function removeEnvRow(index: number) {
		envRows = envRows.filter((_, i) => i !== index)
		revealed = revealed.filter((_, i) => i !== index)
	}

	function handleEnvPaste(event: ClipboardEvent, index: number) {
		const text = event.clipboardData?.getData('text') ?? ''
		if (!text.includes('=')) return

		event.preventDefault()
		const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
		const parsed = lines.map((line) => {
			const eqIndex = line.indexOf('=')
			if (eqIndex === -1) return { key: line.trim(), value: '', isSecret: true }
			return {
				key: line.slice(0, eqIndex).trim(),
				value: line.slice(eqIndex + 1).trim(),
				isSecret: true
			}
		})

		if (parsed.length === 0) return

		const updated = [...envRows]
		updated[index] = { ...updated[index], ...parsed[0] }
		const updatedRevealed = [...revealed]
		for (let j = 1; j < parsed.length; j++) {
			updated.splice(index + j, 0, parsed[j])
			updatedRevealed.splice(index + j, 0, false)
		}
		envRows = updated
		revealed = updatedRevealed
	}

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

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return 'Created recently'
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(new Date(dateStr))
	}

	/* --- Cron Jobs --- */
	let triggeringCron = $state<string | null>(null)

	function timeAgo(dateStr: string | null): string {
		if (!dateStr) return '–'
		const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
		if (seconds < 60) return 'just now'
		const minutes = Math.floor(seconds / 60)
		if (minutes < 60) return `${minutes}m ago`
		const hours = Math.floor(minutes / 60)
		if (hours < 24) return `${hours}h ago`
		return `${Math.floor(hours / 24)}d ago`
	}

	function describeSchedule(expr: string): string {
		const parts = expr.trim().split(/\s+/)
		if (parts.length < 5) return expr
		const [min, hour, dom, mon, dow] = parts

		if (min === '*' && hour === '*') return 'Every minute'
		if (min === '0' && hour === '*') return 'Every hour'
		if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*')
			return 'Daily at midnight'
		if (dom === '*' && mon === '*' && dow === '*' && hour !== '*')
			return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
		if (dom === '*' && mon === '*' && dow === '1')
			return `Mondays at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
		return expr
	}

	function cronStatusClass(status: string | undefined): string {
		if (!status) return ''
		if (status === 'success') return 'cron-success'
		if (status === 'timeout') return 'cron-timeout'
		return 'cron-failed'
	}

	async function handleTriggerCron(jobId: string) {
		triggeringCron = jobId
		try {
			await fetch(`/api/projects/${data.project.id}/crons/${jobId}/trigger`, { method: 'POST' })
			window.location.reload()
		} finally {
			triggeringCron = null
		}
	}

	async function handleDeleteCron(jobId: string) {
		await fetch(`/api/projects/${data.project.id}/crons/${jobId}`, { method: 'DELETE' })
		window.location.reload()
	}

	async function handleToggleCron(jobId: string, enabled: boolean) {
		await fetch(`/api/projects/${data.project.id}/crons/${jobId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled })
		})
		window.location.reload()
	}

	/* --- Danger Zone --- */
	let confirmDelete = $state(false)
	let deleting = $state(false)
</script>

<div class="settings-page">
	<h1 class="page-title">Settings</h1>

	<!-- Domains -->
<section data-testid="domains-section">
	<header class="section-header">
		<h2 class="section-title">Domains</h2>
		<a
			href={resolve(`/projects/${data.project.slug}/domains`)}
			class="btn-secondary btn-md"
			data-testid="edit-domains-btn">Edit</a
		>
	</header>
	{#if data.domains.length === 0}
		<p class="empty-text">No custom domains configured.</p>
	{:else}
		<ul class="domain-list">
			{#each data.domains as dom (dom.id)}
				<li class="domain-row" data-testid="domain-row">
					<span class="domain-name mono">{dom.hostname}</span>
					{#if dom.isPrimary}
						<span class="badge-md badge-accent">Primary</span>
					{/if}
					<span class="badge-md {dom.sslStatus === 'active' ? 'badge-live' : 'badge-muted'}">
						SSL: {dom.sslStatus}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- Environment Variables -->
<section data-testid="env-section">
	<h2 class="section-title">Environment Variables</h2>
	<form
		method="post"
		action="?/saveEnv"
		use:enhance={() => {
			savingEnv = true
			return async ({ update }) => {
				await update({ reset: false })
				savingEnv = false
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
					{#if !revealed[i]}
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
						title={revealed[i] ? 'Hide value' : 'View value'}
						onclick={() => (revealed[i] = !revealed[i])}
						data-testid="env-secret-toggle"
					>
						{revealed[i] ? 'Hide' : 'View'}
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
			<div class="env-actions">
				<button type="button" class="btn-secondary btn-md" onclick={addEnvRow} data-testid="env-add-btn">
					Add variable
				</button>
				<button type="submit" class="btn-primary btn-md" disabled={savingEnv} data-testid="save-env-btn">
					{savingEnv ? 'Saving…' : 'Save'}
				</button>
				{#if form?.error}
					<span class="save-error" data-testid="save-error">{form.error}</span>
				{/if}
			</div>
		</div>

		<input type="hidden" name="envKeys" value={envKeysValue} />
		<input type="hidden" name="envValues" value={envValuesValue} />
		<input type="hidden" name="envSecrets" value={envSecretsValue} />
	</form>

	{#if form?.envSaved}
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

<!-- Postgres -->
<section data-testid="postgres-section">
	<h2 class="section-title">Postgres</h2>
	<article class="postgres-card">
		{#if !data.postgres}
			<header class="postgres-empty">
				<h3>No Postgres database</h3>
				<p class="muted">This project is not attached to a managed Postgres database.</p>
			</header>
			{#if form?.postgresError}
				<p class="postgres-warning" data-testid="postgres-error">{form.postgresError}</p>
			{/if}
			<form
				method="post"
				action="?/addPostgres"
				use:enhance={() => {
					addingPostgres = true
					return async ({ update }) => {
						await update()
						addingPostgres = false
					}
				}}
			>
				<button
					type="submit"
					class="btn-secondary btn-lg"
					disabled={addingPostgres}
					data-testid="add-postgres-btn"
				>
					{addingPostgres ? 'Adding…' : 'Add Postgres'}
				</button>
			</form>
		{:else}
			<header class="postgres-header">
				<h3>Postgres</h3>
				<p class="muted">{formatDate(data.postgres.createdAt)}</p>
			</header>
			<dl class="postgres-meta">
				<div>
					<dt>Database</dt>
					<dd class="mono">{data.postgres.database}</dd>
				</div>
				<div>
					<dt>User</dt>
					<dd class="mono">{data.postgres.username}</dd>
				</div>
				<div>
					<dt>Host</dt>
					<dd class="mono">{data.postgres.host}</dd>
				</div>
				<div>
					<dt>Volume</dt>
					<dd class="mono">{data.postgres.volumeName}</dd>
				</div>
			</dl>
			<p class="postgres-url mono">{data.postgres.urlPreview}</p>
			{#if form?.postgresError}
				<p class="postgres-warning" data-testid="postgres-error">{form.postgresError}</p>
			{/if}
			{#if !confirmRemovePostgres}
				<button
					type="button"
					class="btn-danger"
					onclick={() => (confirmRemovePostgres = true)}
					data-testid="remove-postgres-btn"
				>
					Remove
				</button>
			{:else}
				<form
					method="post"
					action="?/removePostgres"
					use:enhance={() => {
						removingPostgres = true
						return async ({ update }) => {
							await update()
							removingPostgres = false
							confirmRemovePostgres = false
						}
					}}
				>
					<p class="postgres-warning">
						This will permanently delete the Postgres container and volume. Database data will be lost.
					</p>
					<div class="confirm-row">
						<button
							type="submit"
							class="btn-danger-confirm"
							disabled={removingPostgres}
							data-testid="confirm-remove-postgres-btn"
						>
							{removingPostgres ? 'Removing…' : 'Confirm remove'}
						</button>
						<button
							type="button"
							class="btn-cancel"
							onclick={() => (confirmRemovePostgres = false)}
						>
							Cancel
						</button>
					</div>
				</form>
			{/if}
		{/if}
	</article>
</section>

<!-- Scheduled Tasks -->
<section data-testid="crons-section">
	<header class="section-header">
		<h2 class="section-title">Scheduled Tasks</h2>
		<a
			href={resolve(`/projects/${data.project.slug}/crons`)}
			class="btn-secondary btn-md"
			data-testid="edit-crons-btn">Edit</a
		>
	</header>
	{#if data.cronJobs.length === 0}
		<div class="cron-empty">No scheduled tasks configured.</div>
	{:else}
		<ul class="cron-list">
			{#each data.cronJobs as job (job.id)}
				<li class="cron-row" data-testid="cron-row">
					<label class="cron-toggle">
							<input
								type="checkbox"
								checked={job.enabled}
								oninput={() => handleToggleCron(job.id, !job.enabled)}
							/>
						</label>
						<div class="cron-info">
							<span class="cron-name" class:cron-disabled={!job.enabled}>{job.name}</span>
							<span class="cron-route mono">{job.method} {job.route}</span>
						</div>
						<span class="cron-schedule mono" title={job.schedule}>{describeSchedule(job.schedule)}</span>
						{#if job.lastRun}
							<span class="cron-last-run {cronStatusClass(job.lastRun.status)}">
								{#if job.lastRun.statusCode}
									{job.lastRun.statusCode}
								{:else}
									{job.lastRun.status}
								{/if}
							</span>
							<span class="cron-last-time mono">{timeAgo(job.lastRun.startedAt)}</span>
						{:else}
							<span class="cron-last-run muted">–</span>
							<span class="cron-last-time muted">never</span>
						{/if}
						<span class="cron-actions">
							<button
								class="btn-action"
								data-testid="trigger-cron-btn"
								disabled={triggeringCron === job.id}
								onclick={() => handleTriggerCron(job.id)}
							>
								{triggeringCron === job.id ? 'Running…' : 'Trigger'}
							</button>
							<button
								class="btn-action btn-action-danger"
								onclick={() => handleDeleteCron(job.id)}
								aria-label="Delete cron job {job.name}"
							>
								Delete
							</button>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Integrations -->
<section data-testid="integrations-section">
	<h2 class="section-title">Integrations</h2>
	<ul class="integration-list">
		<li class="integration-row">
			<div class="integration-info">
				<span class="integration-name">Webhook</span>
				{#if data.webhookActive}
					<span class="status-dot dot-live"></span>
					<span class="integration-detail">Active</span>
				{:else}
					<span class="status-dot dot-stopped"></span>
					<span class="integration-detail muted">Not configured</span>
				{/if}
			</div>
			{#if data.webhookActive && data.lastWebhookAt}
				<span class="integration-meta muted">Last received {timeAgo(data.lastWebhookAt)}</span>
			{/if}
			<a
				href={resolve(`/projects/${data.project.slug}/webhooks`)}
				class="btn-secondary btn-md"
				data-testid="edit-webhook-btn">Edit</a
			>
		</li>
		<li class="integration-row">
			<div class="integration-info">
				<span class="integration-name">PR status checks</span>
			</div>
			<a
				href={resolve(`/projects/${data.project.slug}/checks`)}
				class="btn-secondary btn-md"
				data-testid="edit-checks-btn">Edit</a
			>
		</li>
	</ul>
</section>

<!-- Build & Runtime -->
<section data-testid="scripts-section">
	<h2 class="section-title">Build & Runtime</h2>
	<form
		method="post"
		action="?/saveScripts"
		use:enhance={() => {
			savingScripts = true
			return async ({ update }) => {
				await update({ reset: false })
				savingScripts = false
			}
		}}
	>
		<fieldset class="scripts-fieldset">
			<label>Build command
				<input
					type="text"
					name="buildCommand"
					bind:value={buildCommand}
					placeholder="e.g. bun run build"
					data-testid="build-command-input"
				/>
				<span class="field-hint">Runs during image build. Leave blank to use the framework default.</span>
			</label>
			<label>Start command
				<input
					type="text"
					name="startCommand"
					bind:value={startCommand}
					placeholder="e.g. node build/index.js"
					data-testid="start-command-input"
				/>
				<span class="field-hint">Runs in the runtime container. Leave blank to use the framework default.</span>
			</label>
			<label>Release command
				<input
					type="text"
					name="releaseCommand"
					bind:value={releaseCommand}
					placeholder="e.g. bun run migrate"
					data-testid="release-command-input"
				/>
				<span class="field-hint">
					Runs once per deploy, before traffic switches. Usually migrations.
					<a href="https://risved.org/docs/release-commands" target="_blank" rel="noopener">Learn more</a>
				</span>
			</label>
			<div class="scripts-actions">
				<button type="submit" class="btn-primary btn-lg" disabled={savingScripts} data-testid="save-scripts-btn">
					{savingScripts ? 'Saving…' : 'Save'}
				</button>
				{#if form?.scriptsSaved}
					<span class="save-success">Saved</span>
				{/if}
			</div>
		</fieldset>
	</form>
</section>

<!-- Danger Zone -->
<section class="section danger-zone" data-testid="danger-zone">
	<h2 class="section-title danger-title">Danger Zone</h2>
	<article class="danger-card">
		<header class="danger-info">
			<strong>Delete this project</strong>
			<p class="muted">
				This will permanently delete the project, all deployments, environment variables, domains,
				and webhook data. This action cannot be undone.
			</p>
		</header>
		{#if !confirmDelete}
			<button class="btn-danger" onclick={() => (confirmDelete = true)} data-testid="delete-btn">
				Delete project
			</button>
		{:else}
			<form
				method="post"
				action="?/delete"
				use:enhance={() => {
					deleting = true
					return async ({ update }) => {
						deleting = false
						await update()
					}
				}}
			>
				<div class="confirm-row">
					<button
						type="submit"
						class="btn-danger-confirm"
						disabled={deleting}
						data-testid="confirm-delete-btn"
					>
						{deleting ? 'Deleting…' : 'Confirm delete'}
					</button>
					<button type="button" class="btn-cancel" onclick={() => (confirmDelete = false)}>Cancel</button>
				</div>
			</form>
		{/if}
	</article>
</section>
</div>

<style>
	.settings-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 40rem;
		width: 100%;
		margin: 0 auto;
	}
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.muted {
		color: var(--color-text-2);
		font-size: .875rem;
	}


	/* Scripts */
	.scripts-fieldset {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		padding-bottom: var(--space-5);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.scripts-fieldset label {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-1);
	}
	.scripts-fieldset input[type='text'] {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 1rem;
		font-weight: 400;
		outline: none;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.scripts-fieldset input[type='text']:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
	}
	.scripts-fieldset input::placeholder {
		color: var(--color-text-2);
	}
	.field-hint {
		font-size: .875rem;
		font-weight: 400;
		color: var(--color-text-2);
	}
	.field-hint a {
		color: var(--color-text-2);
		text-decoration: underline;
	}
	.field-hint a:hover {
		color: var(--color-text-1);
	}
	.scripts-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.save-success {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-live);
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
		color: var(--color-text-0);
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
		color: var(--color-text-1);
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
		line-height: 1.34;
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
	.env-empty {
		padding: var(--space-3);
		color: var(--color-text-2);
		font-size: .875rem;
		text-align: center;
	}
	.env-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
		border-top: 1px solid var(--color-border);
	}
	.save-error {
		font-size: .875rem;
		color: var(--color-failed);
		margin-left: var(--space-2);
	}

	/* Postgres */
	.postgres-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.postgres-empty,
	.postgres-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.postgres-empty h3,
	.postgres-header h3 {
		margin: 0;
		color: var(--color-text-0);
		font-size: 1.25rem;
		font-weight: 500;
	}
	.postgres-empty p,
	.postgres-header p {
		margin: 0;
	}
	.postgres-meta {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3);
		margin: 0;
	}
	.postgres-meta div {
		min-width: 0;
	}
	.postgres-meta dt {
		color: var(--color-text-2);
		font-size: .75rem;
		text-transform: uppercase;
		letter-spacing: 0;
	}
	.postgres-meta dd {
		margin: var(--space-1) 0 0;
		color: var(--color-text-0);
		font-size: .875rem;
		overflow-wrap: anywhere;
	}
	.postgres-url {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: .75rem;
		overflow-wrap: anywhere;
	}
	.postgres-warning {
		margin: 0 0 var(--space-3);
		color: var(--color-failed);
		font-size: .875rem;
		line-height: 1.5;
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

	/* Domains */
	.domain-list {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.domain-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		font-size: 1rem;
	}
	.domain-row:last-child {
		border-bottom: none;
	}
	.domain-name {
		flex: 1;
	}
	/* Cron jobs */
	.cron-list {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.cron-empty {
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-2);
		font-size: .875rem;
	}
	.cron-row {
		display: grid;
		grid-template-columns: 24px 1fr auto auto auto auto;
		align-items: center;
		gap: var(--space-2);
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-2) var(--space-3);
		font-size: .875rem;
	}
	.cron-row:last-child {
		border-bottom: none;
	}
	.cron-toggle input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--color-accent);
		cursor: pointer;
	}
	.cron-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.cron-name {
		font-weight: 500;
		color: var(--color-text-0);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cron-disabled {
		color: var(--color-text-2);
	}
	.cron-route {
		color: var(--color-text-2);
		font-size: .875rem;
	}
	.cron-schedule {
		color: var(--color-text-1);
		white-space: nowrap;
	}
	.cron-last-run {
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 500;
		white-space: nowrap;
	}
	.cron-success {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}
	.cron-failed {
		background: color-mix(in srgb, var(--color-failed) 15%, transparent);
		color: var(--color-failed);
	}
	.cron-timeout {
		background: color-mix(in srgb, var(--color-building) 15%, transparent);
		color: var(--color-building);
	}
	.cron-last-time {
		color: var(--color-text-2);
		white-space: nowrap;
	}
	.cron-actions {
		display: flex;
		gap: var(--space-1);
	}
	.btn-action {
		padding: 1px 4px;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: .75rem;
		line-height: 1.34;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-action:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
	.btn-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-action-danger:hover {
		border-color: var(--color-failed);
		color: var(--color-failed);
	}

	/* Integrations */
	.integration-list {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.integration-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border-bottom: 1px solid var(--color-border);
		font-size: 1rem;
	}
	.integration-row:last-child {
		border-bottom: none;
	}
	.integration-info {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1;
		min-width: 0;
	}
	.integration-name {
		font-weight: 500;
		color: var(--color-text-0);
	}
	.integration-detail {
		color: var(--color-text-1);
	}
	.integration-meta {
		font-size: .875rem;
		margin-left: auto;
		text-align: right;
	}

	.status-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.dot-live {
		background: var(--color-live);
		box-shadow: 0 0 6px var(--color-live);
	}
	.dot-stopped {
		background: var(--color-stopped);
	}

	/* Danger zone */
	.danger-title {
		color: var(--color-failed);
	}
	.danger-card {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-4);
		background: color-mix(in srgb, var(--color-failed) 5%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-failed) 20%, transparent);
		border-radius: var(--radius-md);
	}
	.danger-info {
		flex: 1;
	}
	.danger-info strong {
		font-size: 1rem;
		font-weight: 500;
	}
	.danger-info p {
		margin-top: var(--space-1);
		font-size: .875rem;
		line-height: 1.5;
		text-wrap: balance;
	}
	.btn-danger,
	.btn-danger-confirm {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1.5px solid var(--color-failed);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: .875rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-danger:hover,
	.btn-danger-confirm:hover {
		background: color-mix(in srgb, var(--color-failed) 10%, transparent);
	}
	.btn-danger-confirm {
		background: var(--color-failed);
		color: var(--color-bg-0);
	}
	.btn-danger-confirm:hover {
		background: #dc2626;
	}
	.btn-danger-confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.confirm-row {
		display: flex;
		gap: var(--space-2);
	}
	.btn-cancel {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
	}
	.btn-cancel:hover {
		border-color: var(--color-text-2);
	}

	form {
		display: contents;
	}
</style>
