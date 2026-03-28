<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LineChart from '$lib/components/LineChart.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let confirmDelete = $state(false);
	let deleting = $state(false);

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

	function duration(start: string | null, end: string | null): string {
		if (!start) return '–';
		const endTime = end ? new Date(end).getTime() : Date.now();
		const secs = Math.floor((endTime - new Date(start).getTime()) / 1000);
		const mins = Math.floor(secs / 60);
		return mins > 0 ? `${mins}m ${secs % 60}s` : `${secs}s`;
	}

	function statusClass(status: string): string {
		if (status === 'live') return 'dot-live';
		if (status === 'failed') return 'dot-failed';
		if (status === 'building') return 'dot-building';
		return 'dot-stopped';
	}

	function formatHour(iso: string): string {
		const d = new Date(iso);
		return `${d.getHours().toString().padStart(2, '0')}:00`;
	}

	let cpuPoints = $derived(
		data.resourceMetrics.map((m) => ({ label: formatHour(m.bucket), value: m.cpuPercent }))
	);
	let memPoints = $derived(
		data.resourceMetrics.map((m) => ({ label: formatHour(m.bucket), value: m.memoryMb }))
	);

	let rollingBack = $state<string | null>(null);
	let triggeringCron = $state<string | null>(null);
	let expandedCron = $state<string | null>(null);

	function cronStatusClass(status: string | undefined): string {
		if (!status) return '';
		if (status === 'success') return 'cron-success';
		if (status === 'timeout') return 'cron-timeout';
		return 'cron-failed';
	}

	function describeSchedule(expr: string): string {
		const parts = expr.trim().split(/\s+/);
		if (parts.length < 5) return expr;
		const [min, hour, dom, mon, dow] = parts;

		if (min === '*' && hour === '*') return 'Every minute';
		if (min === '0' && hour === '*') return 'Every hour';
		if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*')
			return 'Daily at midnight';
		if (dom === '*' && mon === '*' && dow === '*' && hour !== '*')
			return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
		if (dom === '*' && mon === '*' && dow === '1')
			return `Mondays at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
		return expr;
	}

	async function handleTriggerCron(jobId: string) {
		triggeringCron = jobId;
		try {
			await fetch(`/api/projects/${data.project.id}/crons/${jobId}/trigger`, { method: 'POST' });
			window.location.reload();
		} finally {
			triggeringCron = null;
		}
	}

	async function handleDeleteCron(jobId: string) {
		await fetch(`/api/projects/${data.project.id}/crons/${jobId}`, { method: 'DELETE' });
		window.location.reload();
	}

	async function handleToggleCron(jobId: string, enabled: boolean) {
		await fetch(`/api/projects/${data.project.id}/crons/${jobId}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ enabled })
		});
		window.location.reload();
	}

	async function handleRedeploy() {
		const res = await fetch(`/api/projects/${data.project.id}/deploy`, { method: 'POST' })
		if (res.ok) {
			const { deploymentId } = await res.json()
			if (deploymentId) {
				goto(resolve(`/projects/${data.project.slug}/deployments/${deploymentId}`))
			} else {
				await invalidateAll()
			}
		}
	}

	async function handleRollback(e: Event, depId: string) {
		e.preventDefault();
		e.stopPropagation();
		rollingBack = depId;
		try {
			await fetch(`/api/projects/${data.project.id}/deployments/${depId}/rollback`, {
				method: 'POST'
			});
			window.location.reload();
		} finally {
			rollingBack = null;
		}
	}
</script>

<svelte:head>
	<title>{data.project.name} – Risved</title>
</svelte:head>

<div class="project-detail">
	<!-- Header -->
	<header class="project-header" data-testid="project-header">
		<a href={resolve('/')} class="back-link">← Dashboard</a>
		<div class="header-row">
			<h1>{data.project.name}</h1>
			<span class="status-dot {statusClass(data.project.status)}"></span>
			{#if data.project.framework}
				<span class="framework-badge">{data.project.framework}</span>
			{/if}
		</div>
		{#if data.project.domain}
			<a
				href="https://{data.project.domain}"
				target="_blank"
				rel="noopener"
				class="domain-link mono"
				data-testid="domain-link"
			>
				{data.project.domain} ↗
			</a>
		{/if}
	</header>

	<!-- Deployments -->
	<section class="section" data-testid="deployments-section">
		<div class="section-header">
			<h2 class="section-title">Deployments</h2>
			<button class="btn-sm" onclick={handleRedeploy} data-testid="redeploy-btn">Redeploy</button>
		</div>
		{#if data.deployments.length === 0}
			<p class="empty-text">No deployments yet.</p>
		{:else}
			<div class="deploy-list">
				{#each data.deployments as dep, i (dep.id)}
					<a
						href={resolve(`/projects/${data.project.slug}/deployments/${dep.id}`)}
						class="deploy-row"
						data-testid="deploy-row"
					>
						<span class="status-dot {statusClass(dep.status)}"></span>
						<span class="deploy-sha mono">{dep.commitSha?.slice(0, 7) ?? '–'}</span>
						<span class="deploy-status">
							{dep.status === 'live' ? 'success' : dep.status}
							{#if dep.triggerType === 'rollback'}
								<span class="trigger-badge" data-testid="rollback-badge">rollback</span>
							{/if}
							{#if dep.status === 'live' && i === data.deployments.findIndex((d) => d.status === 'live')}
								<span class="current-badge">current</span>
							{/if}
						</span>
						<span class="deploy-time mono">{timeAgo(dep.createdAt)}</span>
						<span class="deploy-actions">
							{#if i > 0 && (dep.status === 'live' || dep.status === 'stopped') && dep.imageTag}
								<button
									class="btn-rollback"
									data-testid="rollback-btn"
									disabled={rollingBack === dep.id}
									onclick={(e) => handleRollback(e, dep.id)}
								>
									{rollingBack === dep.id ? 'Rolling back…' : 'Rollback'}
								</button>
							{:else}
								<span class="deploy-duration mono">{duration(dep.createdAt, dep.finishedAt)}</span>
							{/if}
						</span>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Container Health -->
	<section class="section" data-testid="health-section">
		<h2 class="section-title">Container Health</h2>
		{#if data.containerHealth}
			<div class="health-card">
				<div class="health-status-row">
					<span class="status-dot {data.containerHealth.healthy ? 'dot-live' : 'dot-failed'}"
					></span>
					<span class="health-status-text" data-testid="health-status">
						{data.containerHealth.healthy ? 'Healthy' : 'Unhealthy'}
					</span>
					{#if data.containerHealth.lastCheckAt}
						<span class="muted">– Last check {timeAgo(data.containerHealth.lastCheckAt)}</span>
					{/if}
				</div>
				<div class="health-meta">
					<span class="health-meta-item">
						Failures: <strong>{data.containerHealth.consecutiveFailures}</strong>
					</span>
					<span class="health-meta-item">
						Restarts: <strong data-testid="restart-count"
							>{data.containerHealth.totalRestarts}</strong
						>
					</span>
					{#if data.containerHealth.lastRestartAt}
						<span class="health-meta-item">
							Last restart: <strong>{timeAgo(data.containerHealth.lastRestartAt)}</strong>
						</span>
					{/if}
				</div>
			</div>
		{:else}
			<p class="empty-text">No health data yet. Monitoring starts after deployment goes live.</p>
		{/if}
		{#if data.healthEvents.length > 0}
			<div class="health-events" data-testid="health-events">
				{#each data.healthEvents as evt (evt.id)}
					<div class="health-event-row">
						<span class="event-badge event-{evt.event}">{evt.event.replace('_', ' ')}</span>
						<span class="event-msg">{evt.message}</span>
						<span class="event-time mono">{timeAgo(evt.createdAt)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Resource Usage -->
	<section class="section" data-testid="resource-section">
		<h2 class="section-title">Resource history</h2>
		<div class="charts-grid">
			<LineChart points={cpuPoints} label="CPU %" color="var(--color-accent)" unit="%" />
			<LineChart points={memPoints} label="Memory (MB)" color="var(--color-live)" unit="MB" />
		</div>
	</section>

	<!-- PR Status Checks -->
	<section class="section" data-testid="checks-section">
		<div class="section-header">
			<h2 class="section-title">PR Status Checks</h2>
			<a
				href={resolve(`/projects/${data.project.slug}/checks`)}
				class="btn-sm"
				data-testid="configure-checks-btn">Configure</a
			>
		</div>
	</section>

	<!-- Webhook -->
	<section class="section" data-testid="webhook-section">
		<div class="section-header">
			<h2 class="section-title">Webhook</h2>
			<a
				href={resolve(`/projects/${data.project.slug}/webhooks`)}
				class="btn-sm"
				data-testid="configure-webhook-btn">Configure</a
			>
		</div>
		<div class="webhook-bar">
			{#if data.webhookActive}
				<span class="status-dot dot-live"></span>
				<span>Webhook active</span>
				{#if data.lastWebhookAt}
					<span class="muted">– Last received {timeAgo(data.lastWebhookAt)}</span>
				{/if}
			{:else}
				<span class="status-dot dot-stopped"></span>
				<span class="muted">No webhook configured</span>
			{/if}
		</div>
	</section>

	<!-- Environment Variables -->
	<section class="section" data-testid="env-section">
		<div class="section-header">
			<h2 class="section-title">Environment Variables</h2>
			<a
				href={resolve(`/projects/${data.project.slug}/settings`)}
				class="btn-sm"
				data-testid="edit-env-btn">Edit</a
			>
		</div>
		{#if data.envVars.length === 0}
			<p class="empty-text">No environment variables configured.</p>
		{:else}
			<div class="env-block">
				{#each data.envVars as env (env.id)}
					<div class="env-line" data-testid="env-line">
						<span class="env-key">{env.key}</span>
						<span class="env-eq">=</span>
						<span class="env-val" class:env-secret={env.isSecret}>{env.value}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Cron Jobs -->
	<section class="section" data-testid="crons-section">
		<div class="section-header">
			<h2 class="section-title">Scheduled Tasks</h2>
			<a
				href={resolve(`/projects/${data.project.slug}/crons`)}
				class="btn-sm"
				data-testid="manage-crons-btn">Manage</a
			>
		</div>
		{#if data.cronJobs.length === 0}
			<p class="empty-text">No scheduled tasks configured.</p>
		{:else}
			<div class="cron-list">
				{#each data.cronJobs as job (job.id)}
					<div class="cron-row" data-testid="cron-row">
						<div class="cron-main">
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
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Domains -->
	<section class="section" data-testid="domains-section">
		<div class="section-header">
			<h2 class="section-title">Domains</h2>
			<a
				href={resolve(`/projects/${data.project.slug}/domains`)}
				class="btn-sm"
				data-testid="manage-domains-btn">Manage</a
			>
		</div>
		{#if data.domains.length === 0}
			<p class="empty-text">No custom domains configured.</p>
		{:else}
			<div class="domain-list">
				{#each data.domains as dom (dom.id)}
					<div class="domain-row" data-testid="domain-row">
						<span class="domain-name mono">{dom.hostname}</span>
						{#if dom.isPrimary}
							<span class="primary-badge">Primary</span>
						{/if}
						<span class="ssl-badge" class:ssl-active={dom.sslStatus === 'active'}>
							SSL: {dom.sslStatus}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Danger zone -->
	<section class="section danger-zone" data-testid="danger-zone">
		<h2 class="section-title danger-title">Danger Zone</h2>
		<div class="danger-card">
			<div class="danger-info">
				<strong>Delete this project</strong>
				<p class="muted">
					This will permanently delete the project, all deployments, environment variables, domains,
					and webhook data. This action cannot be undone.
				</p>
			</div>
			{#if !confirmDelete}
				<button class="btn-danger" onclick={() => (confirmDelete = true)} data-testid="delete-btn">
					Delete project
				</button>
			{:else}
				<form
					method="post"
					action="?/delete"
					use:enhance={() => {
						deleting = true;
						return async ({ update }) => {
							deleting = false;
							await update();
						};
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
						<button type="button" class="btn-cancel" onclick={() => (confirmDelete = false)}
							>Cancel</button
						>
					</div>
				</form>
			{/if}
		</div>
	</section>
</div>

<style>
	.project-detail {
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

	.header-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.domain-link {
		font-size: .875rem;
		color: var(--color-accent);
		margin-top: var(--space-1);
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
	.dot-failed {
		background: var(--color-failed);
	}
	.dot-building {
		background: var(--color-building);
	}
	.dot-stopped {
		background: var(--color-stopped);
	}

	.framework-badge {
		padding: 1px 8px;
		background: var(--color-bg-3);
		border-radius: var(--radius-sm);
		font-size: .875rem;
		color: var(--color-text-1);
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

	.btn-sm {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
	}
	.btn-sm:hover {
		border-color: var(--color-text-2);
		color: var(--color-text-0);
	}

	/* Deployments */
	.deploy-list {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.deploy-row {
		display: grid;
		grid-template-columns: 20px 80px 1fr auto 80px;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		gap: var(--space-2);
		border-bottom: 1px solid var(--color-border);
		font-size: .875rem;
		color: var(--color-text-0);
		text-decoration: none;
		transition: background 0.1s;
	}
	.deploy-row:last-child {
		border-bottom: none;
	}
	.deploy-row:hover {
		background: var(--color-bg-2);
		text-decoration: none;
	}
	.deploy-status {
		color: var(--color-text-1);
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.deploy-time,
	.deploy-duration {
		color: var(--color-text-2);
	}
	.deploy-actions {
		text-align: right;
	}
	.trigger-badge {
		padding: 1px 6px;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 500;
	}

	.current-badge {
		padding: 1px 6px;
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
		border-radius: var(--radius-sm);
		font-size: .75rem;
		font-weight: 600;
		letter-spacing: 0.03em;
	}
	.btn-rollback {
		padding: 2px 8px;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: .875rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn-rollback:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}
	.btn-rollback:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Charts grid */
	.charts-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}
	@media (max-width: 600px) {
		.charts-grid {
			grid-template-columns: 1fr;
		}
	}

	/* Health section */
	.health-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: .875rem;
	}
	.health-status-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.health-status-text {
		font-weight: 500;
	}
	.health-meta {
		display: flex;
		gap: var(--space-4);
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.health-meta-item strong {
		color: var(--color-text-0);
	}
	.health-events {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.health-event-row {
		display: grid;
		grid-template-columns: 90px 1fr auto;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		font-size: .875rem;
	}
	.health-event-row:last-child {
		border-bottom: none;
	}
	.event-badge {
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.event-check_failed {
		background: color-mix(in srgb, var(--color-failed) 15%, transparent);
		color: var(--color-failed);
	}
	.event-restarted {
		background: color-mix(in srgb, var(--color-building) 15%, transparent);
		color: var(--color-building);
	}
	.event-recovered {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}
	.event-msg {
		color: var(--color-text-1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.event-time {
		color: var(--color-text-2);
		white-space: nowrap;
	}

	/* Webhook */
	.webhook-bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: .875rem;
	}

	/* Env block */
	.env-block {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: .875rem;
	}
	.env-line {
		display: flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}
	.env-line:last-child {
		border-bottom: none;
	}
	.env-key {
		color: var(--color-term-cmd);
	}
	.env-eq {
		color: var(--color-text-2);
		margin: 0 var(--space-1);
	}
	.env-val {
		color: var(--color-term-success);
	}
	.env-secret {
		color: var(--color-text-2);
	}

	/* Domains */
	.domain-list {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.domain-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		font-size: .875rem;
	}
	.domain-row:last-child {
		border-bottom: none;
	}
	.domain-name {
		flex: 1;
	}
	.primary-badge {
		padding: 1px 6px;
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 500;
	}
	.ssl-badge {
		font-size: .875rem;
		color: var(--color-text-2);
	}
	.ssl-active {
		color: var(--color-live);
	}

	/* Cron jobs */
	.cron-list {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.cron-row {
		border-bottom: 1px solid var(--color-border);
	}
	.cron-row:last-child {
		border-bottom: none;
	}
	.cron-main {
		display: grid;
		grid-template-columns: 24px 1fr auto auto auto auto;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: .875rem;
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
		padding: 2px 8px;
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: .875rem;
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
	}
	.danger-info p {
		margin-top: var(--space-1);
		font-size: .875rem;
		line-height: 1.5;
	}

	.btn-danger,
	.btn-danger-confirm {
		padding: var(--space-2) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-failed);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: .875rem;
		font-weight: 500;
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
</style>
