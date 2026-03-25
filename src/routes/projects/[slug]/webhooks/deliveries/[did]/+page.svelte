<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let redelivering = $state(false);
	let redelivered = $state(false);

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '–';
		const d = new Date(dateStr);
		return d.toLocaleString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		});
	}

	/** Simple JSON syntax colouring – returns HTML string. */
	function syntaxHighlight(json: unknown): string {
		const str = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
		if (!str) return '';
		return str.replace(
			/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
			(match) => {
				let cls = 'json-number';
				if (match.startsWith('"')) {
					cls = match.endsWith(':') ? 'json-key' : 'json-string';
				} else if (/true|false/.test(match)) {
					cls = 'json-boolean';
				} else if (match === 'null') {
					cls = 'json-null';
				}
				return `<span class="${cls}">${match}</span>`;
			}
		);
	}

	const headerEntries = $derived(Object.entries(data.delivery.headers));
	const payloadHtml = $derived(syntaxHighlight(data.delivery.payload));
</script>

<svelte:head>
	<title>Delivery {data.delivery.id.slice(0, 8)} – {data.project.name} – Risved</title>
</svelte:head>

<div class="delivery-detail">
	<header class="page-header">
		<a href={resolve(`/projects/${data.project.slug}/webhooks/deliveries`)} class="back-link"
			>← Deliveries</a
		>
		<h1>Delivery Detail</h1>
	</header>

	<!-- Metadata grid -->
	<section class="section" data-testid="metadata-section">
		<h2 class="section-title">Metadata</h2>
		<div class="meta-grid" data-testid="meta-grid">
			<div class="meta-item">
				<span class="meta-label">Delivery ID</span>
				<span class="meta-value mono">{data.delivery.id}</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Event</span>
				<span class="meta-value mono">{data.delivery.event}</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Timestamp</span>
				<span class="meta-value mono">{formatDate(data.delivery.createdAt)}</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Action</span>
				<span class="meta-value">{data.delivery.actionTaken ?? '–'}</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Signature</span>
				<span
					class="meta-value sig-badge"
					class:sig-valid={data.delivery.signatureValid}
					class:sig-invalid={!data.delivery.signatureValid}
					data-testid="sig-status"
				>
					{data.delivery.signatureValid ? 'Valid' : 'Invalid'}
				</span>
			</div>
		</div>
	</section>

	<!-- Request Headers -->
	<section class="section" data-testid="headers-section">
		<h2 class="section-title">Request Headers</h2>
		<div class="terminal-block" data-testid="headers-block">
			{#if headerEntries.length === 0}
				<span class="term-muted">No headers recorded</span>
			{:else}
				{#each headerEntries as [key, value] (key)}
					<div class="header-line">
						<span class="header-key">{key}:</span>
						<span class="header-val">{value}</span>
					</div>
				{/each}
			{/if}
		</div>
	</section>

	<!-- Payload -->
	<section class="section" data-testid="payload-section">
		<h2 class="section-title">Payload</h2>
		<pre class="terminal-block payload-block" data-testid="payload-block">{@html payloadHtml}</pre>
	</section>

	<!-- Actions -->
	<section class="section" data-testid="actions-section">
		<form
			method="post"
			action="?/redeliver"
			use:enhance={() => {
				redelivering = true;
				return async ({ update }) => {
					redelivering = false;
					redelivered = true;
					setTimeout(() => (redelivered = false), 3000);
					await update();
				};
			}}
		>
			<button
				type="submit"
				class="btn-redeliver"
				disabled={redelivering}
				data-testid="redeliver-btn"
			>
				{#if redelivering}
					Redelivering…
				{:else if redelivered}
					Redelivered!
				{:else}
					Redeliver
				{/if}
			</button>
		</form>
	</section>
</div>

<style>
	.delivery-detail {
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

	/* Metadata grid */
	.meta-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}
	.meta-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.meta-label {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.meta-value {
		font-size: .875rem;
		color: var(--color-text-0);
		word-break: break-all;
	}

	/* Signature badges */
	.sig-badge {
		display: inline-block;
		width: fit-content;
		padding: 1px 8px;
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 500;
	}
	.sig-valid {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}
	.sig-invalid {
		background: color-mix(in srgb, var(--color-failed) 15%, transparent);
		color: var(--color-failed);
	}

	/* Terminal blocks */
	.terminal-block {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: .875rem;
		line-height: 1.6;
		overflow-x: auto;
	}
	.term-muted {
		color: var(--color-text-2);
	}

	/* Headers */
	.header-line {
		display: flex;
		gap: var(--space-2);
	}
	.header-key {
		color: var(--color-term-cmd);
		flex-shrink: 0;
	}
	.header-val {
		color: var(--color-text-1);
		word-break: break-all;
	}

	/* Payload */
	.payload-block {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-all;
		max-height: 500px;
		overflow-y: auto;
	}

	/* JSON syntax colours */
	.payload-block :global(.json-key) {
		color: var(--color-term-cmd);
	}
	.payload-block :global(.json-string) {
		color: var(--color-term-success);
	}
	.payload-block :global(.json-number) {
		color: var(--color-accent);
	}
	.payload-block :global(.json-boolean) {
		color: var(--color-building);
	}
	.payload-block :global(.json-null) {
		color: var(--color-text-2);
	}

	/* Redeliver button */
	.btn-redeliver {
		padding: var(--space-2) var(--space-4);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		font-weight: 500;
		cursor: pointer;
	}
	.btn-redeliver:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}
	.btn-redeliver:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
