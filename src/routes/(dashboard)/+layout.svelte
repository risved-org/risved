<script lang="ts">
	import { page } from '$app/state'
	import { resolve } from '$app/paths'

	let { data, children } = $props()
</script>

<header class="dashboard-bar">
	<div class="bar-inner">
		<nav>
			<a href={resolve('/projects')} class:active={page.url.pathname === '/projects'}>Projects</a>
			<a href={resolve('/metrics')} class:active={page.url.pathname === '/metrics'}>Metrics</a>
			<a href={resolve('/analytics')} class:active={page.url.pathname === '/analytics'}>Analytics</a>
			<a href={resolve('/settings')} class:active={page.url.pathname === '/settings'}>Settings</a>
		</nav>
		<aside class="health-meters" data-testid="health-bar">
			<span class="meter">
				<span class="meter-label">CPU</span>
				<span class="meter-value">{data.health.cpuPercent}%</span>
			</span>
			<span class="meter">
				<span class="meter-label">MEM</span>
				<span class="meter-value">{data.health.memoryPercent}%</span>
			</span>
			<span class="meter">
				<span class="meter-label">DISK</span>
				<span class="meter-value">{data.health.diskPercent}%</span>
			</span>
			<span class="meter">
				<span class="meter-label">UP</span>
				<span class="meter-value">{data.health.uptime}</span>
			</span>
			<span class="meter">
				<span class="meter-label">CTR</span>
				<span class="meter-value">{data.health.containerCount}</span>
			</span>
		</aside>
	</div>
</header>
{@render children()}

<style>
	.dashboard-bar {
		padding: 0 var(--space-4);
	}

	.bar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) 0;
		max-width: 64rem;
		margin: 0 auto;
		width: 100%;
	}

	nav {
		display: flex;
		gap: 0;
	}

	nav a {
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-md);
		color: var(--color-text-2);
		font-size: .875rem;
		font-weight: 500;
		text-decoration: none;
		transition: color 0.15s, background 0.15s;
	}

	nav a:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	nav a.active {
		color: var(--color-text-0);
		background: var(--color-bg-2);
	}

	.health-meters {
		display: flex;
		gap: var(--space-3);
		font-family: var(--font-mono);
		font-size: .75rem;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.meter {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.meter-label {
		color: var(--color-text-2);
		font-weight: 500;
		letter-spacing: 0.05em;
	}

	.meter-value {
		color: var(--color-text-0);
	}

	@media (max-width: 600px) {
		.bar-inner {
			flex-direction: column-reverse;
			gap: var(--space-2);
			align-items: stretch;
		}

		.health-meters {
			flex-wrap: wrap;
		}
	}
</style>
