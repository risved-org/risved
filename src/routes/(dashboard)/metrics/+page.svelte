<script lang="ts">
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { Area, Axis, Chart, Svg } from 'layerchart'
	import { scaleTime } from 'd3-scale'
	import { curveMonotoneX } from 'd3-shape'

	let { data } = $props()

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
		data.serverMetrics.map((m) => ({ date: new Date(m.bucket), value: m.cpuPercent }))
	)
	let memPoints = $derived(
		data.serverMetrics.map((m) => ({ date: new Date(m.bucket), value: m.memoryMb }))
	)
</script>

<svelte:head>
	<title>Server metrics – Risved</title>
</svelte:head>

<article class="metrics-page">
	<h1>Server metrics</h1>

	<section class="resource-overview" data-testid="resource-overview">
		<header class="resource-header">
			<h2>Resource history</h2>
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

		<section class="resource-charts">
			{@render metricCard(cpuPoints, 'CPU', 'var(--color-accent)', '%')}
			{@render metricCard(memPoints, 'Memory', 'var(--color-live)', ' MB')}
		</section>
	</section>
</article>

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
	.metrics-page {
		display: flex;
		flex-direction: column;
		flex: 1;
		padding: var(--space-4) 0;
		gap: var(--space-4);
		width: min(100% - 2rem, 64rem);
		margin: 0 auto;
	}

	h1 {
		font-size: 2rem;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: 3rem;
		}
	}

	.resource-overview {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.resource-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.resource-header h2 {
		font-family: var(--font-sans);
		font-size: .75rem;
		font-weight: 600;
		color: var(--color-text-2);
		text-transform: uppercase;
		letter-spacing: 0.06em;
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

	.resource-charts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 600px) {
		.resource-charts {
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
</style>
