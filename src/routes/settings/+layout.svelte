<script lang="ts">
	import DashboardHeader from '$lib/components/DashboardHeader.svelte'

	let { data, children } = $props()
</script>

<DashboardHeader
	displayName={data.displayName}
	hostname={data.hostname}
	health={data.health}
/>
{@render children()}
