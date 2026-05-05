<script lang="ts">
	import { page } from '$app/state'
	import { resolve } from '$app/paths'

	type Health = {
		cpuPercent: number
		memoryPercent: number
		diskPercent: number
		uptime: string
	}

	let {
		displayName,
		hostname,
		health
	}: {
		displayName: string
		hostname: string
		health: Health
	} = $props()
</script>

<header class="dashboard-bar">
	<div class="bar-inner">
		<div class="nav-group">
			<a href={resolve('/projects')} class="instance-name">{displayName || hostname}</a>
			<nav>
				<a href={resolve('/projects')} class:active={page.url.pathname === '/projects'}>Projects</a>
				<a href={resolve('/metrics')} class:active={page.url.pathname === '/metrics'}>Metrics</a>
				<a href={resolve('/analytics')} class:active={page.url.pathname === '/analytics'}>Analytics</a>
				<a href={resolve('/settings')} class:active={page.url.pathname.startsWith('/settings')}>Settings</a>
			</nav>
		</div>
		<aside class="health-meters" data-testid="health-bar">
			<span class="meter">
				<span class="meter-label">CPU</span>
				<span class="meter-value">{health.cpuPercent}%</span>
			</span>
			<span class="meter">
				<span class="meter-label">MEM</span>
				<span class="meter-value">{health.memoryPercent}%</span>
			</span>
			<span class="meter">
				<span class="meter-label">DISK</span>
				<span class="meter-value">{health.diskPercent}%</span>
			</span>
			<span class="meter">
				<span class="meter-label">UP</span>
				<span class="meter-value">{health.uptime}</span>
			</span>
		</aside>
	</div>
</header>

<style>
	.bar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) 0;
		width: min(100% - 2rem, 64rem);
		margin: 0 auto;
	}

	.nav-group {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.instance-name {
		font-size: .875rem;
		color: var(--color-text-1);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 12rem;
		text-decoration: none;
	}

	.instance-name:hover {
		color: var(--color-text-0);
		text-decoration: none;
	}

	nav {
		display: inline-flex;
		align-items: center;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	nav a {
		padding: var(--space-2) var(--space-3);
		border-right: 1.5px solid var(--color-border);
		color: var(--color-text-2);
		font-size: .875rem;
		font-weight: 600;
		text-decoration: none;
		transition: color 0.15s, background 0.15s;
	}

	nav a:last-child {
		border-right: none;
	}

	nav a:hover {
		color: var(--color-text-0);
		background: var(--color-bg-2);
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
		line-height: 1.34;
		padding: var(--space-1) var(--space-3);
		background: var(--color-bg-3);
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

		.nav-group {
			gap: var(--space-3);
		}

		.health-meters {
			flex-wrap: wrap;
		}
	}
</style>
