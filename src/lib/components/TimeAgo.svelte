<script lang="ts">
	import { formatDate, tickInterval } from '$lib/format-date'

	let { value, includeTime = false }: {
		value: string | number | Date | null | undefined
		includeTime?: boolean
	} = $props()

	let now = $state(Date.now())

	$effect(() => {
		const ms = tickInterval(value)
		if (ms <= 0) return

		const id = setInterval(() => { now = Date.now() }, ms)
		return () => clearInterval(id)
	})

	let text = $derived.by(() => {
		void now
		return formatDate(value, { includeTime })
	})
</script>

{text}
