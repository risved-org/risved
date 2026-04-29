/**
 * Formats a date as relative with singular/plural units up to 3 days,
 * then switches to ISO format "2026-03-24".
 * Pass includeTime: true to append 24h time: "2026-03-24 14:30".
 */
export function formatDate(
	value: string | number | Date | null | undefined,
	{ includeTime = false }: { includeTime?: boolean } = {}
): string {
	if (!value) return '–'

	const date = value instanceof Date ? value : new Date(value)
	if (isNaN(date.getTime())) return '–'

	const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

	if (seconds < 60) return 'Just now'

	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`

	const hours = Math.floor(minutes / 60)
	if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`

	const days = Math.floor(hours / 24)
	if (days <= 3) return days === 1 ? '1 day ago' : `${days} days ago`

	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	const iso = `${y}-${m}-${d}`

	if (!includeTime) return iso

	const hh = String(date.getHours()).padStart(2, '0')
	const mm = String(date.getMinutes()).padStart(2, '0')
	return `${iso} ${hh}:${mm}`
}

/** Returns the appropriate tick interval in ms based on how old the date is. */
export function tickInterval(value: string | number | Date | null | undefined): number {
	if (!value) return 0

	const date = value instanceof Date ? value : new Date(value)
	if (isNaN(date.getTime())) return 0

	const seconds = Math.floor((Date.now() - date.getTime()) / 1000)

	if (seconds < 60) return 60_000       // tick every minute (stays "Just now")
	if (seconds < 3600) return 60_000      // tick every minute
	if (seconds < 86400) return 60_000     // tick every minute (for hour transitions)
	if (seconds < 259200) return 3_600_000 // tick every hour (for day transitions)
	return 0                               // static, no ticking needed
}
