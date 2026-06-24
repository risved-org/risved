<script lang="ts">
	import TimezonePicker from '$lib/components/TimezonePicker.svelte'

	interface CronDraft {
		name: string
		route: string
		method: string
		schedule: string
		timezone: string
	}

	let { job = $bindable() }: { job: CronDraft } = $props()
</script>

<label>
	Name
	<input type="text" bind:value={job.name} required maxlength="100" placeholder="Warm cache" />
</label>

<label>
	Route
	<input type="text" bind:value={job.route} required placeholder="/api/cache/warm" class="mono" />
</label>

<label>
	Method
	<select bind:value={job.method}>
		<option value="GET">GET</option>
		<option value="POST">POST</option>
	</select>
</label>

<label>
	Schedule
	<input type="text" bind:value={job.schedule} required placeholder="0 * * * *" class="mono" />
</label>

<label>
	Timezone
	<TimezonePicker bind:value={job.timezone} />
</label>
