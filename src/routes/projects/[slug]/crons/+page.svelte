<script lang="ts">
	import { invalidateAll } from '$app/navigation'
	import { resolve } from '$app/paths'
	import CronFields from './CronFields.svelte'
	import './crons.css'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	type CronJob = PageData['cronJobs'][number]

	const emptyDraft = {
	name: '',
	route: '/',
	method: 'GET',
	schedule: '0 * * * *',
	timezone: 'UTC'
}

	let draft = $state({ ...emptyDraft })
	let editing = $state<Record<string, boolean>>({})
	let edits = $state<Record<string, typeof emptyDraft>>({})
	let busy = $state<string | null>(null)
	let errorMessage = $state<string | null>(null)
	// svelte-ignore state_referenced_locally
	let showAddForm = $state(data.cronJobs.length === 0)

	/** Convert a cron expression into a compact human label. */
	function describeSchedule(expr: string): string {
		const parts = expr.trim().split(/\s+/)
		if (parts.length < 5) return expr
		const [min, hour, dom, mon, dow] = parts

		if (min === '*' && hour === '*') return 'Every minute'
		if (min === '0' && hour === '*') return 'Every hour'
		if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*')
			return 'Daily at midnight'
		if (dom === '*' && mon === '*' && dow === '*' && hour !== '*')
			return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
		if (dom === '*' && mon === '*' && dow === '1')
			return `Mondays at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
		return expr
	}

	/** Format a last-run timestamp relative to now. */
	function timeAgo(dateStr: string | null): string {
		if (!dateStr) return 'never'
		const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
		if (seconds < 60) return 'just now'
		const minutes = Math.floor(seconds / 60)
		if (minutes < 60) return `${minutes}m ago`
		const hours = Math.floor(minutes / 60)
		if (hours < 24) return `${hours}h ago`
		return `${Math.floor(hours / 24)}d ago`
	}

	/** Return the CSS status class for a cron run result. */
	function statusClass(status: string | undefined): string {
		if (!status) return ''
		if (status === 'success') return 'success'
		if (status === 'timeout') return 'timeout'
		return 'failed'
	}

	/** Parse API errors into a useful UI message. */
	async function readError(response: Response): Promise<string> {
		const body = await response.json().catch(() => null)
		if (body && typeof body.error === 'string') return body.error
		return 'Something went wrong'
	}

	/** Send a cron API request and refresh the page data on success. */
	async function requestCron(path: string, init: RequestInit) {
		errorMessage = null
		const response = await fetch(`/api/projects/${data.project.id}/crons${path}`, init)
		if (!response.ok) {
			errorMessage = await readError(response)
			return false
		}
		await invalidateAll()
		return true
	}

	/** Create a new scheduled task. */
	async function addCron(event: SubmitEvent) {
		event.preventDefault()
		busy = 'add'
		try {
			const saved = await requestCron('', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(draft)
			})
			if (saved) {
				draft = { ...emptyDraft }
				showAddForm = false
			}
		} finally {
			busy = null
		}
	}

	/** Put an existing row into edit mode. */
	function startEdit(job: CronJob) {
		editing = { ...editing, [job.id]: true }
		edits = {
			...edits,
			[job.id]: {
				name: job.name,
				route: job.route,
				method: job.method,
				schedule: job.schedule,
				timezone: job.timezone
			}
		}
	}

	/** Save edits for one scheduled task. */
	async function saveEdit(event: SubmitEvent, jobId: string) {
		event.preventDefault()
		busy = `save:${jobId}`
		try {
			const saved = await requestCron(`/${jobId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(edits[jobId])
			})
			if (saved) editing = { ...editing, [jobId]: false }
		} finally {
			busy = null
		}
	}

	/** Toggle a scheduled task on or off. */
	async function toggleCron(job: CronJob) {
		busy = `toggle:${job.id}`
		try {
			await requestCron(`/${job.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !job.enabled })
			})
		} finally {
			busy = null
		}
	}

	/** Manually run a scheduled task. */
	async function triggerCron(jobId: string) {
		busy = `trigger:${jobId}`
		try {
			await requestCron(`/${jobId}/trigger`, { method: 'POST' })
		} finally {
			busy = null
		}
	}

	/** Delete a scheduled task. */
	async function deleteCron(jobId: string) {
		busy = `delete:${jobId}`
		try {
			await requestCron(`/${jobId}`, { method: 'DELETE' })
		} finally {
			busy = null
		}
	}
</script>

<svelte:head>
	<title>Scheduled Tasks - {data.project.name} - Risved</title>
</svelte:head>

<section class="crons-page">
	<nav class="sub-breadcrumb">
		<a href={resolve(`/projects/${data.project.slug}/settings`)} class="breadcrumb-link">&lt;- Settings</a>
	</nav>

	<header>
		<h1 class="page-title">Scheduled Tasks</h1>
		{#if !showAddForm}
			<button class="btn-secondary btn-md" onclick={() => (showAddForm = true)} data-testid="add-cron-btn">
				Add task
			</button>
		{/if}
	</header>

	{#if errorMessage}
		<p class="error-message" data-testid="cron-error">{errorMessage}</p>
	{/if}

	{#if showAddForm}
		<form class="cron-form" onsubmit={addCron} data-testid="add-cron-form">
			<CronFields bind:job={draft} />
			<footer>
				<button type="submit" class="btn-primary btn-md" disabled={busy === 'add'}>
					{busy === 'add' ? 'Adding...' : 'Add task'}
				</button>
				<button type="button" class="btn-secondary btn-md" onclick={() => (showAddForm = false)}>
					Cancel
				</button>
			</footer>
		</form>
	{/if}

	{#if data.cronJobs.length === 0 && !showAddForm}
		<p class="empty-text" data-testid="no-crons">No scheduled tasks configured.</p>
	{/if}

	{#if data.cronJobs.length > 0}
		<ul data-testid="cron-list">
			{#each data.cronJobs as job (job.id)}
				<li data-testid="cron-row">
					{#if editing[job.id]}
						<form class="cron-form" onsubmit={(event) => saveEdit(event, job.id)}>
							<CronFields bind:job={edits[job.id]} />
							<footer>
								<button type="submit" class="btn-primary btn-md" disabled={busy === `save:${job.id}`}>
									{busy === `save:${job.id}` ? 'Saving...' : 'Save'}
								</button>
								<button
									type="button"
									class="btn-secondary btn-md"
									onclick={() => (editing = { ...editing, [job.id]: false })}
								>
									Cancel
								</button>
							</footer>
						</form>
					{:else}
						<article>
							<header>
								<label>
									<input
										type="checkbox"
										checked={job.enabled}
										disabled={busy === `toggle:${job.id}`}
										oninput={() => toggleCron(job)}
									/>
									<span>{job.enabled ? 'Enabled' : 'Paused'}</span>
								</label>
								<nav aria-label="Actions for {job.name}">
									<button class="btn-secondary btn-md" onclick={() => startEdit(job)}>Edit</button>
									<button
										class="btn-secondary btn-md"
										disabled={busy === `trigger:${job.id}`}
										onclick={() => triggerCron(job.id)}
									>
										{busy === `trigger:${job.id}` ? 'Running...' : 'Trigger'}
									</button>
									<button
										class="btn-danger btn-md"
										disabled={busy === `delete:${job.id}`}
										onclick={() => deleteCron(job.id)}
									>
										{busy === `delete:${job.id}` ? 'Deleting...' : 'Delete'}
									</button>
								</nav>
							</header>
							<h2>{job.name}</h2>
							<dl>
								<div>
									<dt>Route</dt>
									<dd class="mono">{job.method} {job.route}</dd>
								</div>
								<div>
									<dt>Schedule</dt>
									<dd title={job.schedule}>{describeSchedule(job.schedule)}</dd>
								</div>
								<div>
									<dt>Timezone</dt>
									<dd>{job.timezone}</dd>
								</div>
								<div>
									<dt>Last run</dt>
									<dd class={statusClass(job.lastRun?.status)}>
										{#if job.lastRun}
											{job.lastRun.statusCode ?? job.lastRun.status} / {timeAgo(job.lastRun.startedAt)}
										{:else}
											never
										{/if}
									</dd>
								</div>
							</dl>
						</article>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
