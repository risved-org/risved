<script lang="ts">
	import type { UploadEntry } from './upload-file'

	let {
		items,
		busy,
		onretry,
		onreplace
	}: {
		items: UploadEntry[]
		busy: boolean
		onretry: (entry: UploadEntry) => void
		onreplace: (entry: UploadEntry) => void
	} = $props()
	let confirming = $state<UploadEntry | null>(null)
</script>

<ul aria-label="Selected files">
	{#each items as item (item)}
		<li>
			<strong>{item.file.name}</strong>
			<span class:failed={item.status === 'failed' || item.status === 'conflict'}
				>{item.message}</span
			>
			{#if item.status === 'failed'}
				<button
					type="button"
					class="btn-secondary btn-md"
					disabled={busy}
					onclick={() => onretry(item)}>Retry</button
				>
			{:else if item.status === 'conflict'}
				{#if confirming === item}
					<p>Replace “{item.file.name}”? The existing file will be overwritten.</p>
					<footer>
						<button
							type="button"
							class="btn-primary btn-md"
							disabled={busy}
							onclick={() => {
								confirming = null
								onreplace(item)
							}}>Replace file</button
						>
						<button
							type="button"
							class="btn-secondary btn-md"
							disabled={busy}
							onclick={() => {
								confirming = null
							}}>Cancel</button
						>
					</footer>
				{:else}
					<button
						type="button"
						class="btn-secondary btn-md"
						disabled={busy}
						onclick={() => {
							confirming = item
						}}>Replace</button
					>
				{/if}
			{/if}
		</li>
	{/each}
</ul>

<style>
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding: var(--space-2) 0;
		font-size: 0.875rem;
	}
	li + li {
		border-top: 1px solid var(--color-border);
	}
	strong {
		flex-basis: 100%;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	span {
		flex: 1;
		color: var(--color-text-2);
	}
	.failed {
		color: var(--color-failed);
	}
	p {
		flex-basis: 100%;
		overflow-wrap: anywhere;
	}
	footer {
		display: flex;
		gap: var(--space-2);
	}
</style>
