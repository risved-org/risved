<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function timeAgo(dateStr: string | null): string {
		if (!dateStr) return '–';
		const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	function statusLabel(valid: boolean, action: string | null): string {
		if (!valid) return 'rejected';
		if (action?.startsWith('triggered')) return 'deployed';
		if (action?.startsWith('skipped')) return 'skipped';
		return 'received';
	}

	function statusClass(valid: boolean, action: string | null): string {
		if (!valid) return 'status-rejected';
		if (action?.startsWith('triggered')) return 'status-deployed';
		if (action?.startsWith('skipped')) return 'status-skipped';
		return 'status-received';
	}
</script>

<svelte:head>
	<title>Deliveries – {data.project.name} – Risved</title>
</svelte:head>

<div class="deliveries-page">
	<nav class="sub-breadcrumb">
		<a href={resolve(`/projects/${data.project.slug}/webhooks`)} class="breadcrumb-link">← Webhooks</a>
	</nav>

	<section data-testid="deliveries-list">
		{#if data.deliveries.length === 0}
			<div class="empty-state" data-testid="empty-state">
				<p class="empty-text">No webhook deliveries yet.</p>
				<p class="empty-hint">
					Configure your git provider to send webhooks to this project's payload URL.
				</p>
			</div>
		{:else}
			<div class="delivery-table">
				<div class="table-header">
					<span class="col-event">Event</span>
					<span class="col-status">Status</span>
					<span class="col-action">Action</span>
					<span class="col-time">Time</span>
				</div>
				{#each data.deliveries as del (del.id)}
					<a
						href={resolve(`/projects/${data.project.slug}/webhooks/deliveries/${del.id}`)}
						class="delivery-row"
						data-testid="delivery-row"
					>
						<span class="col-event mono">{del.event}</span>
						<span class="col-status">
							<span
								class="status-badge {statusClass(del.signatureValid, del.actionTaken)}"
								data-testid="delivery-status"
							>
								{statusLabel(del.signatureValid, del.actionTaken)}
							</span>
						</span>
						<span class="col-action">{del.actionTaken ?? '–'}</span>
						<span class="col-time mono">{timeAgo(del.createdAt)}</span>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.deliveries-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.sub-breadcrumb {
		margin-bottom: calc(-1 * var(--space-3));
	}
	.breadcrumb-link {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.breadcrumb-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	/* Empty state */
	.empty-state {
		padding: var(--space-5) var(--space-4);
		text-align: center;
	}
	.empty-text {
		color: var(--color-text-1);
		font-size: 1rem;
	}
	.empty-hint {
		color: var(--color-text-2);
		font-size: .875rem;
		margin-top: var(--space-2);
	}

	/* Table */
	.delivery-table {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.table-header {
		display: grid;
		grid-template-columns: 120px 90px 1fr 90px;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border-bottom: 1px solid var(--color-border);
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.delivery-row {
		display: grid;
		grid-template-columns: 120px 90px 1fr 90px;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		font-size: .875rem;
		color: var(--color-text-0);
		text-decoration: none;
		transition: background 0.1s;
	}
	.delivery-row:last-child {
		border-bottom: none;
	}
	.delivery-row:hover {
		background: var(--color-bg-2);
		text-decoration: none;
	}

	.col-action {
		color: var(--color-text-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: .875rem;
	}
	.col-time {
		color: var(--color-text-2);
	}

	/* Status badges */
	.status-badge {
		display: inline-block;
		padding: 1px 8px;
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 500;
	}
	.status-deployed {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}
	.status-rejected {
		background: color-mix(in srgb, var(--color-failed) 15%, transparent);
		color: var(--color-failed);
	}
	.status-skipped {
		background: color-mix(in srgb, var(--color-building) 15%, transparent);
		color: var(--color-building);
	}
	.status-received {
		background: var(--color-bg-3);
		color: var(--color-text-1);
	}
</style>
