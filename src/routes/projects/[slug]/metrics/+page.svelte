<script lang="ts">
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { Area, Axis, Chart, Svg } from 'layerchart'
	import { scaleTime } from 'd3-scale'
	import { curveMonotoneX } from 'd3-shape'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

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

	const ranges = [
		{ label: '6h', value: 6 },
		{ label: '12h', value: 12 },
		{ label: '24h', value: 24 },
		{ label: '48h', value: 48 },
		{ label: '7d', value: 168 }
	]

	function setRange(hours: number) {
		const url = new URL(page.url)
		url.searchParams.set('hours', String(hours))
		goto(url.toString(), { replaceState: true })
	}

	function pad(n: number): string {
		return n.toString().padStart(2, '0')
	}

	let xFormat = $derived((d: Date) => {
		if (data.hours > 24) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
		return `${pad(d.getHours())}:00`
	})

	let cpuPoints = $derived(
		data.resourceMetrics.map((m) => ({ date: new Date(m.bucket), value: m.cpuPercent }))
	)
	let memPoints = $derived(
		data.resourceMetrics.map((m) => ({ date: new Date(m.bucket), value: m.memoryMb }))
	)
</script>

<h1 class="page-title">Metrics</h1>

<section data-testid="metrics-section">
	<header class="section-header">
		<h2 class="section-title">Resource History</h2>
		<nav class="range-bar" data-testid="range-bar">
			{#each ranges as r (r.value)}
				<button
					class="range-btn"
					class:range-active={data.hours === r.value}
					onclick={() => setRange(r.value)}
				>
					{r.label}
				</button>
			{/each}
		</nav>
	</header>

	<section class="charts-grid">
		{@render metricCard(cpuPoints, 'CPU', 'var(--color-accent)', '%')}
		{@render metricCard(memPoints, 'Memory', 'var(--color-live)', ' MB')}
	</section>
</section>

<section data-testid="health-section">
	<h2 class="section-title">Container Health</h2>
	{#if data.containerHealth}
		<div class="health-card">
			<div class="health-status-row">
				<span class="status-dot {data.containerHealth.healthy ? 'dot-live' : 'dot-failed'}"></span>
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
					Restarts: <strong data-testid="restart-count">{data.containerHealth.totalRestarts}</strong>
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

{#snippet metricCard(points: Array<{ date: Date; value: number }>, title: string, color: string, unit: string)}
	<article class="metric-card">
		<span class="metric-label">{title}</span>
		<div class="chart-frame">
			{#if points.length === 0}
				<p class="chart-empty">No data yet</p>
			{:else}
				<Chart
					data={points}
					x="date"
					y="value"
					xScale={scaleTime()}
					yDomain={[0, null]}
					yNice
					padding={{ left: 64, bottom: 24, top: 12, right: 12 }}
				>
					<Svg>
						<Axis
							placement="left"
							grid={{ class: 'metric-grid' }}
							ticks={4}
							rule={false}
							classes={{ tick: 'metric-tick-hidden' }}
						>
							<svelte:fragment slot="tickLabel" let:labelProps>
								<foreignObject
									x={labelProps.x - 64}
									y={labelProps.y - 9}
									width="56"
									height="18"
								>
									<span class="axis-tick axis-y">{labelProps.value}{unit}</span>
								</foreignObject>
							</svelte:fragment>
						</Axis>
						<Axis
							placement="bottom"
							ticks={3}
							rule={false}
							classes={{ tick: 'metric-tick-hidden' }}
							format={(d: Date) => xFormat(d)}
						>
							<svelte:fragment slot="tickLabel" let:labelProps>
								<foreignObject
									x={labelProps.x - 36}
									y={labelProps.y + 6}
									width="72"
									height="18"
								>
									<span class="axis-tick axis-x">{labelProps.value}</span>
								</foreignObject>
							</svelte:fragment>
						</Axis>
						<Area
							fill={color}
							fillOpacity={0.14}
							line={{ stroke: color, strokeWidth: 1.5, fill: 'none' }}
							curve={curveMonotoneX}
						/>
					</Svg>
				</Chart>
			{/if}
		</div>
	</article>
{/snippet}

<style>
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-bottom: var(--space-3);
	}

	.range-bar {
		display: inline-flex;
		align-items: center;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.range-btn {
		padding: var(--space-1) var(--space-2);
		background: transparent;
		border: none;
		border-right: 1.5px solid var(--color-border);
		color: var(--color-text-2);
		font-size: .875rem;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}

	.range-btn:last-child {
		border-right: none;
	}

	.range-btn:hover {
		color: var(--color-text-0);
		background: var(--color-bg-2);
	}

	.range-active {
		color: var(--color-text-0);
		background: var(--color-bg-2);
	}

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

	.metric-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.metric-label {
		font-family: var(--font-mono);
		font-size: .75rem;
		font-weight: 500;
		color: var(--color-text-2);
		letter-spacing: 0.04em;
	}

	.chart-frame {
		height: 10rem;
		position: relative;
	}

	.chart-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-2);
		font-size: .875rem;
	}

	:global(.metric-card foreignObject) {
		overflow: visible;
	}

	:global(.metric-card .axis-tick) {
		display: block;
		font-family: var(--font-mono);
		font-size: .6875rem;
		color: var(--color-text-2);
		line-height: 1;
		white-space: nowrap;
	}

	:global(.metric-card .axis-y) {
		text-align: right;
		padding-right: var(--space-2);
	}

	:global(.metric-card .axis-x) {
		text-align: center;
	}

	:global(.metric-card .metric-grid) {
		stroke: var(--color-border);
		stroke-dasharray: 2 3;
	}

	:global(.metric-card .metric-tick-hidden) {
		stroke: transparent;
	}

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
		background: var(--color-bg-1);
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
</style>
