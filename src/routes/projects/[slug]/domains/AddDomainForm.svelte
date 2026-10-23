<script lang="ts">
	import { enhance } from '$app/forms'
	import DomainMountFields from '$lib/components/DomainMountFields.svelte'
	import DomainRoutingHelp from './DomainRoutingHelp.svelte'
	import type { PageData, ActionData } from './$types'
	let {
		data,
		form,
		onadded,
		oncancel,
		copiedKey,
		copyIp
	}: {
		data: PageData
		form: ActionData
		onadded: () => void
		oncancel: () => void
		copiedKey: string | null
		copyIp: (ip: string, key: string) => void
	} = $props()
	let hostname = $state('')
	let adding = $state(false)
</script>

<section data-testid="add-domain-section">
	<h2 class="section-title">Add Domain</h2>

	<form
		method="post"
		action="?/add"
		use:enhance={() => {
			adding = true
			return async ({ update, result }) => {
				adding = false
				if (result.type === 'success') {
					onadded()
					hostname = ''
				}
				await update()
			}
		}}
	>
		<div class="add-form">
			<DomainMountFields />
			<div class="input-row">
				<input
					type="text"
					name="hostname"
					bind:value={hostname}
					placeholder="app.example.com"
					class="hostname-input mono"
					data-testid="hostname-input"
				/>
				<button
					type="submit"
					class="btn-primary btn-md"
					disabled={adding || !hostname.trim()}
					data-testid="confirm-add-btn"
				>
					{adding ? 'Adding…' : 'Add'}
				</button>
				<button
					type="button"
					class="btn-cancel"
					onclick={() => {
						oncancel()
						hostname = ''
					}}
				>
					Cancel
				</button>
			</div>
			{#if form?.error}
				<p class="form-error" data-testid="add-error">{form.error}</p>
			{/if}
		</div>
	</form>

	<DomainRoutingHelp {data} {hostname} {copiedKey} {copyIp} />
</section>

<style>
	/* Add domain form */
	.add-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.input-row {
		display: flex;
		gap: var(--space-2);
	}
	.hostname-input {
		flex: 1;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 0.875rem;
	}
	.hostname-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
	.hostname-input::placeholder {
		color: var(--color-text-2);
	}
	.btn-cancel {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: 0.875rem;
		cursor: pointer;
	}
	.btn-cancel:hover {
		border-color: var(--color-text-2);
	}
	.form-error {
		color: var(--color-failed);
		font-size: 0.875rem;
	}
</style>
