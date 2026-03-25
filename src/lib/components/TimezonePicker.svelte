<script lang="ts">
	interface Group {
		label: string
		offset: number
		zones: string[]
	}

	let { value = $bindable(), name = 'timezone' }: { value: string; name?: string } = $props()

	let search = $state('')
	let open = $state(false)
	let listEl = $state<HTMLElement | null>(null)
	let inputEl = $state<HTMLElement | null>(null)

	/**
	 * Build grouped IANA timezone list sorted by UTC offset.
	 * Uses Intl to get the real offset for each zone at the current moment.
	 */
	function buildGroups(): Group[] {
		const now = Date.now()
		const zones = Intl.supportedValuesOf('timeZone')
		const byOffset = new Map<number, string[]>()

		for (const tz of zones) {
			const parts = new Intl.DateTimeFormat('en-US', {
				timeZone: tz,
				timeZoneName: 'shortOffset'
			}).formatToParts(now)
			const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
			const minutes = parseOffset(offsetStr)
			if (!byOffset.has(minutes)) byOffset.set(minutes, [])
			byOffset.get(minutes)!.push(tz)
		}

		return [...byOffset.entries()]
			.sort(([a], [b]) => a - b)
			.map(([minutes, tzs]) => ({
				label: formatOffset(minutes),
				offset: minutes,
				zones: tzs.sort()
			}))
	}

	function parseOffset(str: string): number {
		if (str === 'GMT' || str === 'UTC') return 0
		const match = str.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
		if (!match) return 0
		const sign = match[1] === '+' ? 1 : -1
		return sign * (parseInt(match[2]) * 60 + parseInt(match[3] ?? '0'))
	}

	function formatOffset(minutes: number): string {
		const sign = minutes >= 0 ? '+' : '-'
		const abs = Math.abs(minutes)
		const h = Math.floor(abs / 60)
		const m = abs % 60
		return `UTC ${sign}${h}:${String(m).padStart(2, '0')}`
	}

	const groups = buildGroups()

	const filtered = $derived.by(() => {
		const q = search.toLowerCase()
		if (!q) return groups
		return groups
			.map((g) => ({
				...g,
				zones: g.zones.filter(
					(tz) => tz.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)
				)
			}))
			.filter((g) => g.zones.length > 0)
	})

	const displayValue = $derived.by(() => {
		if (!value) return ''
		for (const g of groups) {
			if (g.zones.includes(value)) {
				return `${value} (${g.label})`
			}
		}
		return value
	})

	function select(tz: string) {
		value = tz
		search = ''
		open = false
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false
			search = ''
		}
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement
		if (!target.closest('.tz-picker')) {
			open = false
			search = ''
		}
	}

	$effect(() => {
		if (open) {
			document.addEventListener('click', handleClickOutside)
			return () => document.removeEventListener('click', handleClickOutside)
		}
	})

	$effect(() => {
		if (open && listEl) {
			const searchInput = listEl.querySelector<HTMLInputElement>('.tz-search')
			searchInput?.focus()
			const active = listEl.querySelector('.tz-active')
			if (active) active.scrollIntoView({ block: 'center' })
		}
	})
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tz-picker" onkeydown={handleKeydown}>
	<input type="hidden" {name} {value} />
	<button
		type="button"
		class="tz-trigger"
		onclick={() => { open = !open }}
		bind:this={inputEl}
		data-testid="timezone-trigger"
	>
		<span class="tz-display">{displayValue || 'Select timezone'}</span>
		<svg class="tz-chevron" class:open width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<path d="M3 5L6 8L9 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
		</svg>
	</button>

	{#if open}
		<div class="tz-dropdown" bind:this={listEl}>
			<input
				type="text"
				class="tz-search"
				placeholder="Search timezones…"
				bind:value={search}
				data-testid="timezone-search"
			/>
			<div class="tz-list" role="listbox">
				{#each filtered as group (group.label)}
					<div class="tz-group">
						<div class="tz-group-label">{group.label}</div>
						{#each group.zones as tz (tz)}
							<button
								type="button"
								class="tz-option"
								class:tz-active={tz === value}
								role="option"
								aria-selected={tz === value}
								onclick={() => select(tz)}
							>
								{tz.replace(/_/g, ' ')}
							</button>
						{/each}
					</div>
				{/each}
				{#if filtered.length === 0}
					<p class="tz-empty">No timezones match "{search}"</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.tz-picker {
		position: relative;
	}

	.tz-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-2);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		color: var(--color-text-0);
		font-size: 1rem;
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.tz-trigger:focus {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
		outline: none;
	}

	.tz-display {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tz-chevron {
		flex-shrink: 0;
		color: var(--color-text-2);
		transition: transform 0.15s;
	}

	.tz-chevron.open {
		transform: rotate(180deg);
	}

	.tz-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		background: var(--color-bg-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--color-text-0) 10%, transparent);
		z-index: 50;
		display: flex;
		flex-direction: column;
	}

	.tz-search {
		padding: var(--space-2) var(--space-3);
		border: none;
		border-bottom: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-0);
		font-size: 1rem;
		outline: none;
	}

	.tz-search::placeholder {
		color: var(--color-text-2);
	}

	.tz-list {
		max-height: 280px;
		overflow-y: auto;
	}

	.tz-group-label {
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: .875rem;
		font-weight: 600;
		color: var(--color-text-2);
		position: sticky;
		top: 0;
		background: var(--color-bg-1);
	}

	.tz-option {
		display: block;
		width: 100%;
		padding: var(--space-1) var(--space-3) var(--space-1) var(--space-4);
		background: transparent;
		border: none;
		color: var(--color-text-0);
		font-size: .875rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
	}

	.tz-option:hover {
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}

	.tz-option.tz-active {
		color: var(--color-accent);
		font-weight: 600;
	}

	.tz-empty {
		padding: var(--space-3);
		color: var(--color-text-2);
		font-size: .875rem;
		text-align: center;
	}
</style>
