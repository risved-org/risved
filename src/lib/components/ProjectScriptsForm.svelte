<script lang="ts">
	import type { DetectScriptsResult, ScriptSuggestion } from '$lib/scripts-detect';

	interface LastRelease {
		command: string;
		status: string;
		timestamp: string;
		deploymentId?: string;
		projectSlug?: string;
	}

	interface Props {
		/** Current build command value. */
		buildCommand: string;
		/** Current start command value. */
		startCommand: string;
		/** Current release command value. */
		releaseCommand: string;
		/**
		 * Output of scripts-detect#detectScripts for the connected repo.
		 * Pass null when no repo is connected or detection is not yet run.
		 */
		detection?: DetectScriptsResult | null;
		/**
		 * When set, renders additional context below the release field
		 * (last release run + "changes apply on next deploy"). Used in settings,
		 * hidden in the create flow.
		 */
		settingsContext?: boolean;
		/** Last release run summary — only shown when settingsContext is true. */
		lastRelease?: LastRelease | null;
	}

	let {
		buildCommand = $bindable(''),
		startCommand = $bindable(''),
		releaseCommand = $bindable(''),
		detection = null,
		settingsContext = false,
		lastRelease = null
	}: Props = $props();

	const buildSuggestions = $derived<ScriptSuggestion[]>(
		detection?.suggestions.filter((s) => ['build'].includes(s.name)) ?? []
	);
	const startSuggestions = $derived<ScriptSuggestion[]>(
		detection?.suggestions.filter((s) => ['start', 'serve'].includes(s.name)) ?? []
	);
	/** Release field shows every script, migration-shaped first (already ordered). */
	const releaseSuggestions = $derived<ScriptSuggestion[]>(detection?.suggestions ?? []);

	function applyBuild(s: ScriptSuggestion) {
		buildCommand = s.command;
	}
	function applyStart(s: ScriptSuggestion) {
		startCommand = s.command;
	}
	function applyRelease(s: ScriptSuggestion) {
		releaseCommand = s.command;
	}
</script>

<fieldset class="scripts-form" data-testid="scripts-form">
	{#if detection?.warning}
		<p class="warning" data-testid="lockfile-warning">{detection.warning}</p>
	{/if}

	<!-- Build command -->
	<label class="field">
		<span class="field-label">Build command</span>
		<span class="field-sub">Runs during image build. Leave blank to use the framework default.</span
		>
		<input
			type="text"
			name="buildCommand"
			bind:value={buildCommand}
			placeholder="e.g. bun run build"
			data-testid="build-command-input"
		/>
		{#if buildSuggestions.length > 0}
			<div class="chips" data-testid="build-chips">
				{#each buildSuggestions as s (s.name)}
					<button
						type="button"
						class="chip"
						onclick={() => applyBuild(s)}
						title={s.body}
						data-testid="build-chip-{s.name}"
					>
						<span class="chip-cmd">{s.command}</span>
					</button>
				{/each}
			</div>
		{/if}
	</label>

	<!-- Start command -->
	<label class="field">
		<span class="field-label">Start command</span>
		<span class="field-sub"
			>Runs in the runtime container. Leave blank to use the framework default.</span
		>
		<input
			type="text"
			name="startCommand"
			bind:value={startCommand}
			placeholder="e.g. node build/index.js"
			data-testid="start-command-input"
		/>
		{#if startSuggestions.length > 0}
			<div class="chips" data-testid="start-chips">
				{#each startSuggestions as s (s.name)}
					<button
						type="button"
						class="chip"
						onclick={() => applyStart(s)}
						title={s.body}
						data-testid="start-chip-{s.name}"
					>
						<span class="chip-cmd">{s.command}</span>
					</button>
				{/each}
			</div>
		{/if}
	</label>

	<!-- Release command -->
	<label class="field">
		<span class="field-label">Release command</span>
		<span class="field-sub">
			Runs once per deploy, before traffic switches. Usually migrations.
			<a href="https://risved.org/docs/release-commands" target="_blank" rel="noopener"
				>Learn more</a
			>
		</span>
		<input
			type="text"
			name="releaseCommand"
			bind:value={releaseCommand}
			placeholder="e.g. bun run migrate"
			data-testid="release-command-input"
		/>

		{#if detection?.empty}
			<p class="empty-state" data-testid="release-empty-state">
				No scripts found in package.json. Add a migration script to your package.json or leave blank
				to skip.
				<a href="https://risved.org/docs/release-commands" target="_blank" rel="noopener">
					Learn more
				</a>
			</p>
		{:else if releaseSuggestions.length > 0}
			<div class="chips" data-testid="release-chips">
				{#each releaseSuggestions as s (s.name)}
					<button
						type="button"
						class="chip"
						class:chip-migration={s.migrationShaped}
						onclick={() => applyRelease(s)}
						title={s.body}
						data-testid="release-chip-{s.name}"
					>
						<span class="chip-cmd">{s.command}</span>
						{#if s.label}
							<span class="chip-label">{s.label}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if settingsContext}
			{#if lastRelease}
				<p class="last-release" data-testid="last-release">
					Last release run: <code>{lastRelease.command}</code> at
					<time datetime={lastRelease.timestamp}>{lastRelease.timestamp}</time>
					—
					<span class="status-{lastRelease.status}">{lastRelease.status}</span>
					{#if lastRelease.deploymentId && lastRelease.projectSlug}
						·
						<a
							href="/projects/{lastRelease.projectSlug}/deployments/{lastRelease.deploymentId}"
							data-testid="last-release-log-link"
						>
							view log
						</a>
					{/if}
				</p>
			{/if}
			<p class="hint" data-testid="release-hint">Changes apply on next deploy.</p>
		{/if}
	</label>
</fieldset>

<style>
	.scripts-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: 0.875rem;
	}

	.field-label {
		font-weight: 600;
		color: var(--color-text-0);
	}

	.field-sub {
		font-size: 0.8125rem;
		color: var(--color-text-2);
	}

	.field-sub a {
		color: var(--color-accent);
	}

	input[type='text'] {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-family: var(--font-mono);
		font-size: 0.875rem;
		outline: none;
	}

	input[type='text']:focus {
		border-color: var(--color-accent);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.chip {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: var(--space-1) var(--space-2);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.chip:hover {
		border-color: var(--color-accent);
		color: var(--color-text-0);
	}

	.chip-migration {
		border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
	}

	.chip-cmd {
		font-family: var(--font-mono);
	}

	.chip-label {
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-accent);
	}

	.warning {
		padding: var(--space-2) var(--space-3);
		background: color-mix(in srgb, var(--color-building) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-building) 25%, transparent);
		border-radius: var(--radius-sm);
		color: var(--color-text-1);
		font-size: 0.8125rem;
	}

	.empty-state {
		font-size: 0.8125rem;
		color: var(--color-text-2);
	}

	.empty-state a {
		color: var(--color-accent);
	}

	.last-release {
		font-size: 0.8125rem;
		color: var(--color-text-1);
	}

	.last-release code {
		font-family: var(--font-mono);
		padding: 0 4px;
		background: var(--color-bg-2);
		border-radius: var(--radius-sm);
	}

	.status-live {
		color: var(--color-live);
	}
	.status-failed {
		color: var(--color-failed);
	}

	.hint {
		font-size: 0.75rem;
		color: var(--color-text-2);
	}
</style>
