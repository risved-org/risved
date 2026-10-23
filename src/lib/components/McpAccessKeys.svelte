<script lang="ts">
	import { enhance } from '$app/forms'
	import TimeAgo from './TimeAgo.svelte'
	import type { ApiKeyRecord } from '$lib/server/api-keys'
	let { keys, error, createdKey }: { keys: ApiKeyRecord[]; error?: string; createdKey?: string } =
		$props()
	let mcpKeyLabel = $state('')
	let creatingMcpKey = $state(false)
	let newMcpKey = $state<string | null>(null)
	let mcpKeyCopied = $state(false)

	async function copyMcpKey() {
		const key = newMcpKey ?? createdKey
		if (!key) return
		await navigator.clipboard.writeText(key)
		mcpKeyCopied = true
		setTimeout(() => (mcpKeyCopied = false), 2000)
	}
</script>

<!-- MCP access keys -->
<section class="section" data-testid="mcp-keys-section">
	<h2 class="section-title">MCP access keys</h2>
	<section class="form-card">
		<p class="field-note">
			Bearer keys for agents and CI that cannot do the browser OAuth flow. Send one as
			<code class="mono">Authorization: Bearer rsv_…</code> to
			<code class="mono">/mcp</code>.
		</p>

		{#if newMcpKey || createdKey}
			<aside class="token-display" data-testid="new-mcp-key-display">
				<p class="token-warning">Copy this key now – it won't be shown again.</p>
				<p class="token-row">
					<code class="token-value mono" data-testid="mcp-key-value">{newMcpKey ?? createdKey}</code
					>
					<button class="btn-copy" onclick={copyMcpKey} data-testid="copy-mcp-key-btn">
						{mcpKeyCopied ? 'Copied' : 'Copy'}
					</button>
				</p>
			</aside>
		{/if}

		{#if keys.length > 0}
			<ul class="mcp-key-list" data-testid="mcp-key-list">
				{#each keys as key (key.id)}
					<li class="mcp-key-row">
						<span class="mcp-key-label">{key.label}</span>
						<code class="token-masked mono">{key.keyPrefix}…</code>
						<span class="mcp-key-used">
							{#if key.lastUsedAt}
								last used <TimeAgo value={key.lastUsedAt} />
							{:else}
								never used
							{/if}
						</span>
						<form method="post" action="?/revokeMcpKey" use:enhance>
							<input type="hidden" name="keyId" value={key.id} />
							<button type="submit" class="btn-danger-sm" data-testid="revoke-mcp-key-btn">
								Revoke
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty-text" data-testid="no-mcp-keys">No access keys.</p>
		{/if}

		<form
			method="post"
			action="?/createMcpKey"
			class="mcp-key-form"
			use:enhance={() => {
				creatingMcpKey = true
				return async ({ update, result }) => {
					creatingMcpKey = false
					if (result.type === 'success' && result.data?.newMcpKey) {
						newMcpKey = result.data.newMcpKey as string
						mcpKeyLabel = ''
					}
					await update({ reset: false })
				}
			}}
		>
			<input
				type="text"
				aria-label="Key label"
				class="form-input"
				name="label"
				bind:value={mcpKeyLabel}
				placeholder="CI pipeline"
				maxlength="60"
				data-testid="mcp-key-label-input"
			/>
			<button
				type="submit"
				class="btn-secondary btn-lg"
				disabled={creatingMcpKey || !mcpKeyLabel.trim()}
				data-testid="create-mcp-key-btn"
			>
				{creatingMcpKey ? 'Creating…' : 'Create key'}
			</button>
		</form>

		{#if error}
			<span class="form-error" data-testid="mcp-key-error">{error}</span>
		{/if}
	</section>
</section>

<style>
	.token-display {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.token-warning {
		font-size: 0.875rem;
		color: var(--color-building);
		font-weight: 500;
	}

	.token-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.token-value {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-0);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		word-break: break-all;
		color: var(--color-text-0);
	}

	.token-masked {
		color: var(--color-text-2);
	}

	.btn-copy {
		padding: 0.125rem var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-2);
		font-size: 0.875rem;
		cursor: pointer;
		flex-shrink: 0;
	}

	.form-error {
		font-size: 0.875rem;
		color: var(--color-failed);
	}

	.field-note {
		font-size: 0.875rem;
		color: var(--color-text-2);
		margin: 0 0 var(--space-3);
	}
	.mcp-key-list {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.mcp-key-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-2) 0;
		border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
	}
	.mcp-key-row:last-child {
		border-bottom: none;
	}
	.mcp-key-label {
		font-weight: 500;
		color: var(--color-text-0);
	}
	.mcp-key-used {
		font-size: 0.875rem;
		color: var(--color-text-2);
		margin-inline-start: auto;
	}
	.mcp-key-form {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		align-items: center;
	}
	.mcp-key-form input {
		flex: 1 1 12rem;
		min-width: 0;
	}
</style>
