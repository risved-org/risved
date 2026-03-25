<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface LogLine {
		timestamp: string;
		phase: string;
		level: string;
		message: string;
	}

	let logs = $state<LogLine[]>(data.logs);
	let status = $state(data.deployment.status);
	let isTerminal = $state(data.isTerminal);
	let elapsed = $state('');
	let terminalEl: HTMLDivElement | undefined = $state();
	let eventSource: EventSource | null = null;

	/* Current phase: the last phase seen in logs */
	const currentPhase = $derived.by(() => {
		if (status === 'live') return 'live';
		if (status === 'failed') return 'failed';
		for (let i = logs.length - 1; i >= 0; i--) {
			if (logs[i].phase) return logs[i].phase;
		}
		return 'clone';
	});

	/* Phase state for indicator */
	function phaseState(phaseId: string): 'completed' | 'active' | 'pending' | 'failed' {
		if (status === 'failed' && currentPhase === phaseId) return 'failed';
		const phases = data.phases.map((p) => p.id);
		const currentIdx = phases.indexOf(currentPhase);
		const phaseIdx = phases.indexOf(phaseId);
		if (phaseIdx < currentIdx) return 'completed';
		if (phaseIdx === currentIdx) return status === 'live' ? 'completed' : 'active';
		return 'pending';
	}

	/* Elapsed time calculation */
	function updateElapsed() {
		const start = data.deployment.startedAt ?? data.deployment.createdAt;
		if (!start) return;
		const end = isTerminal
			? (data.deployment.finishedAt ?? new Date().toISOString())
			: new Date().toISOString();
		const seconds = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000);
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		elapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
	}

	/* Auto-scroll to bottom */
	function scrollToBottom() {
		if (terminalEl) {
			terminalEl.scrollTop = terminalEl.scrollHeight;
		}
	}

	/* Level to CSS class */
	function levelClass(level: string): string {
		if (level === 'error') return 'log-error';
		if (level === 'warn') return 'log-warn';
		if (level === 'debug') return 'log-debug';
		return 'log-info';
	}

	/* Format timestamp to HH:MM:SS */
	function formatTime(ts: string): string {
		try {
			const d = new Date(ts);
			return d.toTimeString().slice(0, 8);
		} catch {
			return '';
		}
	}

	/* Check if a message looks like a command */
	function isCommand(msg: string): boolean {
		return msg.startsWith('$ ') || msg.startsWith('> ');
	}

	onMount(() => {
		updateElapsed();

		/* Start SSE if deployment is in progress */
		if (!isTerminal) {
			const url = `/api/projects/${data.project.id}/deployments/${data.deployment.id}/logs`;
			eventSource = new EventSource(url);

			eventSource.onmessage = (event) => {
				try {
					const log: LogLine = JSON.parse(event.data);
					logs = [...logs, log];
					requestAnimationFrame(scrollToBottom);
				} catch {
					/* ignore parse errors */
				}
			};

			eventSource.addEventListener('done', (event) => {
				status = (event as MessageEvent).data ?? 'unknown';
				isTerminal = true;
				eventSource?.close();
				eventSource = null;
			});

			eventSource.onerror = () => {
				eventSource?.close();
				eventSource = null;
			};
		}

		/* Update elapsed timer */
		const timer = setInterval(updateElapsed, 1000);

		requestAnimationFrame(scrollToBottom);

		return () => {
			clearInterval(timer);
		};
	});

	onDestroy(() => {
		eventSource?.close();
	});
</script>

<svelte:head>
	<title>Build Log – {data.project.name} – Risved</title>
</svelte:head>

<div class="build-log">
	<!-- Header -->
	<header class="build-header">
		<a href={resolve(`/projects/${data.project.slug}`)} class="back-link" data-testid="back-link">
			← {data.project.name}
		</a>

		<!-- Phase indicator -->
		<div class="phase-indicator" data-testid="phase-indicator">
			{#each data.phases as phase, i (phase.id)}
				{#if i > 0}
					<div
						class="phase-connector"
						class:completed={phaseState(phase.id) === 'completed' ||
							phaseState(data.phases[i - 1].id) === 'completed'}
					></div>
				{/if}
				<div
					class="phase-step"
					class:completed={phaseState(phase.id) === 'completed'}
					class:active={phaseState(phase.id) === 'active'}
					class:failed={phaseState(phase.id) === 'failed'}
					data-testid="phase-step"
				>
					<div class="phase-dot"></div>
					<span class="phase-label">{phase.label}</span>
				</div>
			{/each}
		</div>
	</header>

	<!-- Metadata bar -->
	<div class="metadata-bar" data-testid="metadata-bar">
		<div class="meta-item">
			<span class="meta-label">Status</span>
			<span
				class="meta-value status-badge"
				class:status-live={status === 'live'}
				class:status-failed={status === 'failed'}
				class:status-building={!isTerminal}
				data-testid="status-badge"
			>
				{status}
			</span>
		</div>
		{#if data.deployment.commitSha}
			<div class="meta-item">
				<span class="meta-label">Commit</span>
				<span class="meta-value mono" data-testid="commit-sha"
					>{data.deployment.commitSha.slice(0, 7)}</span
				>
			</div>
		{/if}
		<div class="meta-item">
			<span class="meta-label">Elapsed</span>
			<span class="meta-value mono" data-testid="elapsed-time">{elapsed || '–'}</span>
		</div>
	</div>

	<!-- Error summary on failure -->
	{#if status === 'failed'}
		<div class="error-summary" data-testid="error-summary">
			<span class="error-title">Build failed</span>
			<span class="error-hint">Check the log below for details.</span>
			<a
				href={resolve(`/api/projects/${data.project.id}/deploy`)}
				class="retry-btn"
				data-testid="retry-btn"
				data-sveltekit-reload
				onclick={(e) => {
					e.preventDefault();
					fetch(`/api/projects/${data.project.id}/deploy`, { method: 'POST' });
					location.reload();
				}}
			>
				Retry deployment
			</a>
		</div>
	{/if}

	<!-- Terminal output -->
	<div class="terminal" data-testid="terminal" bind:this={terminalEl}>
		{#each logs as log, i (i)}
			<div class="log-line {levelClass(log.level)}" class:log-cmd={isCommand(log.message)}>
				<span class="log-time">{formatTime(log.timestamp)}</span>
				<span class="log-msg">{log.message}</span>
			</div>
		{/each}
		{#if !isTerminal}
			<div class="cursor-line">
				<span class="cursor-blink">█</span>
			</div>
		{/if}
		{#if logs.length === 0}
			<div class="log-empty">Waiting for build output…</div>
		{/if}
	</div>

	<!-- Success actions -->
	{#if status === 'live'}
		<div class="success-actions" data-testid="success-actions">
			{#if data.project.domain}
				<a
					href="https://{data.project.domain}"
					target="_blank"
					rel="noopener"
					class="btn-primary"
					data-testid="live-link"
				>
					Open live site ↗
				</a>
			{/if}
			<a
				href={resolve(`/projects/${data.project.slug}`)}
				class="btn-secondary"
				data-testid="view-project-btn"
			>
				View project
			</a>
		</div>
	{/if}
</div>

<style>
	.build-log {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		max-width: 960px;
		margin: 0 auto;
		width: 100%;
		padding: var(--space-4);
		gap: var(--space-3);
	}

	/* Header */
	.build-header {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.back-link {
		font-size: .875rem;
		color: var(--color-text-2);
	}

	.back-link:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	/* Phase indicator */
	.phase-indicator {
		display: flex;
		align-items: center;
		gap: 0;
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.phase-step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		flex: 0 0 auto;
	}

	.phase-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--color-bg-3);
		border: 2px solid var(--color-border);
		transition: all 0.2s;
	}

	.phase-step.completed .phase-dot {
		background: var(--color-live);
		border-color: var(--color-live);
		box-shadow: 0 0 6px color-mix(in srgb, var(--color-live) 40%, transparent);
	}

	.phase-step.active .phase-dot {
		background: var(--color-building);
		border-color: var(--color-building);
		box-shadow: 0 0 6px color-mix(in srgb, var(--color-building) 40%, transparent);
		animation: pulse 1.5s ease-in-out infinite;
	}

	.phase-step.failed .phase-dot {
		background: var(--color-failed);
		border-color: var(--color-failed);
		box-shadow: 0 0 6px color-mix(in srgb, var(--color-failed) 40%, transparent);
	}

	.phase-label {
		font-size: .875rem;
		font-weight: 500;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.phase-step.completed .phase-label,
	.phase-step.active .phase-label {
		color: var(--color-text-0);
	}

	.phase-connector {
		flex: 1;
		height: 2px;
		background: var(--color-border);
		margin: 0 var(--space-1);
		margin-bottom: var(--space-4);
		transition: background 0.2s;
	}

	.phase-connector.completed {
		background: var(--color-live);
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	/* Metadata bar */
	.metadata-bar {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-2) var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: .875rem;
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.meta-label {
		color: var(--color-text-2);
		font-weight: 500;
		font-size: .875rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.meta-value {
		color: var(--color-text-0);
	}

	.status-badge {
		padding: 1px 8px;
		border-radius: var(--radius-sm);
		font-size: .875rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.status-live {
		background: color-mix(in srgb, var(--color-live) 15%, transparent);
		color: var(--color-live);
	}

	.status-failed {
		background: color-mix(in srgb, var(--color-failed) 15%, transparent);
		color: var(--color-failed);
	}

	.status-building {
		background: color-mix(in srgb, var(--color-building) 15%, transparent);
		color: var(--color-building);
	}

	/* Error summary */
	.error-summary {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: color-mix(in srgb, var(--color-failed) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-failed) 25%, transparent);
		border-radius: var(--radius-md);
	}

	.error-title {
		font-weight: 600;
		color: var(--color-failed);
		font-size: .875rem;
	}

	.error-hint {
		color: var(--color-text-1);
		font-size: .875rem;
		flex: 1;
	}

	.retry-btn {
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--color-failed);
		border-radius: var(--radius-md);
		color: var(--color-failed);
		font-size: .875rem;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		text-decoration: none;
	}

	.retry-btn:hover {
		background: color-mix(in srgb, var(--color-failed) 10%, transparent);
		text-decoration: none;
	}

	/* Terminal */
	.terminal {
		flex: 1;
		min-height: 400px;
		max-height: 70vh;
		overflow-y: auto;
		background: var(--color-term-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: .875rem;
		line-height: 1.6;
	}

	.log-line {
		display: flex;
		gap: var(--space-3);
		white-space: pre-wrap;
		word-break: break-all;
	}

	.log-time {
		flex-shrink: 0;
		color: var(--color-term-dim);
		user-select: none;
	}

	.log-msg {
		color: var(--color-text-0);
	}

	.log-error .log-msg {
		color: var(--color-term-error);
	}

	.log-warn .log-msg {
		color: var(--color-building);
	}

	.log-debug .log-msg {
		color: var(--color-term-dim);
	}

	.log-cmd .log-msg {
		color: var(--color-term-cmd);
	}

	.log-empty {
		color: var(--color-term-dim);
		text-align: center;
		padding: var(--space-6);
	}

	/* Cursor blink */
	.cursor-line {
		margin-top: var(--space-1);
	}

	.cursor-blink {
		color: var(--color-text-0);
		animation: blink 1s step-end infinite;
	}

	@keyframes blink {
		0%,
		50% {
			opacity: 1;
		}
		51%,
		100% {
			opacity: 0;
		}
	}

	/* Success actions */
	.success-actions {
		display: flex;
		gap: var(--space-3);
		justify-content: center;
	}

	.btn-primary {
		color: var(--color-bg-0);
		font-size: .875rem;
		font-weight: 500;
	}

	.btn-secondary {
		font-size: .875rem;
		font-weight: 500;
	}
</style>
