<script lang="ts">
	import { resolve } from '$app/paths'

	type Step = { label: string; href: string }

	const steps: Step[] = [
		{ label: 'Account', href: '/onboarding' },
		{ label: 'Domain', href: '/onboarding/domain' },
		{ label: 'Verify', href: '/onboarding/verify' },
		{ label: 'Git', href: '/onboarding/git' },
		{ label: 'Deploy', href: '/onboarding/deploy' }
	]

	let { current = 0, skipVerify = false }: { current?: number; skipVerify?: boolean } = $props()

	function isClickable(i: number): boolean {
		if (i >= current) return false
		if (i === 0) return false
		if (i === 2 && skipVerify) return false
		return true
	}
</script>

<nav class="step-indicator" aria-label="Onboarding progress">
	<ol>
		{#each steps as step, i (step.label)}
			<li
				class="step"
				class:completed={i < current}
				class:active={i === current}
				class:upcoming={i > current}
				aria-current={i === current ? 'step' : undefined}
			>
				{#if isClickable(i)}
					<a href={resolve(step.href as any)} class="step-link">
						<span class="step-number">{i + 1}</span>
						<span class="step-label">{step.label}</span>
					</a>
				{:else}
					<span class="step-number">{i + 1}</span>
					<span class="step-label">{step.label}</span>
				{/if}
			</li>
		{/each}
	</ol>
</nav>

<style>
	.step-indicator {
		margin-bottom: var(--space-6);
	}

	ol {
		list-style: none;
		display: inline-flex;
		align-items: center;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.step {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-right: 1.5px solid var(--color-border);
		transition: background 0.15s, color 0.15s;
	}

	.step:last-child {
		border-right: none;
	}

	.step-number {
		font-size: .875rem;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--color-text-0);
		opacity: 0.75;
	}

	.step-label {
		font-size: .875rem;
		font-weight: 600;
		color: var(--color-text-0);
		opacity: 0.5;
	}

	.step.active {
		background: var(--color-bg-2);
	}

	.step.active .step-number {
		opacity: 1;
	}

	.step.active .step-label {
		opacity: 0.75;
	}

	.step-link {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		text-decoration: none;
		color: inherit;
	}

	.step-link:hover {
		text-decoration: none;
	}

	.step:has(.step-link):hover {
		background: var(--color-bg-2);
		cursor: pointer;
	}
</style>
